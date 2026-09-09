:; exec "$(dirname "$0")/qodersec-launch.sh" "$@" #
@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM Windows launcher for the qodersec binary.
REM On Windows: cmd.exe runs this batch section, locates qodersec(.exe), execs it.
REM On Unix: the first line delegates immediately to qodersec-launch.sh.
REM Keep this file CRLF-terminated: cmd.exe corrupts LF-only polyglot parsing.
REM
REM Glue (unified under ~/.qodersec):
REM   - locate the binary in ~/.qodersec/bin/ (installed by the background updater)
REM   - resolve QODERSEC_HOME (default ~/.qodersec) — the ONE root for config + creds
REM     + logs + state; seed config.yaml there from the plugin's bundled template
REM     when it is missing
REM   - maps QODERSEC_HOME → CODESEC_HOME internally (Go binary reads CODESEC_HOME)
REM   - forward stdin + every argument unchanged
REM
REM The launcher never downloads anything: it is the single decision point that
REM compares installed versions against this plugin's pins (pure file reads) and
REM hands any needed work to qodersec-update.cmd in the background, so no hook
REM ever pays for a bootstrap or an ensure-deps download.
REM
REM Usage: qodersec-launch.cmd <qodersec args...>     (stdin is passed through)

set "_QODERSEC_LOG="

set "BIN_DIR=%~dp0"
set "PLUGIN_ROOT=%BIN_DIR%.."
REM Tell the Go binary to use qodersec-specific naming (log file, etc.)
set "CODESEC_LOG_NAME=qodersec"
REM Pinned dependency versions (updated when plugin is published)
REM Set both QODERSEC_* and CODESEC_* for Go binary compatibility
set "QODERSEC_CLI_VERSION_GLOBAL=0.9.0"
set "QODERSEC_CLI_VERSION_CN=0.9.0"
set "CODESEC_CLI_VERSION_GLOBAL=0.9.0"
set "CODESEC_CLI_VERSION_CN=0.9.0"
set "QODERCLI_VERSION_GLOBAL=1.1.41"
set "QODERCLI_VERSION_CN=1.1.41"
set "QODERCLI_MANIFEST_URL_GLOBAL=https://download.qoder.com/qodercli/channels/1.1.41/manifest.json"
set "QODERCLI_MANIFEST_URL_CN=https://static.qoder.com.cn/qoder-cli-cn/channels/1.1.41/manifest.json"

REM Resolve home without a parenthesized block so paths containing ! or ) remain intact.
if defined QODERSEC_HOME goto use_qodersec_home
if defined CODESEC_HOME goto use_codesec_home
set "CHOME=%USERPROFILE%\.qodersec"
goto home_resolved
:use_qodersec_home
set "CHOME=%QODERSEC_HOME%"
goto home_resolved
:use_codesec_home
set "CHOME=%CODESEC_HOME%"
:home_resolved
if not exist "%CHOME%" mkdir "%CHOME%" >nul 2>nul
if not exist "%CHOME%\." echo qodersec-launch: %CHOME% exists but is not a directory >&2
if not exist "%CHOME%\." exit /b 127
if not exist "%CHOME%\logs" mkdir "%CHOME%\logs" >nul 2>nul
set "_QODERSEC_LOG=%CHOME%\logs\qodersec.log"

set "CLI=%CHOME%\bin\qodersec.exe"
set "STATE_DIR=%CHOME%\state"
set "LOCK_DIR=%STATE_DIR%\qodersec-update.lock"
set "COOLDOWN_FILE=%STATE_DIR%\qodersec-update.cooldown"
REM A failed attempt must not make every edit re-download the world.
set "UPDATE_COOLDOWN_MINUTES=10"
REM Windows cannot test process liveness without paying for a PowerShell start,
REM so the hot path treats a recently refreshed heartbeat as "in flight" and
REM leaves the authoritative, process-based judgement to qodersec-update.cmd.
set "UPDATE_IN_FLIGHT_MINUTES=15"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"

REM Seed the persistent config when it is missing entirely. The version-driven
REM refresh belongs to qodersec-update.cmd, which only does it after the binary
REM reached the pinned version — config must never run ahead of its dependency.
if exist "%CHOME%\config.yaml" goto config_ready
if exist "%PLUGIN_ROOT%\config.yaml" copy /y "%PLUGIN_ROOT%\config.yaml" "%CHOME%\config.yaml" >nul 2>nul
if not exist "%CHOME%\config.yaml" if exist "%PLUGIN_ROOT%\config.yaml.example" copy /y "%PLUGIN_ROOT%\config.yaml.example" "%CHOME%\config.yaml" >nul 2>nul
:config_ready
REM Map to internal names the Go binary reads
set "QODERSEC_HOME=%CHOME%"
set "CODESEC_HOME=%CHOME%"

REM Add ~/.qodersec/bin to PATH for downloaded qodercli binaries.
set "PATH=%CHOME%\bin;%PATH%"

REM Inner qodercli must not re-enter any plugin hook path. The SDK-spawned
REM qodercli carries CODESEC_REVIEW_SUBPROCESS=1; short-circuit the launcher
REM itself before any update or exec so SessionStart / review / any future hook
REM all no-op uniformly.
if not "%CODESEC_REVIEW_SUBPROCESS%"=="1" goto outer_process
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] skip inner subprocess
call :drain_stdin
exit /b 0
:outer_process

if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] exec

REM ---- Version decisions (pure file reads; the updater never re-derives them) ----
set "TARGET_CLI_VERSION=%QODERSEC_CLI_VERSION_GLOBAL%"
if /I "%QODER_SITE%"=="CN" set "TARGET_CLI_VERSION=%QODERSEC_CLI_VERSION_CN%"
call :read_installed_version
REM Only ever forward, never back. One binary is shared by every launcher copy on
REM the machine and each copy pins its own version, so a pin-vs-installed
REM mismatch is not enough: replacing a newer binary with an older pin makes two
REM copies overwrite each other's install on every session, forever. A rollback
REM therefore ships as a higher version, not as a lower pin.
set "NEED_BIN=0"
if "%INSTALLED_CLI_VERSION%"=="%TARGET_CLI_VERSION%" goto bin_checked
set "NEED_BIN=1"
call :pin_is_downgrade "%TARGET_CLI_VERSION%" "%INSTALLED_CLI_VERSION%"
if errorlevel 1 goto bin_checked
set "NEED_BIN=0"
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] keeping installed qodersec: pin is older (installed=%INSTALLED_CLI_VERSION% pin=%TARGET_CLI_VERSION%)
:bin_checked

REM qodercli: compare the pin with what ensure-deps recorded, per channel.
set "QODERCLI_CHANNEL=global"
set "QODERCLI_BINARY=qodercli"
set "TARGET_QODERCLI_VERSION=%QODERCLI_VERSION_GLOBAL%"
if /I "%QODER_SITE%"=="CN" set "QODERCLI_CHANNEL=cn"
if /I "%QODER_SITE%"=="CN" set "QODERCLI_BINARY=qoderclicn"
if /I "%QODER_SITE%"=="CN" set "TARGET_QODERCLI_VERSION=%QODERCLI_VERSION_CN%"
set "NEED_QODERCLI=0"
if not defined TARGET_QODERCLI_VERSION goto qodercli_checked
set "QODERCLI_MARKER=%CHOME%\bin\%QODERCLI_BINARY%-version.json"
if not exist "%QODERCLI_MARKER%" set "NEED_QODERCLI=1"
if not exist "%QODERCLI_MARKER%" goto qodercli_checked
call :read_qodercli_marker
REM A channel switch is a different binary, so it always applies. The version,
REM on the other hand, moves forward only: this binary is shared the same way
REM qodersec is, and an older pin replacing a newer install makes two copies
REM fight over it on every session.
if not "%INSTALLED_QODERCLI_CHANNEL%"=="%QODERCLI_CHANNEL%" set "NEED_QODERCLI=1"
if not "%INSTALLED_QODERCLI_CHANNEL%"=="%QODERCLI_CHANNEL%" goto qodercli_checked
if "%INSTALLED_QODERCLI_VERSION%"=="%TARGET_QODERCLI_VERSION%" goto qodercli_checked
set "NEED_QODERCLI=1"
call :pin_is_downgrade "%TARGET_QODERCLI_VERSION%" "%INSTALLED_QODERCLI_VERSION%"
if errorlevel 1 goto qodercli_checked
set "NEED_QODERCLI=0"
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] keeping installed %QODERCLI_BINARY%: pin is older (installed=%INSTALLED_QODERCLI_VERSION% pin=%TARGET_QODERCLI_VERSION%)
:qodercli_checked

REM config.yaml: refresh whenever the plugin version moved on — forward only, for
REM the same reason the binaries do. config.yaml is a single shared file, so an
REM older plugin version must not put its template back on top of a newer one.
call :read_plugin_version
set "NEED_CONFIG=0"
if not defined PLUGIN_VERSION goto config_checked
if not exist "%CHOME%\.config-version" set "NEED_CONFIG=1"
if not exist "%CHOME%\.config-version" goto config_checked
set "INSTALLED_CONFIG_VERSION="
set /p INSTALLED_CONFIG_VERSION=<"%CHOME%\.config-version"
if "%INSTALLED_CONFIG_VERSION%"=="%PLUGIN_VERSION%" goto config_checked
set "NEED_CONFIG=1"
call :pin_is_downgrade "%PLUGIN_VERSION%" "%INSTALLED_CONFIG_VERSION%"
if errorlevel 1 goto config_checked
set "NEED_CONFIG=0"
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] keeping installed config: plugin version is older (installed=%INSTALLED_CONFIG_VERSION% plugin=%PLUGIN_VERSION%)
:config_checked

set "UPDATE_NEEDED=0"
if "%NEED_BIN%"=="1" set "UPDATE_NEEDED=1"
if "%NEED_CONFIG%"=="1" set "UPDATE_NEEDED=1"
if "%NEED_QODERCLI%"=="1" set "UPDATE_NEEDED=1"

if /I "%~1"=="ensure-deps" goto dispatch_ensure_deps
REM review / scan / settings fire far more often than SessionStart, which makes
REM them the safety net: if the SessionStart attempt was killed with its hook or
REM failed, a pending update still gets picked up before the session ends. Gated
REM and non-blocking, so the command itself is never delayed.
call :trigger_update
goto run_qodersec

:dispatch_ensure_deps
REM SessionStart. Up to date means ensure-deps makes no network call at all, so
REM run it inline (it also initialises the review baseline); otherwise hand
REM everything to the updater and return immediately.
if not "%UPDATE_NEEDED%"=="1" goto ensure_deps_inline
call :trigger_update
call :drain_stdin
exit /b 0
:ensure_deps_inline
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] deps up to date; running ensure-deps

:run_qodersec
if not exist "%CLI%" goto qodersec_missing
"%CLI%" %*
exit /b %ERRORLEVEL%

:qodersec_missing
REM Nothing is installed yet (the async update is still downloading). Stay
REM silent on stdout: the L1 PostToolUse hook fires on every edit, and any byte
REM printed there would land in the model's context over and over.
REM
REM The settings resolver is the single exception. It is the entry point the
REM security-scan skill calls before an L2/L3 review, and it MUST be able to tell
REM "still downloading" apart from "the layer is switched off" - an empty answer
REM would be read as "disabled" and send the user to the settings page instead of
REM asking them to retry. So it gets the settings contract's initializing status.
>> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] skip: qodersec not installed (async update pending) cmd=%~1
call :drain_stdin
if /I not "%~1"=="review" exit /b 0
if /I not "%~2"=="settings" exit /b 0
echo {"status":"initializing","host":"","l2_enabled":false,"l3_enabled":false}
exit /b 0

REM ---- Subroutines ----

REM Hook hosts pipe the event JSON in and expect it to be consumed, so paths that
REM exit without running the binary drain it. cmd cannot ask whether stdin is a
REM console, and `more` on a console waits for input forever, so this is gated on
REM the host-provided QODER_PLUGIN_ROOT: present means a hook pipe, absent means
REM somebody is running the launcher by hand.
:drain_stdin
if not defined QODER_PLUGIN_ROOT exit /b 0
more >nul 2>nul
exit /b 0

:trigger_update
if not "%UPDATE_NEEDED%"=="1" exit /b 1
if "%QODERSEC_SKIP_ASYNC_UPDATE%"=="1" goto trigger_skipped_by_flag
if not exist "%LOCK_DIR%" goto trigger_check_cooldown
set "HEARTBEAT_PATH=%LOCK_DIR%\heartbeat"
if not exist "%HEARTBEAT_PATH%" set "HEARTBEAT_PATH=%LOCK_DIR%"
call :file_is_older_than "%HEARTBEAT_PATH%" "%UPDATE_IN_FLIGHT_MINUTES%"
if errorlevel 1 goto trigger_in_flight
:trigger_check_cooldown
if not exist "%COOLDOWN_FILE%" goto trigger_spawn
call :file_is_older_than "%COOLDOWN_FILE%" "%UPDATE_COOLDOWN_MINUTES%"
if errorlevel 1 goto trigger_in_cooldown

:trigger_spawn
if not exist "%BIN_DIR%qodersec-update.cmd" goto trigger_updater_missing
set "QODERSEC_UPDATE_NEED_BIN=%NEED_BIN%"
set "QODERSEC_UPDATE_NEED_CONFIG=%NEED_CONFIG%"
set "QODERSEC_UPDATE_NEED_QODERCLI=%NEED_QODERCLI%"
REM The updater must not re-derive the target: passing it down is what keeps a
REM local-test exemption (which rewrites TARGET_CLI_VERSION above) effective.
set "QODERSEC_UPDATE_TARGET_VERSION=%TARGET_CLI_VERSION%"
set "QODERSEC_UPDATER_PATH=%BIN_DIR%qodersec-update.cmd"
if "%QODERSEC_UPDATE_SYNC%"=="1" goto trigger_sync
REM Start-Process is a plain cmdlet (ConstrainedLanguage-safe) and detaches the
REM updater without a console window; the path travels via env so no quoting.
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:QODERSEC_UPDATER_PATH -WindowStyle Hidden" >nul 2>nul
if not errorlevel 1 goto trigger_spawned
start "" /b "%QODERSEC_UPDATER_PATH%" >nul 2>nul
:trigger_spawned
>> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] async update spawned bin=%NEED_BIN% config=%NEED_CONFIG% qodercli=%NEED_QODERCLI% current=%INSTALLED_CLI_VERSION% target=%TARGET_CLI_VERSION%
exit /b 0

:trigger_sync
>> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] sync update requested bin=%NEED_BIN% config=%NEED_CONFIG% qodercli=%NEED_QODERCLI% current=%INSTALLED_CLI_VERSION% target=%TARGET_CLI_VERSION%
call "%QODERSEC_UPDATER_PATH%" >> "%_QODERSEC_LOG%" 2>&1
exit /b 0

:trigger_updater_missing
>> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] update skipped: qodersec-update.cmd missing in %BIN_DIR%
exit /b 1

REM Gated skips happen on every edit while an update is in flight; keep them out
REM of the log unless someone is debugging.
:trigger_skipped_by_flag
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] update skipped: QODERSEC_SKIP_ASYNC_UPDATE=1
exit /b 1

:trigger_in_flight
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] update skipped: already in flight
exit /b 1

:trigger_in_cooldown
if "%CODESEC_DEBUG%"=="1" >> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [launcher] update skipped: cooldown active after a failed attempt
exit /b 1

REM %1 = path, %2 = minutes. errorlevel 0 = older than that (or unreadable, so
REM the update is allowed to proceed), 1 = still fresh.
:file_is_older_than
set "QODERSEC_AGE_PATH=%~1"
set "QODERSEC_AGE_MINUTES=%~2"
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $i = Get-Item -LiteralPath $env:QODERSEC_AGE_PATH -ErrorAction Stop } catch { exit 0 }; if (((Get-Date) - $i.LastWriteTime).TotalMinutes -gt [double]$env:QODERSEC_AGE_MINUTES) { exit 0 }; exit 1"
exit /b %ERRORLEVEL%

REM %1 = pin, %2 = installed. errorlevel 0 = the pin is strictly older, so the
REM shared binary must be left alone; 1 = newer, equal, or either side is not an
REM orderable X.Y.Z (a corrupt marker must not freeze the binary forever).
:pin_is_downgrade
set "_PA="&set "_PB="&set "_PC="&set "_PD="
set "_IA="&set "_IB="&set "_IC="&set "_ID="
for /f "usebackq tokens=1-4 delims=." %%a in ('%~1') do set "_PA=%%a"&set "_PB=%%b"&set "_PC=%%c"&set "_PD=%%d"
for /f "usebackq tokens=1-4 delims=." %%a in ('%~2') do set "_IA=%%a"&set "_IB=%%b"&set "_IC=%%c"&set "_ID=%%d"
if defined _PD exit /b 1
if defined _ID exit /b 1
call :is_number "%_PA%" || exit /b 1
call :is_number "%_PB%" || exit /b 1
call :is_number "%_PC%" || exit /b 1
call :is_number "%_IA%" || exit /b 1
call :is_number "%_IB%" || exit /b 1
call :is_number "%_IC%" || exit /b 1
if not "%_PA%"=="%_IA%" goto compare_major
if not "%_PB%"=="%_IB%" goto compare_minor
if %_PC% LSS %_IC% exit /b 0
exit /b 1
:compare_major
if %_PA% LSS %_IA% exit /b 0
exit /b 1
:compare_minor
if %_PB% LSS %_IB% exit /b 0
exit /b 1

REM errorlevel 0 only for a non-empty run of digits; `for /f` yields no token at
REM all when the string consists solely of the delimiters.
:is_number
set "_N=%~1"
if not defined _N exit /b 1
for /f "usebackq delims=0123456789" %%x in ('%_N%') do exit /b 1
exit /b 0

REM Installed qodersec version: the marker bootstrap writes (no process spawn),
REM with the binary itself as fallback for hand-installed builds.
:read_installed_version
set "INSTALLED_CLI_VERSION="
if not exist "%CHOME%\bin\qodersec-version.json" goto read_version_from_binary
for /f "usebackq tokens=2 delims=:" %%V in (`findstr /c:"version" "%CHOME%\bin\qodersec-version.json"`) do (
    set "INSTALLED_CLI_VERSION=%%~V"
    goto normalize_installed_version
)
:normalize_installed_version
if not defined INSTALLED_CLI_VERSION goto read_version_from_binary
set "INSTALLED_CLI_VERSION=%INSTALLED_CLI_VERSION:"=%"
set "INSTALLED_CLI_VERSION=%INSTALLED_CLI_VERSION:,=%"
set "INSTALLED_CLI_VERSION=%INSTALLED_CLI_VERSION: =%"
if defined INSTALLED_CLI_VERSION exit /b 0
:read_version_from_binary
if not exist "%CLI%" exit /b 0
set "VERSION_OUTPUT=%TEMP%\qodersec-version-%RANDOM%-%RANDOM%.tmp"
"%CLI%" version > "%VERSION_OUTPUT%" 2>nul
if errorlevel 1 goto read_version_done
for /f "usebackq tokens=2" %%V in ("%VERSION_OUTPUT%") do set "INSTALLED_CLI_VERSION=%%V"
:read_version_done
del /q "%VERSION_OUTPUT%" >nul 2>nul
exit /b 0

:read_qodercli_marker
set "INSTALLED_QODERCLI_VERSION="
set "INSTALLED_QODERCLI_CHANNEL="
for /f "usebackq tokens=2 delims=:" %%V in (`findstr /c:"version" "%QODERCLI_MARKER%"`) do (
    set "INSTALLED_QODERCLI_VERSION=%%~V"
    goto normalize_qodercli_version
)
:normalize_qodercli_version
if not defined INSTALLED_QODERCLI_VERSION goto read_qodercli_channel
set "INSTALLED_QODERCLI_VERSION=%INSTALLED_QODERCLI_VERSION:"=%"
set "INSTALLED_QODERCLI_VERSION=%INSTALLED_QODERCLI_VERSION:,=%"
set "INSTALLED_QODERCLI_VERSION=%INSTALLED_QODERCLI_VERSION: =%"
:read_qodercli_channel
for /f "usebackq tokens=2 delims=:" %%V in (`findstr /c:"channel" "%QODERCLI_MARKER%"`) do (
    set "INSTALLED_QODERCLI_CHANNEL=%%~V"
    goto normalize_qodercli_channel
)
:normalize_qodercli_channel
if not defined INSTALLED_QODERCLI_CHANNEL exit /b 0
set "INSTALLED_QODERCLI_CHANNEL=%INSTALLED_QODERCLI_CHANNEL:"=%"
set "INSTALLED_QODERCLI_CHANNEL=%INSTALLED_QODERCLI_CHANNEL:,=%"
set "INSTALLED_QODERCLI_CHANNEL=%INSTALLED_QODERCLI_CHANNEL: =%"
exit /b 0

:read_plugin_version
set "PLUGIN_VERSION="
if not exist "%PLUGIN_ROOT%\.qoder-plugin\plugin.json" exit /b 0
for /f "usebackq tokens=2 delims=:" %%V in (`findstr /c:"version" "%PLUGIN_ROOT%\.qoder-plugin\plugin.json"`) do (
    set "PLUGIN_VERSION=%%~V"
    goto normalize_plugin_version
)
:normalize_plugin_version
if not defined PLUGIN_VERSION exit /b 0
set "PLUGIN_VERSION=%PLUGIN_VERSION:"=%"
set "PLUGIN_VERSION=%PLUGIN_VERSION:,=%"
set "PLUGIN_VERSION=%PLUGIN_VERSION: =%"
exit /b 0
REM Unix execution was delegated by the first line; Windows always exits above.
