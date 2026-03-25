@echo off
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP%\ClaudeNexusAPI.vbs

copy "C:\Fran\claude-nexus\scripts\start-api.vbs" "%SHORTCUT%"
if %errorlevel% equ 0 (
    echo Startup entry created at: %SHORTCUT%
    echo Claude Nexus API will start automatically at logon.
) else (
    echo Failed to copy to startup folder.
)
pause
