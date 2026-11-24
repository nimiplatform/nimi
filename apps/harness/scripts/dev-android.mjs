// Device-free development uses the same synced Android project as cap run.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const android = fileURLToPath(new URL('../android/', import.meta.url));
const require = createRequire(import.meta.url);
let result;
if (process.env.NIMI_ANDROID_BUILD_ONLY === '1') {
  result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat :app:assembleDebug :app:signingReport'], { cwd: android, stdio: 'inherit' })
    : spawnSync('./gradlew', [':app:assembleDebug', ':app:signingReport'], { cwd: android, stdio: 'inherit' });
} else {
  result = spawnSync(process.execPath, [require.resolve('@capacitor/cli/bin/capacitor'), 'run', 'android', '--no-sync'], { cwd: root, stdio: 'inherit' });
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
