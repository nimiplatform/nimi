@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-go-test-exec-signer.ps1" %*
exit /b %ERRORLEVEL%
