@echo off
schtasks /create /tn "ClaudeNexusAPI" /tr "wscript.exe \"C:\Fran\claude-nexus\scripts\start-api.vbs\"" /sc onlogon /rl highest /f
if %errorlevel% equ 0 (
    echo Task registered successfully. Claude Nexus API will start at logon.
) else (
    echo Failed to register task. Try running as administrator.
)
pause
