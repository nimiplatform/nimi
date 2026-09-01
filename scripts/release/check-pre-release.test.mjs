import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { preReleaseViolations } from './check-pre-release.mjs';

function write(root, relativePath, source) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source, 'utf8');
}

function json(version) {
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

function cargo(version) {
  return `[package]\nname = "fixture"\nversion = "${version}"\n`;
}

test('pre-release metadata binds final component versions and versioned changelogs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-pre-release-'));
  write(root, 'sdks/typescript/package.json', json('0.7.0'));
  write(root, 'kit/package.json', json('0.3.0'));
  write(root, 'app-tools/package.json', json('0.2.0'));
  write(root, 'kit/shell/protected-local-node/npm/win32-x64/package.json', json('0.3.0'));
  write(root, 'kit/shell/protected-local-node/npm/darwin-arm64/package.json', json('0.3.0'));
  write(root, 'kit/shell/protected-local/Cargo.toml', cargo('0.2.0'));
  write(root, 'kit/shell/tauri/Cargo.toml', cargo('0.2.0'));
  write(root, 'CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-08-31\n\n- Train notes.\n');
  write(root, 'kit/CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n## [0.3.0] - 2026-08-31\n\n- Kit notes.\n');
  write(root, '.goreleaser.yml', `
version: 2
builds:
  - id: nimi
    env: [CGO_ENABLED=0]
    ldflags: ['-s -w -X main.Version={{ .Version }}']
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
release:
  disable: true
snapshot:
  version_template: '{{ .Env.NIMI_RELEASE_VERSION }}'
`);

  assert.deepEqual(
    preReleaseViolations(root, { releaseTag: 'v0.1.0-rc.1' }),
    [],
  );

  write(root, 'sdks/typescript/package.json', json('0.7.0-rc.1'));
  assert.match(
    preReleaseViolations(root)[0],
    /public release manifests must use final stable SemVer/,
  );
});
