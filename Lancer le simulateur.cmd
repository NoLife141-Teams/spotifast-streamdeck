@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\@elgato\streamdeck\package.json" (
  echo Installe les dependances avec npm ci, puis relance ce fichier.
  pause
  exit /b 1
)
call npm run simulator -- --open
if errorlevel 1 pause
