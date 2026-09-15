param([Parameter(Mandatory=$true)][string]$Ssid, [switch]$Ota, [switch]$SaveTest, [switch]$RestoreTest)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$secret = Get-Content -Raw (Join-Path $project 'LampSecrets.h')
$password = [regex]::Match($secret, 'DEFAULT_ADMIN_PASSWORD "([^"]+)"').Groups[1].Value
if ($env:LAMP_PASSWORD) { $password = $env:LAMP_PASSWORD }
if ($password.Length -lt 8) { throw 'Initial access password missing.' }
$before = (netsh wlan show interfaces) -join "`n"
$profileMatch = [regex]::Match($before, '(?m)^\s*Profile\s*:\s*(.+)$')
if (!$profileMatch.Success) { throw 'Cannot identify the Wi-Fi profile to restore.' }
$previousProfile = $profileMatch.Groups[1].Value.Trim()
$temporaryProfile = 'CoolLamp-Test-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$profilePath = Join-Path $env:TEMP ($temporaryProfile + '.xml')
$escapedPassword = [System.Security.SecurityElement]::Escape($password)
$escapedSsid = [System.Security.SecurityElement]::Escape($Ssid)
$xml = @"
<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>$temporaryProfile</name><SSIDConfig><SSID><name>$escapedSsid</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>$escapedPassword</keyMaterial></sharedKey></security></MSM></WLANProfile>
"@
$added = $false
try {
  Set-Content -LiteralPath $profilePath -Value $xml -Encoding utf8
  netsh wlan add profile filename="$profilePath" user=current | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not add temporary hotspot profile.' }
  $added = $true
  netsh wlan connect name="$temporaryProfile" interface="Wi-Fi"
  if ($LASTEXITCODE -ne 0) { throw 'Could not connect to lamp hotspot.' }
  $nodePath = (Get-Command node).Source
  if ($SaveTest) { & $nodePath (Join-Path $PSScriptRoot 'settings-roundtrip.cjs') }
  elseif ($RestoreTest) { & $nodePath (Join-Path $PSScriptRoot 'settings-roundtrip.cjs') --restore }
  elseif ($Ota) { & $nodePath (Join-Path $PSScriptRoot 'device-check.cjs') --ota }
  else { & $nodePath (Join-Path $PSScriptRoot 'device-check.cjs') }
  if ($LASTEXITCODE -ne 0) { throw 'Live device checks failed.' }
} finally {
  if ($added) {
    netsh wlan connect name="$previousProfile" interface="Wi-Fi"
    netsh wlan delete profile name="$temporaryProfile" interface="Wi-Fi" | Out-Null
  }
  if (Test-Path -LiteralPath $profilePath) { Remove-Item -LiteralPath $profilePath }
}
