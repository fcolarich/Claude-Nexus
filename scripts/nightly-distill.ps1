# Wrapper for the nightly scheduled distill sweep.
#
# Run via `pwsh -NonInteractive -NoProfile -File` rather than an inline -Command:
# Task Scheduler delivers a console control signal to powershell.exe when it hosts
# a long-running native process, killing the child with STATUS_CONTROL_C_EXIT
# (0xC000013A). pwsh + -NonInteractive + an explicit `exit 0` avoids that.
#
# The sweep itself parks until the GPU is free and stops at a chunk boundary when
# its time budget runs out, so this wrapper stays dumb on purpose.

Set-Location -LiteralPath 'C:\Fran\claude-nexus'

$logDir = Join-Path (Get-Location) '.flow\distill-logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir ("sweep-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmm'))

& node scripts/distill-sweep.mjs `
	--limit 300 `
	--merge-model gemma3:12b `
	--max-chunks 60 `
	--min-free-vram 4000 `
	--vram-poll 300 `
	--max-runtime-min 360 *>&1 | Out-File -FilePath $log -Encoding utf8

# Prune logs older than 30 days so the directory does not grow without bound.
Get-ChildItem $logDir -Filter 'sweep-*.log' -ErrorAction SilentlyContinue |
	Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
	Remove-Item -Force -ErrorAction SilentlyContinue

# Always succeed: a non-zero exit would show as a task failure even when the sweep
# stopped for a legitimate reason (time budget, GPU never freed).
exit 0
