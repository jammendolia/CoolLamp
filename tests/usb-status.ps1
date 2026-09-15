param([string]$Command = '?')
$port = [System.IO.Ports.SerialPort]::new('COM3',115200)
$port.DtrEnable = $true
$port.ReadTimeout = 500
try {
  $port.Open()
  $port.Write($Command)
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while ($timer.ElapsedMilliseconds -lt 8000) {
    try { $line=$port.ReadLine(); Write-Output $line; if($line -match 'reset=') { break } } catch [System.TimeoutException] {}
  }
} finally { if($port.IsOpen) { $port.Close() }; $port.Dispose() }
