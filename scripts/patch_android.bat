@echo off
REM Patch MainActivity.kt to remove enableEdgeToEdge() which causes
REM the WebView content to shift down behind the status bar on Android.
set MAIN_ACTIVITY="src-tauri\gen\android\app\src\main\java\com\cardduel\app\MainActivity.kt"
if not exist %MAIN_ACTIVITY% (
  echo MainActivity.kt not found, skipping patch.
  exit /b 0
)
echo Patching %MAIN_ACTIVITY% ...
(
echo package com.cardduel.app
echo.
echo import android.os.Bundle
echo.
echo class MainActivity : TauriActivity() {
echo   override fun onCreate(savedInstanceState: Bundle?) {
echo     super.onCreate(savedInstanceState)
echo   }
echo }
) > %MAIN_ACTIVITY%
echo Done.
