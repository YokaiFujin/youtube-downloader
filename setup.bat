@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title YouTube Downloader Desktop — Installation

echo ============================================
echo   YouTube Downloader Desktop - Setup
echo ============================================
echo.

:: ── Node.js ──────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [1/4] Node.js non detecte. Telechargement...
  curl -L "https://nodejs.org/dist/v22.13.0/node-v22.13.0-x64.msi" -o "%TEMP%\node_installer.msi"
  msiexec /i "%TEMP%\node_installer.msi" /quiet /norestart
  del "%TEMP%\node_installer.msi"
  echo [1/4] Node.js installe.
) else (
  echo [1/4] Node.js detecte.
)

:: ── npm install ───────────────────────────────
:: Rafraichit le PATH depuis le registre pour trouver npm meme apres
:: une installation fraiche de Node.js dans la meme session CMD
echo [2/4] Installation des dependances (Electron + Express)...
powershell -NoProfile -Command "$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User'); npm install; exit $LASTEXITCODE"
if %errorlevel% neq 0 (
  echo ERREUR: npm install a echoue.
  pause
  exit /b 1
)
echo [2/4] Dependances installees.

:: ── yt-dlp.exe ───────────────────────────────
if not exist "%~dp0yt-dlp.exe" (
  echo [3/4] Telechargement de yt-dlp...
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "%~dp0yt-dlp.exe"
  echo [3/4] yt-dlp installe.
) else (
  echo [3/4] yt-dlp deja present.
)

:: ── ffmpeg ───────────────────────────────────
if not exist "%~dp0bin\ffmpeg.exe" (
  echo [4/4] Telechargement de ffmpeg...
  mkdir "%~dp0bin" 2>nul
  curl -L "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -o "%TEMP%\ffmpeg.zip"
  powershell -Command "Expand-Archive -Path '%TEMP%\ffmpeg.zip' -DestinationPath '%TEMP%\ffmpeg_extracted' -Force"
  for /r "%TEMP%\ffmpeg_extracted" %%f in (ffmpeg.exe) do copy "%%f" "%~dp0bin\ffmpeg.exe" >nul
  for /r "%TEMP%\ffmpeg_extracted" %%f in (ffprobe.exe) do copy "%%f" "%~dp0bin\ffprobe.exe" >nul
  del "%TEMP%\ffmpeg.zip"
  rmdir /s /q "%TEMP%\ffmpeg_extracted"
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
