@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM qodersec-update.cmd — Background dependency updater (Windows).
REM
REM Spawned hidden by qodersec-launch.cmd so that no hook ever blocks on a
REM download. The launcher owns the decision (which steps are needed, which
REM version is the target) and passes it in via QODERSEC_UPDATE_*; this script
REM only executes, in dependency order, and never lets a later step's failure
REM undo an earlier one:
REM
REM   1. qodersec.exe (bootstrap.cmd)   — hard prerequisite: failure stops here
REM   2. config.yaml + .config-version  — only once the binary is at target
REM   3. qodercli (qodersec ensure-deps)— failure is logged, nothing else breaks
REM
REM Concurrency: one lock directory guards the whole run. A lock with no live
REM updater process behind it is reclaimed immediately — age alone is never the
REM criterion, so an updater killed with its session never blocks the next one.
REM Keep this file CRLF-terminated like every other batch file in bin/.

set "SCRIPT_DIR=%~dp0"
set "PLUGIN_ROOT=%QODER_PLUGIN_ROOT%"
if not defined PLUGIN_ROOT set "PLUGIN_ROOT=%SCRIPT_DIR%.."

if defined QODERSEC_HOME goto use_qodersec_home
if defined CODESEC_HOME goto use_codesec_home
set "CHOME=%USERPROFILE%\.qodersec"
goto home_ready
:use_qodersec_home
set "CHOME=%QODERSEC_HOME%"
goto home_ready
:use_codesec_home
set "CHOME=%CODESEC_HOME%"
:home_ready

set "QODERSEC_HOME=%CHOME%"
set "CODESEC_HOME=%CHOME%"
if not defined CODESEC_LOG_NAME set "CODESEC_LOG_NAME=qodersec"
set "BIN_DIR=%CHOME%\bin"
set "CLI=%BIN_DIR%\qodersec.exe"
set "STATE_DIR=%CHOME%\state"
set "LOCK_DIR=%STATE_DIR%\qodersec-update.lock"
set "COOLDOWN_FILE=%STATE_DIR%\qodersec-update.cooldown"
set "_QODERSEC_LOG=%CHOME%\logs\qodersec.log"
REM Only used when process liveness cannot be determined at all.
set "HEARTBEAT_STALE_MINUTES=10"
if not exist "%CHOME%\logs" mkdir "%CHOME%\logs" >nul 2>nul
if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>nul

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"

set "NEED_BIN=%QODERSEC_UPDATE_NEED_BIN%"
if not defined NEED_BIN set "NEED_BIN=0"
set "NEED_CONFIG=%QODERSEC_UPDATE_NEED_CONFIG%"
if not defined NEED_CONFIG set "NEED_CONFIG=0"
set "NEED_QODERCLI=%QODERSEC_UPDATE_NEED_QODERCLI%"
if not defined NEED_QODERCLI set "NEED_QODERCLI=0"
REM The launcher is the single decision point: it resolved the target version
REM (including any local-test exemption), so we never re-derive it here.
set "TARGET_CLI_VERSION=%QODERSEC_UPDATE_TARGET_VERSION%"
if not "%NEED_BIN%"=="1" goto target_ready
if defined TARGET_CLI_VERSION goto target_ready
call :log "abort: launcher passed no target version (QODERSEC_UPDATE_TARGET_VERSION)"
exit /b 0
:target_ready

call :acquire_lock
if errorlevel 1 exit /b 0
> "%LOCK_DIR%\target" echo %TARGET_CLI_VERSION%
call :beat

call :log "start target=%TARGET_CLI_VERSION% needs bin=%NEED_BIN% config=%NEED_CONFIG% qodercli=%NEED_QODERCLI%"

REM ---- Step 1: qodersec.exe. Everything below depends on it, so a failure
REM      here stops the run instead of advancing dependents.
if not "%NEED_BIN%"=="1" goto step_config
call :beat
call :read_installed_version
call :log "step=qodersec status=start current=%INSTALLED_CLI_VERSION% target=%TARGET_CLI_VERSION%"
if not exist "%SCRIPT_DIR%bootstrap.cmd" goto qodersec_no_bootstrap
REM The launcher's target wins over the raw pins, so an exempted local build
REM can never be replaced by a released one.
if /I "%QODER_SITE%"=="CN" goto pin_cn
set "QODERSEC_CLI_VERSION_GLOBAL=%TARGET_CLI_VERSION%"
goto pin_ready
:pin_cn
set "QODERSEC_CLI_VERSION_CN=%TARGET_CLI_VERSION%"
:pin_ready
call "%SCRIPT_DIR%bootstrap.cmd" >> "%_QODERSEC_LOG%" 2>&1
if errorlevel 1 goto qodersec_failed
call :read_installed_version
if not "%INSTALLED_CLI_VERSION%"=="%TARGET_CLI_VERSION%" goto qodersec_verification_failed
call :log "step=qodersec status=ok version=%INSTALLED_CLI_VERSION%"
goto step_config

:qodersec_no_bootstrap
call :log "step=qodersec status=failed reason=bootstrap.cmd missing in %SCRIPT_DIR%"
call :mark_cooldown
goto finish

:qodersec_failed
call :log "step=qodersec status=failed reason=bootstrap error target=%TARGET_CLI_VERSION%"
call :mark_cooldown
goto finish

:qodersec_verification_failed
call :log "step=qodersec status=failed reason=bootstrap verification failed current=%INSTALLED_CLI_VERSION% target=%TARGET_CLI_VERSION%"
call :mark_cooldown
goto finish

REM ---- Step 2: persistent config, only now that the binary is at target. A
REM      copy failure is local and must not hold back the qodercli step.
:step_config
if not "%NEED_CONFIG%"=="1" goto step_qodercli
call :beat
call :read_plugin_version
set "TEMPLATE="
if exist "%PLUGIN_ROOT%\config.yaml" set "TEMPLATE=%PLUGIN_ROOT%\config.yaml"
if not defined TEMPLATE if exist "%PLUGIN_ROOT%\config.yaml.example" set "TEMPLATE=%PLUGIN_ROOT%\config.yaml.example"
if not defined TEMPLATE goto config_failed
copy /y "%TEMPLATE%" "%CHOME%\config.yaml" >nul 2>nul
if errorlevel 1 goto config_failed
if defined PLUGIN_VERSION > "%CHOME%\.config-version" echo %PLUGIN_VERSION%
call :log "step=config status=ok plugin_version=%PLUGIN_VERSION%"
goto step_qodercli

:config_failed
call :log "step=config status=failed reason=no readable template under %PLUGIN_ROOT%"
goto step_qodercli

REM ---- Step 3: qodercli. Always run once the binary is available: ensure-deps
REM      skips the network when qodercli already matches the pin, and it is what
REM      initialises the manual-review coverage baseline.
:step_qodercli
if not exist "%CLI%" goto qodercli_missing
call :beat
call :log "step=qodercli status=start need=%NEED_QODERCLI%"
"%CLI%" ensure-deps --hook-event SessionStart >> "%_QODERSEC_LOG%" 2>&1
if errorlevel 1 goto qodercli_failed
call :log "step=qodercli status=ok"
del /q "%COOLDOWN_FILE%" >nul 2>nul
call :log "done target=%TARGET_CLI_VERSION%"
goto finish

:qodercli_failed
call :log "step=qodercli status=failed"
call :mark_cooldown
goto finish

:qodercli_missing
call :log "step=qodercli status=skipped reason=qodersec.exe missing"
call :mark_cooldown
goto finish

:finish
rmdir /s /q "%LOCK_DIR%" >nul 2>nul
exit /b 0

REM ---- Subroutines ----

:log
>> "%_QODERSEC_LOG%" echo [%DATE% %TIME%] [updater] %~1
exit /b 0

:beat
> "%LOCK_DIR%\heartbeat" echo.
exit /b 0

:mark_cooldown
> "%COOLDOWN_FILE%" echo %DATE% %TIME%
exit /b 0

:acquire_lock
mkdir "%LOCK_DIR%" >nul 2>nul
if not errorlevel 1 exit /b 0
call :updater_is_running
set "LOCK_LIVENESS=%ERRORLEVEL%"
if "%LOCK_LIVENESS%"=="0" goto lock_running
if "%LOCK_LIVENESS%"=="1" goto lock_orphaned
call :heartbeat_is_stale
if errorlevel 1 goto lock_unknown_fresh
call :log "lock orphaned: liveness unknown, heartbeat older than %HEARTBEAT_STALE_MINUTES%m; reclaimed"
goto lock_reclaim

:lock_running
call :heartbeat_is_stale
if errorlevel 1 goto lock_running_fresh
REM Never kill somebody else's download; bounded by the bootstrap timeouts.
call :log "lock held but heartbeat stale; leaving it alone"
exit /b 1
:lock_running_fresh
call :log "busy: updater already running"
exit /b 1

:lock_unknown_fresh
call :log "busy: lock held, liveness unknown and heartbeat fresh"
exit /b 1

:lock_orphaned
call :log "lock orphaned: no updater process; reclaimed"

:lock_reclaim
rmdir /s /q "%LOCK_DIR%" >nul 2>nul
mkdir "%LOCK_DIR%" >nul 2>nul
if not errorlevel 1 exit /b 0
call :log "busy: lost the race to reclaim the lock"
exit /b 1

REM Is an updater process actually doing something? That is the only question a
REM held lock can be judged by; elapsed time proves nothing. The match is on the
REM command line rather than a recorded PID, so a killed updater is detected
REM even when it never got to clean up. Our own cmd.exe is part of the match,
REM hence a second one is what proves somebody else is working.
REM   0 = running, 1 = not running, 2 = cannot tell
:updater_is_running
set "QODERSEC_LIVENESS_MIN=2"
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $p = @(Get-CimInstance Win32_Process -ErrorAction Stop) } catch { try { $p = @(Get-WmiObject Win32_Process -ErrorAction Stop) } catch { exit 2 } }; $m = @($p | Where-Object { $_.CommandLine -like '*qodersec-update.cmd*' }).Count; if ($m -ge [int]$env:QODERSEC_LIVENESS_MIN) { exit 0 }; exit 1"
exit /b %ERRORLEVEL%

REM 0 = stale (nobody refreshed it), 1 = fresh or unreadable.
:heartbeat_is_stale
set "QODERSEC_LOCK_PATH=%LOCK_DIR%\heartbeat"
if not exist "%QODERSEC_LOCK_PATH%" set "QODERSEC_LOCK_PATH=%LOCK_DIR%"
set "QODERSEC_STALE_MINUTES=%HEARTBEAT_STALE_MINUTES%"
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $i = Get-Item -LiteralPath $env:QODERSEC_LOCK_PATH -ErrorAction Stop } catch { exit 1 }; if (((Get-Date) - $i.LastWriteTime).TotalMinutes -gt [double]$env:QODERSEC_STALE_MINUTES) { exit 0 }; exit 1"
exit /b %ERRORLEVEL%

REM Installed qodersec version: the marker bootstrap writes first, the binary
REM itself only as a fallback for hand-installed builds.
:read_installed_version
set "INSTALLED_CLI_VERSION="
if not exist "%BIN_DIR%\qodersec-version.json" goto read_version_from_binary
for /f "usebackq tokens=2 delims=:" %%V in (`findstr /c:"version" "%BIN_DIR%\qodersec-version.json"`) do (
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
