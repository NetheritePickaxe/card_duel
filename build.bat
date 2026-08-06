@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 重新打包 卡牌对决.exe ===
python gen_icons.py
pyinstaller --onefile --noconsole --name "卡牌对决" --add-data "index.html;." --add-data "sw.js;." --add-data "icon-192.png;." --add-data "icon-512.png;." --hidden-import clr --hidden-import webview main.py
if exist dist\卡牌对决.exe (
  move /y dist\卡牌对决.exe "卡牌对决.exe" >nul
  rmdir /s /q build
  rmdir /s /q dist
  echo === 打包完成 ===
) else (
  echo === 打包失败，请检查依赖：pip install pywebview pyinstaller ===
)
pause
