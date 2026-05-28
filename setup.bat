@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title YouTube Downloader Desktop — Installation

echo ============================================
echo   YouTube Downloader Desktop - Setup
echo ============================================
echo.

:: ── Node.js ──────────────────────────────────
echo [1/4] Verification de Node.js...
set "NPM=npm"

where node >nul 2>&1
if %errorlevel% equ 0 (
  echo [1/4] Node.js detecte.
  goto :NPM_INSTALL
)

echo [1/4] Node.js non detecte. Telechargement en cours...
curl -L "https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi" -o "%TEMP%\node_installer.msi"
if %errorlevel% neq 0 (
  echo ERREUR: Impossible de telecharger Node.js. Verifie ta connexion internet.
  pause
  exit /b 1
)
msiexec /i "%TEMP%\node_installer.msi" /quiet /norestart
del "%TEMP%\node_installer.msi" >nul 2>&1
echo [1/4] Node.js installe.

:: Chercher npm.cmd — le PATH n'est pas mis a jour dans la session courante
set "NPM="
set "PF86=%ProgramFiles(x86)%"

:: 1. Emplacements courants (rapide)
if exist "%ProgramFiles%\nodejs\npm.cmd"                     set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if "!NPM!"=="" if exist "!PF86!\nodejs\npm.cmd"              set "NPM=!PF86!\nodejs\npm.cmd"
if "!NPM!"=="" if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if "!NPM!"=="" if exist "%APPDATA%\npm\npm.cmd"              set "NPM=%APPDATA%\npm\npm.cmd"
if not "!NPM!"=="" goto :GOT_NPM

:: 2. Recherche approfondie : cle registre Node.js + PATH systeme + scan dossiers
set "PS1=%TEMP%\ytdl_findnpm_%RANDOM%.ps1"
echo $r = '' > "!PS1!"
echo try { $r = (Get-ItemProperty 'HKLM:\SOFTWARE\Node.js' -EA Stop).InstallPath.TrimEnd('\') + '\npm.cmd' } catch {} >> "!PS1!"
echo if (-not $r) { try { $r = (Get-ItemProperty 'HKCU:\SOFTWARE\Node.js' -EA Stop).InstallPath.TrimEnd('\') + '\npm.cmd' } catch {} } >> "!PS1!"
echo if ($r -and (Test-Path $r)) { $r; exit } >> "!PS1!"
echo $m = [System.Environment]::GetEnvironmentVariable('PATH','Machine') >> "!PS1!"
echo $u = [System.Environment]::GetEnvironmentVariable('PATH','User') >> "!PS1!"
echo foreach ($d in ($m + ';' + $u).Split(';')) { >> "!PS1!"
echo     if ($d.Trim() -eq '') { continue } >> "!PS1!"
echo     $f = Join-Path $d.Trim() 'npm.cmd' >> "!PS1!"
echo     if (Test-Path $f) { $f; exit } >> "!PS1!"
echo } >> "!PS1!"
echo $dirs = @('C:\Program Files', 'C:\Program Files (x86)', $env:LOCALAPPDATA, $env:APPDATA) >> "!PS1!"
echo $h = @(Get-ChildItem -Path $dirs -Filter 'npm.cmd' -Recurse -Depth 4 -EA SilentlyContinue) >> "!PS1!"
echo if ($h.Count -gt 0) { $h[0].FullName } >> "!PS1!"
for /f "usebackq delims=" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" 2^>nul`) do set "NPM=%%p"
del "!PS1!" >nul 2>&1

:GOT_NPM
if "!NPM!"=="" (
  echo ERREUR: npm introuvable apres installation.
  echo Redemarre ton PC puis relance setup.bat.
  pause
  exit /b 1
)
echo    npm trouve : !NPM!

:NPM_INSTALL
:: ── npm install ───────────────────────────────
echo [2/4] Installation des dependances (Electron + Express)...
if "!NPM!"=="npm" (
  call npm install
) else (
  call "!NPM!" install
)
if %errorlevel% neq 0 (
  echo.
  echo ERREUR: npm install a echoue.
  echo Ferme cette fenetre et relance setup.bat.
  pause
  exit /b 1
)
echo [2/4] Dependances installees.

:: ── yt-dlp.exe ───────────────────────────────
if not exist "%~dp0yt-dlp.exe" (
  echo [3/4] Telechargement de yt-dlp...
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "%~dp0yt-dlp.exe"
  if %errorlevel% neq 0 (
    echo ERREUR: Impossible de telecharger yt-dlp.
    pause
    exit /b 1
  )
  echo [3/4] yt-dlp installe.
) else (
  echo [3/4] yt-dlp deja present.
)

:: ── ffmpeg ───────────────────────────────────
if not exist "%~dp0bin\ffmpeg.exe" (
  echo [4/4] Telechargement de ffmpeg ^(peut prendre 1-2 min^)...
  mkdir "%~dp0bin" 2>nul
  curl -L "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -o "%TEMP%\ffmpeg.zip"
  if %errorlevel% neq 0 (
    echo ERREUR: Impossible de telecharger ffmpeg.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\ffmpeg.zip' -DestinationPath '%TEMP%\ffmpeg_extracted' -Force"
  for /r "%TEMP%\ffmpeg_extracted" %%f in (ffmpeg.exe)  do copy "%%f" "%~dp0bin\ffmpeg.exe"  >nul
  for /r "%TEMP%\ffmpeg_extracted" %%f in (ffprobe.exe) do copy "%%f" "%~dp0bin\ffprobe.exe" >nul
  del /f /q "%TEMP%\ffmpeg.zip" >nul 2>&1
  rmdir /s /q "%TEMP%\ffmpeg_extracted" >nul 2>&1
  echo [4/4] ffmpeg installe.
) else (
  echo [4/4] ffmpeg deja present.
)

:: ── Raccourci Bureau ─────────────────────────
echo Creation du raccourci sur le Bureau...
powershell -NoProfile -Command "$dir = '%~dp0'.TrimEnd('\'); $sh = New-Object -Com WScript.Shell; $sc = $sh.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\YouTube Downloader.lnk'); $sc.TargetPath = 'wscript.exe'; $sc.Arguments = '\"' + $dir + '\Demarrer.vbs\"'; $sc.IconLocation = $dir + '\public\icon.ico,0'; $sc.WorkingDirectory = $dir; $sc.Description = 'YouTube Downloader'; $sc.Save()"
echo Raccourci cree sur le Bureau.

echo.
echo ============================================
echo   Installation terminee !
echo   Un raccourci a ete cree sur ton Bureau.
echo   Double-clique dessus pour lancer l'appli.
echo ============================================
echo.
pause
