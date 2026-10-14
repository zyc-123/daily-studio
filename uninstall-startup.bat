@echo off
:: Daily Studio — Remove Startup Entry

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Daily Studio Server.lnk"

if exist "%SHORTCUT%" (
  del "%SHORTCUT%"
  echo Removed auto-start entry. Daily Studio will no longer start on boot.
) else (
  echo No startup entry found.
)

pause
