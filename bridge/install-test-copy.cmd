@echo off
setlocal
if "%PIS_BRIDGE_TOKEN%"=="" (
  echo Set PIS_BRIDGE_TOKEN to a random value of at least 24 characters.
  exit /b 1
)
if not exist test-data mkdir test-data
if exist "test-data\Homeopathy-source.mdb" (
  copy /y "test-data\Homeopathy-source.mdb" "test-data\Homeopathy-test.mdb" >nul
) else if exist "..\Homeopathy.mdb" (
  copy /y "..\Homeopathy.mdb" "test-data\Homeopathy-test.mdb" >nul
) else (
  echo Could not find test-data\Homeopathy-source.mdb or ..\Homeopathy.mdb
  exit /b 1
)
PisBridge.exe --db "test-data\Homeopathy-test.mdb" --token "%PIS_BRIDGE_TOKEN%" --install-schema
if errorlevel 1 exit /b 1
echo Test database prepared. The live Homeopathy.mdb was not changed.
