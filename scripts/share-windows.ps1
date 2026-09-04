# KITSUNE - open this machine up so a friend on the same Wi-Fi can join your run.
#
#   Right-click PowerShell -> "Run as Administrator", then:
#     cd C:\Users\<you>\Running-Game
#     .\scripts\share-windows.ps1
#
# It checks the server is up, opens the port, and prints the exact link to send.
# Undo it all afterwards with:  .\scripts\share-windows.ps1 -Remove
#
# Keep this file plain ASCII. Windows PowerShell 5.1 reads a BOM-less script in the
# system ANSI codepage, so a stray em dash or arrow turns into mojibake that can
# swallow a quote and break parsing several lines later.

param(
  [int]$Port = 8080,
  [string]$Room = 'fuji',
  [switch]$Remove
)

$rule = "KITSUNE $Port"
function Say($m)  { Write-Host $m }
function Ok($m)   { Write-Host "  OK    $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  FAIL  $m" -ForegroundColor Red }
function Note($m) { Write-Host "        $m" -ForegroundColor DarkGray }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Remove) {
  if (-not $admin) { Bad "Removing the rule needs an Administrator PowerShell."; exit 1 }
  Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
  Ok "Firewall rule '$rule' removed. Your machine is closed again."
  exit 0
}

Say ""
Say "KITSUNE - sharing this machine on the local network"
Say "---------------------------------------------------"

# 1. Is the game server actually running, and listening on every interface?
$listen = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if (-not $listen) {
  Bad "Nothing is listening on port $Port."
  Note "Start the game first, in its own window:   npm run dev"
  Note "Then run this script again."
  exit 1
}
$onAll = $listen | Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
if ($onAll) {
  Ok "The game server is listening on port $Port (all interfaces)."
} else {
  Bad "Port $Port is bound only to $($listen[0].LocalAddress), which a friend cannot reach."
  Note "Stop it (Ctrl+C) and start it again with:  npm run dev"
  exit 1
}

# 2. Open the port, whatever profile Windows has decided this network is.
if (-not $admin) {
  Bad "Not running as Administrator, so the firewall cannot be opened."
  Note "Close this window. Right-click PowerShell -> Run as Administrator, cd back here, run this again."
  exit 1
}
Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $rule -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow -Profile Any | Out-Null
Ok "Firewall opened for TCP $Port (rule '$rule', every network profile)."

foreach ($p in Get-NetConnectionProfile) { Note "network '$($p.Name)' is category $($p.NetworkCategory)" }

# 3. Work out which address to hand over. Skip loopback, APIPA, and the CGNAT range
#    100.64.0.0/10 (Tailscale and some VPNs), which is no use to someone on your Wi-Fi.
$addrs = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { -not $_.IPAddress.StartsWith('127.') -and -not $_.IPAddress.StartsWith('169.254.') } |
  ForEach-Object {
    $second = [int]($_.IPAddress.Split('.')[1])
    $cgnat = $_.IPAddress.StartsWith('100.') -and $second -ge 64 -and $second -le 127
    [pscustomobject]@{ IP = $_.IPAddress; Nic = $_.InterfaceAlias; Lan = (-not $cgnat) }
  }

$lan = @($addrs | Where-Object { $_.Lan })
$vpn = @($addrs | Where-Object { -not $_.Lan })

Say ""
if ($lan.Count -eq 0) {
  Bad "No ordinary LAN address found. Are you connected to Wi-Fi?"
} else {
  Say "Send your friend this link:"
  Say ""
  foreach ($a in $lan) {
    Write-Host "    http://$($a.IP):$Port/?coop=$Room" -ForegroundColor Cyan -NoNewline
    Write-Host "   ($($a.Nic))" -ForegroundColor DarkGray
  }
  Say ""
  Note "They must be on the same Wi-Fi. Their ipconfig should show the same first three numbers."
  Note "You open the very same link. Both hit RUN TOGETHER."
}

if ($vpn.Count -gt 0) {
  Say ""
  foreach ($a in $vpn) { Note "ignoring $($a.IP) ($($a.Nic)): VPN/Tailscale range, no use to someone on your Wi-Fi" }
  Note "If a VPN is connected it may also be blocking LAN traffic. Disconnect it if this still fails."
}

Say ""
if ($lan.Count -gt 0) { Note "Have your friend check it reaches you:   Test-NetConnection $($lan[0].IP) -Port $Port" }
Note "When you are done playing:               .\scripts\share-windows.ps1 -Remove"
Say ""
