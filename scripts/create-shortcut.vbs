Set WshShell = CreateObject("WScript.Shell")
Set shortcut = WshShell.CreateShortcut(WshShell.SpecialFolders("Desktop") & "\Claude Nexus.lnk")
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = """C:\Fran\claude-nexus\scripts\launch-nexus.vbs"""
shortcut.WorkingDirectory = "C:\Fran\claude-nexus"
shortcut.IconLocation = "C:\Fran\claude-nexus\src-tauri\icons\icon.ico,0"
shortcut.Description = "Claude Nexus - Session Monitor & Memory Browser"
shortcut.Save
WScript.Echo "Desktop shortcut created!"
