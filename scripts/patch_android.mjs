// Patch MainActivity.kt after `tauri android init` to remove enableEdgeToEdge().
// enableEdgeToEdge() causes WebView content to extend behind the status bar,
// but without safe-area CSS support the interface appears shifted down.
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = resolve(ROOT, 'src-tauri/gen/android/app/src/main/java/com/cardduel/app/MainActivity.kt');

const CONTENT = `package com.cardduel.app

import android.os.Bundle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
`;

try {
  writeFileSync(PATH, CONTENT, 'utf8');
  console.log(`Patched ${PATH}`);
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error('MainActivity.kt not found (run `tauri android init` first).');
  } else {
    console.error('Failed to patch MainActivity.kt:', e.message);
    process.exit(1);
  }
}
