@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM Minimal Windows bootstrap: download one Qoder-style ZIP and install its executable.
REM Runtime dependencies: built-in Windows PowerShell (download) + System32\tar.exe
REM (preferred extractor). Enterprise ConstrainedLanguage mode blocks Expand-Archive
REM method invocation, so extraction prefers tar.exe; Invoke-WebRequest is a plain
REM cmdlet and keeps working there. On old/stripped Windows without tar.exe we fall
REM back to Expand-Archive (works under FullLanguage). Download / extract / verify
REM are separate steps with distinct error messages.

REM Hardcoded home (same as the launcher).
set "CHOME=%USERPROFILE%\.qodersec"

if /I "%QODER_SITE%"=="CN" goto china_site
set "VERSION=%QODERSEC_CLI_VERSION_GLOBAL%"
if not defined VERSION set "VERSION=%CODESEC_CLI_VERSION_GLOBAL%"
set "BUCKET_URL=https://qoder-ide.oss-accelerate.aliyuncs.com/security/qodersec"
goto version_ready
:china_site
set "VERSION=%QODERSEC_CLI_VERSION_CN%"
if not defined VERSION set "VERSION=%CODESEC_CLI_VERSION_CN%"
set "BUCKET_URL=https://static.qoder.com.cn/security/qodersec"
:version_ready
if not defined VERSION echo [bootstrap] ERROR: qodersec CLI version is not set >&2
if not defined VERSION exit /b 1

set "NATIVE_ARCH=%PROCESSOR_ARCHITEW6432%"
if not defined NATIVE_ARCH set "NATIVE_ARCH=%PROCESSOR_ARCHITECTURE%"
if /I "%NATIVE_ARCH%"=="ARM64" set "ARCH=arm64"
if /I "%NATIVE_ARCH%"=="AMD64" set "ARCH=amd64"
if not defined ARCH echo [bootstrap] ERROR: unsupported Windows architecture %NATIVE_ARCH% >&2
if not defined ARCH exit /b 1

set "BIN_DIR=%CHOME%\bin"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%" >nul 2>nul
if not exist "%BIN_DIR%\." echo [bootstrap] ERROR: cannot create %BIN_DIR% >&2
if not exist "%BIN_DIR%\." exit /b 1

set "ARCHIVE_NAME=codesec-cli-windows-%ARCH%.zip"
set "DOWNLOAD=%BIN_DIR%\qodersec.download.zip"
set "MANIFEST=%BIN_DIR%\qodersec.download.manifest.json"
set "EXTRACT_DIR=%BIN_DIR%\qodersec.download"
set "EXTRACTED=%EXTRACT_DIR%\codesec-cli.exe"
set "QODERSEC_DOWNLOAD_URL=%BUCKET_URL%/%VERSION%/%ARCHIVE_NAME%"
set "QODERSEC_MANIFEST_URL=%BUCKET_URL%/%VERSION%/manifest.json"
set "QODERSEC_DOWNLOAD_OUT=%DOWNLOAD%"
set "QODERSEC_MANIFEST_OUT=%MANIFEST%"
set "QODERSEC_ARCHIVE_NAME=%ARCHIVE_NAME%"
set "QODERSEC_EXTRACT_DIR=%EXTRACT_DIR%"
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul

echo [bootstrap] Downloading %QODERSEC_DOWNLOAD_URL%
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"
REM Step 1: download the version manifest and archive. Invoke-WebRequest is
REM ConstrainedLanguage-safe (confirmed in feedback 4bc07021: the download
REM succeeded there, only Expand-Archive failed). Timeouts keep the updater lock
REM from being held forever by a stalled connection.
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri $env:QODERSEC_MANIFEST_URL -OutFile $env:QODERSEC_MANIFEST_OUT"
if errorlevel 1 goto manifest_download_failed
if not exist "%MANIFEST%" goto manifest_download_failed
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing -TimeoutSec 900 -Uri $env:QODERSEC_DOWNLOAD_URL -OutFile $env:QODERSEC_DOWNLOAD_OUT"
if errorlevel 1 goto download_failed
if not exist "%DOWNLOAD%" goto download_failed

REM Step 2: verify the archive against the SHA-256 in the version manifest.
REM Missing/invalid metadata and mismatches all fail closed before extraction.
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Get-Content -Raw -LiteralPath $env:QODERSEC_MANIFEST_OUT | ConvertFrom-Json; if ($m.latest -cne $env:VERSION) { throw 'manifest version mismatch' }; $entries=@($m.files | Where-Object { $_.os -ceq 'windows' -and $_.arch -ceq $env:ARCH -and $_.url -clike ('*/' + $env:QODERSEC_ARCHIVE_NAME) }); if ($entries.Count -ne 1) { throw 'manifest must contain exactly one matching platform archive' }; $e=$entries[0]; if (([string]$e.sha256) -notmatch '^[0-9A-Fa-f]{64}$') { throw ('missing or invalid SHA-256 for ' + $env:QODERSEC_ARCHIVE_NAME) }; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $env:QODERSEC_DOWNLOAD_OUT).Hash; if ($actual -ne ([string]$e.sha256)) { throw ('SHA-256 mismatch for ' + $env:QODERSEC_ARCHIVE_NAME) }"
if errorlevel 1 goto checksum_verification_failed

echo [bootstrap] SHA-256 verified

REM Step 3: extract. Prefer System32 tar.exe (works under ConstrainedLanguage);
REM without tar.exe (old/stripped Windows) fall back to Expand-Archive, which
REM still works under FullLanguage. Either path failing reports extraction failed.
mkdir "%EXTRACT_DIR%" >nul 2>nul
if not exist "%EXTRACT_DIR%\." goto extraction_failed
set "TAR_EXE=%SystemRoot%\System32\tar.exe"
if not exist "%TAR_EXE%" goto ps_extract
echo [bootstrap] Extracting with %TAR_EXE%
"%TAR_EXE%" -xf "%DOWNLOAD%" -C "%EXTRACT_DIR%"
if errorlevel 1 goto extraction_failed
if not exist "%EXTRACTED%" goto extraction_failed
goto extract_done

:ps_extract
echo [bootstrap] tar.exe not found; falling back to PowerShell Expand-Archive
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:QODERSEC_DOWNLOAD_OUT -DestinationPath $env:QODERSEC_EXTRACT_DIR -Force"
if errorlevel 1 goto extraction_failed
if not exist "%EXTRACTED%" goto extraction_failed

:extract_done

REM Step 4: best-effort Mark-of-the-Web unblock; never fails the install.
"%POWERSHELL_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath (Join-Path $env:QODERSEC_EXTRACT_DIR 'codesec-cli.exe') -ErrorAction SilentlyContinue" >nul 2>nul

echo [bootstrap] Verifying %EXTRACTED%
"%EXTRACTED%" version
if errorlevel 1 goto executable_verification_failed
move /y "%EXTRACTED%" "%BIN_DIR%\qodersec.exe" >nul 2>nul
if errorlevel 1 goto install_failed
set "CHANNEL=global"
if /I "%QODER_SITE%"=="CN" set "CHANNEL=cn"
set "VERSION_FILE=%BIN_DIR%\qodersec-version.json"
> "%VERSION_FILE%" echo {
>> "%VERSION_FILE%" echo   "version": "%VERSION%",
>> "%VERSION_FILE%" echo   "channel": "%CHANNEL%",
>> "%VERSION_FILE%" echo   "updated_at": "unknown"
>> "%VERSION_FILE%" echo }
if not exist "%VERSION_FILE%" goto metadata_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul

echo [bootstrap] Done
exit /b 0

:manifest_download_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: manifest download failed >&2
exit /b 1

:download_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: download failed >&2
exit /b 1

:checksum_verification_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: SHA-256 verification failed >&2
exit /b 1

:extraction_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: extraction failed >&2
exit /b 1

:executable_verification_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
echo [bootstrap] ERROR: downloaded executable failed version check >&2
echo [bootstrap] Preserved executable for diagnostics: %EXTRACTED% >&2
exit /b 1

:install_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: cannot replace qodersec.exe; another process may be using it >&2
exit /b 1

:metadata_failed
del /q "%DOWNLOAD%" >nul 2>nul
del /q "%MANIFEST%" >nul 2>nul
rmdir /s /q "%EXTRACT_DIR%" >nul 2>nul
echo [bootstrap] ERROR: cannot write %VERSION_FILE% >&2
exit /b 1
