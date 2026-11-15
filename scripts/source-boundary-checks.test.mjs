import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

for (const gate of [
  { name: 'Realm REST', script: 'check-no-app-realm-rest-bypass.mjs',
    sources: [
      'apps/example/src/bypass.tsx',
      'apps/example/src/mobile/sdk-contract.js',
      'apps/example/src/dist-mobile/authored.js',
      'apps/example/android/app/src/main/assets/authored.js',
      'apps/example/android/app/src/main/assets/public-extra/authored.js',
      'gateways/example/src/bypass.tsx',
    ],
    bundles: ['dist-web', 'dist-electron', 'dist-mobile', 'dist-mobile-release', 'android/app/src/main/assets/public'],
    bypass: "fetch('/api/unadmitted-route');" },
  { name: 'UI glass', script: 'check-ui-glass-boundary.mjs',
    sources: ['apps/example/src/bypass.tsx', 'apps/example/android/app/src/main/assets/authored.js'],
    bundles: ['dist-web', 'dist-electron', 'dist-mobile', 'dist-mobile-release', 'android/app/src/main/assets/public'],
    bypass: '<div className="backdrop-blur-md" />' },
]) {
test(`${gate.name} source gate ignores generated bundles while still rejecting source bypasses`, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-source-gate-'));
  const script = path.join(root, 'scripts', gate.script);
  const write = (relative, source) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  try {
    mkdirSync(path.dirname(script), { recursive: true });
    copyFileSync(new URL(`./${gate.script}`, import.meta.url), script);
    for (const bundle of gate.bundles) write(`apps/example/${bundle}/assets/vendor.js`, gate.bypass);
    write('apps/example/src/client.ts', 'export {};');
    assert.doesNotThrow(() => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }));

    for (const source of gate.sources) {
      write(source, gate.bypass);
      const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1);
      const diagnostic = `${result.stdout}\n${result.stderr}`.split(path.sep).join('/');
      assert.ok(diagnostic.includes(source));
      for (const bundle of gate.bundles) assert.ok(!diagnostic.includes(`${bundle}/assets/vendor.js`));
      rmSync(path.join(root, source));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
}

test('Realm REST gate retains every forbidden operation check in authored mobile SDK code', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-rest-source-rules-'));
  const script = path.join(root, 'scripts', 'check-no-app-realm-rest-bypass.mjs');
  const source = 'apps/example/src/mobile/sdk-contract.js';
  const target = path.join(root, source);
  try {
    mkdirSync(path.dirname(script), { recursive: true });
    copyFileSync(new URL('./check-no-app-realm-rest-bypass.mjs', import.meta.url), script);
    mkdirSync(path.dirname(target), { recursive: true });
    for (const [code, label] of [
      ["import { listAgentCoreMemories } from '@nimiplatform/sdk/realm';", 'legacy agent-memory helper import'],
      ["const request = { path: '/api/private' };", 'path literal'],
      ["const request = { url: '/api/private' };", 'url literal'],
      ["fetch('/api/private');", 'fetch literal'],
      ['client.requestMyAppPermissionGrant();', 'direct Realm permission grant method'],
      ['client.permissionGrants.list();', 'direct Realm permission grant module'],
    ]) {
      writeFileSync(target, `// App-authored mobile source\n${code}\n`);
      const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1, label);
      const diagnostic = result.stderr.split(path.sep).join('/');
      assert.ok(diagnostic.includes(`${source}:2 ${label}:`), diagnostic);
    }
    writeFileSync(target, 'await client.agents.listCharacters();\n');
    assert.doesNotThrow(() => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
