Set WshShell = CreateObject("WScript.Shell")

' Start API server silently (if not already running)
Dim apiCheck
Set apiCheck = WshShell.Exec("cmd /c netstat -aon | findstr :3210 | findstr LISTENING")
Dim apiOutput
apiOutput = apiCheck.StdOut.ReadAll()

If Len(Trim(apiOutput)) = 0 Then
    WshShell.CurrentDirectory = "C:\Fran\claude-nexus"
    WshShell.Run "npx tsx src/web/server.ts", 0, False
    WScript.Sleep 2000
End If

' Launch Tauri app (prefer release build, fallback to debug)
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
If fso.FileExists("C:\Fran\claude-nexus\src-tauri\target\release\Claude Nexus.exe") Then
    WshShell.Run """C:\Fran\claude-nexus\src-tauri\target\release\Claude Nexus.exe""", 1, False
ElseIf fso.FileExists("C:\Fran\claude-nexus\src-tauri\target\release\app.exe") Then
    WshShell.Run """C:\Fran\claude-nexus\src-tauri\target\release\app.exe""", 1, False
Else
    WshShell.Run """C:\Fran\claude-nexus\src-tauri\target\debug\app.exe""", 1, False
End If
