@echo off
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo .NET Framework 4 compiler was not found.
  exit /b 1
)
"%CSC%" /nologo /optimize+ /target:exe /platform:x86 /out:PisBridge.exe ^
  /reference:System.dll /reference:System.Data.dll /reference:System.Runtime.Serialization.dll PisBridge.cs
if errorlevel 1 exit /b 1
echo Built PisBridge.exe
