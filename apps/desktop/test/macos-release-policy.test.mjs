import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { isMacOSMachO, macOSAudioCaptureRole, macOSReleaseRealmBaseURL } from '../scripts/lib/macos-release-process.mjs';

test('release Realm selection is explicit and rejects unsupported build endpoints', () => {
  assert.equal(macOSReleaseRealmBaseURL(), 'https://realm.nimi.ai');
  assert.equal(macOSReleaseRealmBaseURL('http://127.0.0.1:3002'), 'http://127.0.0.1:3002');
  for (const value of ['', 'http://127.0.0.1:3003', 'https://realm.nimi.ai/', 'http://realm.nimi.ai']) {
    assert.throws(() => macOSReleaseRealmBaseURL(value), /NIMI_MACOS_RELEASE_REALM_URL/);
  }
});

test('binary resource data is not executable code', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nimi-signing-policy-'));
  try {
    const resource = path.join(directory, 'locale.pak');
    writeFileSync(resource, Buffer.from([5, 0, 0, 0, 0, 0, 1, 0]));
    assert.equal(isMacOSMachO(resource), false);
    if (process.platform === 'darwin') assert.equal(isMacOSMachO('/usr/bin/true'), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('audio permission follows Home and its AudioService executable, not every Electron or native role', () => {
  const home = '/candidate/Nimi.app';
  assert.equal(macOSAudioCaptureRole(home, home), true);
  assert.equal(macOSAudioCaptureRole(home, path.join(home, 'Contents/MacOS/Nimi')), true);
  assert.equal(macOSAudioCaptureRole(home, path.join(home, 'Contents/Frameworks/Nimi Helper.app/Contents/MacOS/Nimi Helper')), true);
  for (const relative of [
    'Contents/Frameworks/Nimi Helper (Renderer).app/Contents/MacOS/Nimi Helper (Renderer)',
    'Contents/Frameworks/Nimi Helper (GPU).app/Contents/MacOS/Nimi Helper (GPU)',
    'Contents/Frameworks/Nimi Helper (Plugin).app/Contents/MacOS/Nimi Helper (Plugin)',
    'Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host',
    'Contents/Library/LaunchServices/nimi-runtime',
    'Contents/Resources/nimi-native/protected-local/nimi_shell_protected_local.node',
  ]) assert.equal(macOSAudioCaptureRole(home, path.join(home, relative)), false, relative);
  const host = path.join(home, 'Contents/Frameworks/Nimi Local App Host.app');
  assert.equal(macOSAudioCaptureRole(host, host), false);
});
