@echo off
chcp 65001 >nul
node "%~dp0tauri-dev-runner.mjs" %*
