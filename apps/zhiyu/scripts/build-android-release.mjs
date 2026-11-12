import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = { ...process.env, NIMI_ANDROID_RELEASE: '1' };
const android = fileURLToPath(new URL('../android', import.meta.url));
const app = fileURLToPath(new URL('../', import.meta.url));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this build through pnpm build:android:release.');
run(process.execPath, [pnpm, 'exec', 'vite', 'build', '--mode', 'mobile-release'], app);
run(process.execPath, [pnpm, 'exec', 'cap', 'sync', 'android'], app);
if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'gradlew.bat', 'assembleRelease'], android);
else run('./gradlew', ['assembleRelease'], android);
