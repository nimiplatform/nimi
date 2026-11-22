import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const DEV_CARRIER_LOCK_TIMEOUT_MS = 30_000;
const DEV_CARRIER_LOCK_STALE_MS = 120_000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_ELECTRON_RUNTIME_FILES = [
  path.join('resources', 'default_app.asar'),
  'icudtl.dat',
  'v8_context_snapshot.bin',
];

function sleepSync(ms) {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

function withDevCarrierLock(lockPath, fn) {
  const deadline = Date.now() + DEV_CARRIER_LOCK_TIMEOUT_MS;
  let fd;
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n`, 'utf8');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lockStat = statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > DEV_CARRIER_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for dev-carrier lock: ${lockPath}`);
      }
      sleepSync(50);
    }
  }
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch {}
    try { unlinkSync(lockPath); } catch {}
  }
}

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// Idempotently materializes an isolated, runnable Electron copy under
// `.nimi/local/dev-carrier/` so source-development managed-web Apps have a
// distinct executable path and file identity from Home's workspace Electron.
export function ensureManagedWebDevCarrier({
  repoRoot,
  electronExecutable,
  platform = process.platform,
  architecture = process.arch,
}) {
  const root = realpathSync(repoRoot);
  const sourceExe = realpathSync(electronExecutable);
  const carrierBase = path.join(root, '.nimi', 'local', 'dev-carrier');
  mkdirSync(carrierBase, { recursive: true });

  if (platform === 'win32' && architecture === 'x64') {
    return ensureWindowsDevCarrier(root, carrierBase, sourceExe);
  }
  if (platform === 'darwin' && architecture === 'arm64') {
    return ensureMacOSDevCarrier(root, carrierBase, sourceExe);
  }
  return null;
}

function ensureWindowsDevCarrier(repoRoot, carrierBase, sourceExe) {
  const sourceDist = path.dirname(sourceExe);
  if (path.basename(sourceExe).toLowerCase() !== 'electron.exe'
    || !WINDOWS_ELECTRON_RUNTIME_FILES.every(name => existsSync(path.join(sourceDist, name)))) {
    throw new Error(`Incomplete Windows Electron distribution: ${sourceExe}`);
  }
  const versionFile = path.join(sourceDist, 'version');
  const electronVersion = existsSync(versionFile)
    ? readFileSync(versionFile, 'utf8').trim()
    : 'unknown';
  const sourceStat = statSync(sourceExe);
  const expectedStamp = JSON.stringify({
    electronVersion,
    sourceExe,
    sourceSize: sourceStat.size,
    sourceMtimeMs: Math.trunc(sourceStat.mtimeMs),
  });

  const targetDir = path.join(carrierBase, 'win32-x64');
  const targetExe = path.join(targetDir, 'NimiAppHost.exe');
  const stampPath = path.join(targetDir, '.nimi-dev-carrier-stamp.json');
  const carrierEntry = path.join(repoRoot, 'apps', 'desktop', 'dist-electron', 'managed-web-carrier.js');

  if (isValidWindowsDevCarrier(targetDir, targetExe, stampPath, sourceStat, expectedStamp)) {
    return { carrierExecutable: targetExe, carrierEntry };
  }

  return withDevCarrierLock(path.join(carrierBase, '.nimi-dev-carrier-win32-x64.lock'), () => {
    if (isValidWindowsDevCarrier(targetDir, targetExe, stampPath, sourceStat, expectedStamp)) {
      return { carrierExecutable: targetExe, carrierEntry };
    }
    const stageDir = path.join(carrierBase, `.tmp-win32-x64-${process.pid}-${Date.now()}`);
    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });
    try {
      for (const entry of readdirSync(sourceDist, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === 'electron.exe') continue;
        cpSync(path.join(sourceDist, entry.name), path.join(stageDir, entry.name), {
          recursive: true,
          dereference: true,
        });
      }
      copyFileSync(sourceExe, path.join(stageDir, 'NimiAppHost.exe'));
      writeFileSync(path.join(stageDir, '.nimi-dev-carrier-stamp.json'), `${expectedStamp}\n`, 'utf8');

      rmSync(targetDir, { recursive: true, force: true });
      renameSync(stageDir, targetDir);
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }
    return { carrierExecutable: targetExe, carrierEntry };
  });
}

function isValidWindowsDevCarrier(targetDir, targetExe, stampPath, sourceStat, expectedStamp) {
  try {
    if (!existsSync(targetExe) || !existsSync(stampPath)) return false;
    for (const sibling of WINDOWS_ELECTRON_RUNTIME_FILES) {
      if (!existsSync(path.join(targetDir, sibling))) return false;
    }
    const stamp = readFileSync(stampPath, 'utf8').trim();
    if (stamp !== expectedStamp) return false;
    const targetStat = lstatSync(targetExe);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size !== sourceStat.size) {
      return false;
    }
    // Reject hardlinks sharing the same NTFS FileIndex as workspace electron.exe.
    if (targetStat.ino && sourceStat.ino && targetStat.ino === sourceStat.ino && targetStat.dev === sourceStat.dev) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureMacOSDevCarrier(repoRoot, carrierBase, sourceExe) {
  const sourceApp = path.resolve(sourceExe, '..', '..', '..');
  if (path.relative(sourceApp, sourceExe) !== path.join('Contents', 'MacOS', 'Electron')
    || !existsSync(path.join(sourceApp, 'Contents', 'Info.plist'))) {
    throw new Error(`Incomplete macOS Electron bundle: ${sourceExe}`);
  }
  const sourceStat = statSync(sourceExe);
  const expectedStamp = JSON.stringify({
    sourceApp,
    sourceExe,
    sourceSize: sourceStat.size,
    sourceMtimeMs: Math.trunc(sourceStat.mtimeMs),
  });

  const targetApp = path.join(carrierBase, 'Nimi Local App Host Dev.app');
  const targetExe = path.join(targetApp, 'Contents', 'MacOS', 'Electron');
  const stampPath = path.join(carrierBase, '.nimi-dev-carrier-macos-stamp.json');
  const carrierEntry = path.join(repoRoot, 'apps', 'desktop', 'macos', 'local-app-host', 'main.mjs');

  if (isValidMacOSDevCarrier(targetApp, targetExe, stampPath, sourceStat, expectedStamp)) {
    return { carrierExecutable: targetExe, carrierEntry };
  }

  return withDevCarrierLock(path.join(carrierBase, '.nimi-dev-carrier-macos.lock'), () => {
    if (isValidMacOSDevCarrier(targetApp, targetExe, stampPath, sourceStat, expectedStamp)) {
      return { carrierExecutable: targetExe, carrierEntry };
    }
    const stageApp = path.join(carrierBase, `.tmp-local-app-host-${process.pid}-${Date.now()}.app`);
    rmSync(stageApp, { recursive: true, force: true });
    try {
      const copied = spawnSync('/usr/bin/ditto', [sourceApp, stageApp], { stdio: 'inherit' });
      if (copied.error || copied.status !== 0) {
        throw new Error(`ditto failed to materialize macOS dev-carrier: ${copied.error?.message || `exit ${copied.status}`}`);
      }
      rmSync(targetApp, { recursive: true, force: true });
      renameSync(stageApp, targetApp);
      writeFileSync(stampPath, `${expectedStamp}\n`, 'utf8');
    } finally {
      rmSync(stageApp, { recursive: true, force: true });
    }
    return { carrierExecutable: targetExe, carrierEntry };
  });
}

function isValidMacOSDevCarrier(targetApp, targetExe, stampPath, sourceStat, expectedStamp) {
  try {
    if (!existsSync(targetExe) || !existsSync(stampPath)) return false;
    if (!existsSync(path.join(targetApp, 'Contents', 'Info.plist'))) return false;
    const stamp = readFileSync(stampPath, 'utf8').trim();
    if (stamp !== expectedStamp) return false;
    const targetStat = lstatSync(targetExe);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size !== sourceStat.size) {
      return false;
    }
    if (targetStat.ino && sourceStat.ino && targetStat.ino === sourceStat.ino && targetStat.dev === sourceStat.dev) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
