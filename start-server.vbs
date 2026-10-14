' Daily Studio — Hidden Server Launcher
' Runs node server.js without a visible terminal window.
' Place a shortcut to this file in shell:startup to auto-start on boot.

Dim Shell, projectDir
Set Shell = CreateObject("WScript.Shell")

' Change to the project directory so server.js can find its files
projectDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Shell.CurrentDirectory = projectDir

' Run node server.js hidden (window style 0 = hidden)
Shell.Run "node server.js", 0, False

Set Shell = Nothing
