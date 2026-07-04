@echo off
setlocal
if "%PIS_BRIDGE_TOKEN%"=="" (
  echo Set PIS_BRIDGE_TOKEN to a random value of at least 24 characters.
  exit /b 1
)
PisBridge.exe --db "test-data\Homeopathy-test.mdb" --token "%PIS_BRIDGE_TOKEN%" --port 8765
