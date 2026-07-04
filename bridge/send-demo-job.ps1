if (-not $env:PIS_BRIDGE_TOKEN) {
    throw "Set PIS_BRIDGE_TOKEN first."
}

$body = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "demo-create-patient.json"))
$client = New-Object System.Net.WebClient
$client.Headers.Add("Authorization", "Bearer " + $env:PIS_BRIDGE_TOKEN)
$client.Headers.Add("Content-Type", "application/json")
$client.UploadString("http://127.0.0.1:8765/v1/jobs/apply", "POST", $body)
