@echo off
cd /d "%~dp0"
set "SERVER_EXE=src-tauri\target\release\card-duel-server.exe"

if "%1"=="--server" goto run_server
goto serve_web

:run_server
if not exist "%SERVER_EXE%" goto build
"%SERVER_EXE%"
exit /b

:serve_web
if not exist "%SERVER_EXE%" goto build
echo ���ƶԾ� Web ��������(���� Rust ������, �˿� 8788)
echo ������� http://localhost:8788
echo �ֻ����豸�� http://<����IP>:8788(���˵��·�Ҳ����ʾ)
explorer.exe "http://localhost:8788"
"%SERVER_EXE%"
pause
exit /b

:build
echo �״�����, ���ڱ��� Rust ���, ���Ժ�...
cd src-tauri
cargo build --release --bin card-duel-server
if errorlevel 1 goto build_fail
cd ..
if "%1"=="--server" goto run_server
goto serve_web

:build_fail
echo ����ʧ��, ���� Rust ����.
pause
exit /b 1
