import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  linkWorkspacePackage,
  workspacePackageLinkType,
} from './sdk-consumer-link.mjs';

test('workspace package links use junctions on Windows', () => {
  assert.equal(workspacePackageLinkType('win32'), 'junction');
});

test('workspace package links use directory symlinks outside Windows', () => {
  assert.equal(workspacePackageLinkType('linux'), 'dir');
  assert.equal(workspacePackageLinkType('darwin'), 'dir');
});

test('linkWorkspacePackage creates a resolvable package directory link', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-consumer-link-'));
  try {
    const source = path.join(root, 'source-sdk');
    const packageScope = path.join(root, 'node_modules', '@nimiplatform');
    const target = path.join(packageScope, 'sdk');
    mkdirSync(source, { recursive: true });
    mkdirSync(packageScope, { recursive: true });
    writeFileSync(path.join(source, 'package.json'), '{"name":"@nimiplatform/sdk"}\n');

    linkWorkspacePackage(source, target);

    assert.equal(statSync(target).isDirectory(), true);
    assert.equal(statSync(path.join(target, 'package.json')).isFile(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
