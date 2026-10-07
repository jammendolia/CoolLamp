# Dot-source from PowerShell: . .\tools\windows-env.ps1
# Changes only this shell; firmware builds never flash a device.
$lampRoot = Split-Path $PSScriptRoot -Parent
$lampCli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (Test-Path -LiteralPath $lampCli) { $env:ARDUINO_CLI = $lampCli }
$lampTools = @(
    (Join-Path $lampRoot '.build\venv\Scripts'),
    (Join-Path $lampRoot '.build\tooling\w64devkit\bin')
) | Where-Object { Test-Path -LiteralPath $_ }
$env:PATH = ($lampTools + @($env:PATH)) -join ';'
$env:PYTHONIOENCODING = 'utf-8'
