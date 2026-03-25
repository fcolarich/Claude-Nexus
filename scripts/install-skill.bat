@echo off
REM Install Claude Nexus skill and MCP server into Claude Code
REM Usage: scripts\install-skill.bat

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "CLAUDE_DIR=%USERPROFILE%\.claude"
set "SKILL_DIR=%CLAUDE_DIR%\skills\claude-nexus"
set "SETTINGS_FILE=%CLAUDE_DIR%\settings.json"

echo Installing Claude Nexus skill...

REM 1. Copy skill file
if not exist "%SKILL_DIR%" mkdir "%SKILL_DIR%"
copy /Y "%PROJECT_ROOT%\skills\claude-nexus\SKILL.md" "%SKILL_DIR%\SKILL.md" >nul
echo   Skill installed to %SKILL_DIR%\SKILL.md

REM 2. Register MCP server in settings.json if not already present
if not exist "%SETTINGS_FILE%" echo {} > "%SETTINGS_FILE%"

findstr /C:"claude-nexus" "%SETTINGS_FILE%" >nul 2>&1
if %errorlevel%==0 (
    echo   MCP server already registered in settings.json
) else (
    REM Use node to safely merge into existing JSON
    for %%I in ("%PROJECT_ROOT%") do set "ABS_ROOT=%%~fI"
    set "ABS_ROOT=!ABS_ROOT:\=/!"
    node -e "const fs=require('fs');const p='%SETTINGS_FILE:\=/%';const s=JSON.parse(fs.readFileSync(p,'utf-8'));if(!s.mcpServers)s.mcpServers={};s.mcpServers['claude-nexus']={command:'npx',args:['tsx','!ABS_ROOT!/src/mcp/server.ts']};fs.writeFileSync(p,JSON.stringify(s,null,2)+'\n');"
    echo   MCP server registered in %SETTINGS_FILE%
)

echo.
echo Done! Restart Claude Code to pick up the new MCP server.
echo The claude-nexus skill will be available in all sessions.
