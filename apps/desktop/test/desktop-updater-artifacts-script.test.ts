import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectDesktopUpdaterArtifactViolations } from '../scripts/lib/desktop-updater-artifacts.mjs';

function makeArtifactFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-updater-artifacts-'));
  const latestJsonPath = path.join(root, 'latest.json');
  const bundlePath = path.join(root, 'Nimi_0.1.0_aarch64.dmg.app.tar.gz');
  const signaturePath = `${bundlePath}.sig`;

  fs.writeFileSync(bundlePath, 'bundle');
  fs.writeFileSync(signaturePath, 'sig');
  fs.writeFileSync(
    latestJsonPath,
    `${JSON.stringify({
      version: '0.1.0',
      platforms: {
        'darwin-aarch64': {
          url: 'https://example.com/Nimi_0.1.0_aarch64.dmg.app.tar.gz',
          signature: 'base64sig',
        },
      },
    }, null, 2)}\n`,
  );

  return {
    artifacts: [bundlePath, signaturePath, latestJsonPath],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('desktop updater artifact validation accepts aligned updater assets', () => {
  const fixture = makeArtifactFixture();
  try {
    assert.deepEqual(
      collectDesktopUpdaterArtifactViolations({
        artifacts: fixture.artifacts,
        expectedBundle: 'app',
      }),
      [],
    );
  } finally {
    fixture.cleanup();
  }
});

test('desktop updater artifact validation rejects missing signatures and bundle mismatch', () => {
  const fixture = makeArtifactFixture();
  try {
    fs.unlinkSync(fixture.artifacts[1]!);
    const violations = collectDesktopUpdaterArtifactViolations({
      artifacts: fixture.artifacts.filter((artifactPath) => !artifactPath.endsWith('.sig')),
      expectedBundle: 'nsis',
    });

    assert.ok(violations.some((line: string) => line.includes('no updater signature artifacts')));
    assert.ok(violations.some((line: string) => line.includes('expected updater bundle type nsis')));
  } finally {
    fixture.cleanup();
  }
});

test('desktop updater artifact validation rejects invalid latest.json payloads', () => {
  const fixture = makeArtifactFixture();
  try {
    fs.writeFileSync(fixture.artifacts[2]!, '{not-json');
    const violations = collectDesktopUpdaterArtifactViolations({
      artifacts: fixture.artifacts,
      expectedBundle: 'app',
    });

    assert.ok(violations.some((line: string) => line.includes('latest.json is not valid JSON')));
  } finally {
    fixture.cleanup();
  }
});

test('desktop updater artifact validation rejects empty platform maps', () => {
  const fixture = makeArtifactFixture();
  try {
    fs.writeFileSync(
      fixture.artifacts[2]!,
      `${JSON.stringify({ version: '0.1.0', platforms: {} }, null, 2)}\n`,
    );
    const violations = collectDesktopUpdaterArtifactViolations({
      artifacts: fixture.artifacts,
      expectedBundle: 'app',
    });

    assert.ok(violations.some((line: string) => line.includes('latest.json platforms is empty')));
  } finally {
    fixture.cleanup();
  }
});
