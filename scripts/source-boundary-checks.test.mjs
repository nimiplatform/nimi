import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

for (const gate of [
  { name: 'Realm REST', script: 'check-no-app-realm-rest-bypass.mjs',
    roots: ['apps', 'gateways'], bundles: ['dist-web', 'dist-electron'],
    bypass: "fetch('/api/unadmitted-route');" },
  { name: 'UI glass', script: 'check-ui-glass-boundary.mjs',
    roots: ['apps'], bundles: ['dist-web', 'dist-electron'],
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

    for (const scope of gate.roots) {
      const source = `${scope}/example/src/bypass.tsx`;
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
