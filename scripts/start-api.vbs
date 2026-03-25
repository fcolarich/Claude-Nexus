Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Fran\claude-nexus"
WshShell.Run "npx tsx src/web/server.ts", 0, False
