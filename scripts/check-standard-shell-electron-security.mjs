import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const preloadIpcAllowlist = new Set([
  'apps/avatar/src-electron/preload.cts',
  'apps/tester/src-electron/preload.cts',
  'kit/shell/electron/src/preload/cjs.cts',
  'kit/shell/electron/src/preload/index.ts',
]);
const fileUrlAllowlist = new Set([
  'apps/avatar/src-electron/main.ts',
  'apps/tester/src-electron/main.ts',
  'apps/tester/src/tester/tester-runtime-invokers-media-speech.ts',
  'kit/shell/electron/src/main/app-bridge.ts',
  'kit/shell/electron/src/main/bundled-avatar-sender.ts',
]);

const scanRoots = [
  'apps/avatar/src',
  'apps/avatar/src-electron',
  'apps/tester/src',
  'apps/tester/src-electron',
  'kit/shell/electron/src',
  'kit/shell/renderer/src',
];

const failures = [];

const testerMain = readRepo('apps/tester/src-electron/main.ts');
assertContains(testerMain, /contextIsolation:\s*true/u, 'apps/tester/src-electron/main.ts must set contextIsolation: true');
assertContains(testerMain, /nodeIntegration:\s*false/u, 'apps/tester/src-electron/main.ts must set nodeIntegration: false');
assertContains(testerMain, /sandbox:\s*true/u, 'apps/tester/src-electron/main.ts must set sandbox: true');
assertNotContains(testerMain, /sandbox:\s*false/u, 'apps/tester/src-electron/main.ts must not set sandbox: false');
const avatarMain = readRepo('apps/avatar/src-electron/main.ts');
assertNotContains(avatarMain, /new BrowserWindow/u, 'apps/avatar/src-electron/main.ts must not create an unsupervised Avatar window');
const desktopAvatarHost = readRepo('apps/desktop/src-electron/bundled-avatar-host.ts');
assertContains(desktopAvatarHost, /contextIsolation:\s*true/u, 'Desktop bundled Avatar host must set contextIsolation: true');
assertContains(desktopAvatarHost, /nodeIntegration:\s*false/u, 'Desktop bundled Avatar host must set nodeIntegration: false');
assertContains(desktopAvatarHost, /sandbox:\s*true/u, 'Desktop bundled Avatar host must set sandbox: true');
assertNotContains(desktopAvatarHost, /sandbox:\s*false/u, 'Desktop bundled Avatar host must not set sandbox: false');
const electronHost = readRepo('kit/shell/electron/src/main/host.ts');
assertContains(electronHost, /NIMI_STANDARD_SHELL_CAPABILITY_SETS/u, 'kit/shell/electron/src/main/host.ts must enforce standard shell capability sets');
assertContains(electronHost, /createElectronCapabilityNotInHostSetError/u, 'kit/shell/electron/src/main/host.ts must fail closed for commands outside the host capability set');
assertContains(electronHost, /assertElectronStandardShellCommandAllowed/u, 'kit/shell/electron/src/main/host.ts must check capability-set allowlists before dispatch');
const electronHostTypes = readRepo('kit/shell/electron/src/main/types.ts');
assertContains(electronHostTypes, /capabilitySetRef\?:\s*string/u, 'kit/shell/electron/src/main/types.ts must expose host capabilitySetRef');
for (const file of collectSourceFiles(scanRoots)) {
  const relative = slash(path.relative(repoRoot, file));
  const content = readFileSync(file, 'utf8');
  if (/\bipcRenderer\b/u.test(content) && !preloadIpcAllowlist.has(relative)) {
    failures.push(`${relative}: ipcRenderer is allowed only in Electron preload implementations`);
  }
  if (/(?<!nimi-shell-)file:\/\//u.test(content) && !fileUrlAllowlist.has(relative)) {
    failures.push(`${relative}: file:// is allowed only in explicit Electron host URL handling`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

function assertContains(content, pattern, message) {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function assertNotContains(content, pattern, message) {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function collectSourceFiles(roots) {
  const files = [];
  for (const root of roots) {
    walk(path.join(repoRoot, root), files);
  }
  return files;
}

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron') {
        continue;
      }
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (/\.(?:ts|tsx|cts|js|mjs|cjs)$/u.test(target)) {
    files.push(target);
  }
}

function slash(value) {
  return value.replace(/\\/gu, '/');
}
