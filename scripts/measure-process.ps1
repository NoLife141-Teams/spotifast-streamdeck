# Read-only resource sampler. Supply the verified plugin process ID; never starts or stops a process.
param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ProcessId,
  [ValidateRange(2,3600)][int]$Seconds = 60,
  [ValidateSet('playing','paused','offline')][string]$Playback = 'playing',
  [ValidateSet(1,4,16)][int]$ArtworkKeys = 1,
  [string]$Output = 'process-baseline.json'
)
$ErrorActionPreference = 'Stop'
$target = Get-Process -Id $ProcessId
$identity = $target.StartTime.ToUniversalTime()
$initialCpu = $target.TotalProcessorTime.TotalMilliseconds
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$samples = @()
while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
  Start-Sleep -Milliseconds 250
  $current = Get-Process -Id $ProcessId
  if ($current.StartTime.ToUniversalTime() -ne $identity) { throw 'Process identity changed; measurement discarded.' }
  $samples += [ordered]@{ elapsedMs = $clock.Elapsed.TotalMilliseconds; cpuMs = $current.TotalProcessorTime.TotalMilliseconds - $initialCpu; workingSetBytes = $current.WorkingSet64; privateBytes = $current.PrivateMemorySize64 }
}
$clock.Stop()
$report = [ordered]@{
  schemaVersion = 1; mode = 'windows-selected-process'; playback = $Playback; artworkKeys = $ArtworkKeys
  elapsedMs = $clock.Elapsed.TotalMilliseconds
  cpuPercentOneCore = 100 * ($samples[-1].cpuMs / $clock.Elapsed.TotalMilliseconds)
  peakWorkingSetBytes = ($samples | Measure-Object workingSetBytes -Maximum).Maximum
  peakPrivateBytes = ($samples | Measure-Object privateBytes -Maximum).Maximum
  limitation = 'Selected process only; excludes Spotifast, Stream Deck host and short-lived CLI children. No hardware button-to-display latency measurement.'
  samples = $samples
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Output "Saved resource measurements to $Output"
