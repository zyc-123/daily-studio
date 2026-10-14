@echo off
:: Daily Studio — Install Startup Entry
:: Creates a shortcut in the Windows Startup folder so the server
:: runs automatically (hidden) when you log in.

set "VBS_PATH=%~dp0start-server.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Daily Studio Server.lnk"

echo Installing Daily Studio auto-start...
echo.

:: Create the shortcut using PowerShell (reliable .lnk creation)
powershell -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%VBS_PATH%'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Daily Studio local server'; $s.Save()"

if %ERRORLEVEL% EQU 0 (
  echo Done!  Daily Studio will start automatically on next login.
  echo.
  echo Shortcut created at: %SHORTCUT%
  echo Target: %VBS_PATH%
  echo.
  echo Run install-startup.bat to remove it.
) else (
  echo Failed to create shortcut. Try running as Administrator.
)

pause
