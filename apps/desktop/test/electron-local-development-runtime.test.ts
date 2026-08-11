import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runtimeChildEnvironment } from '../src-electron/local-development-runtime.js';

describe('Desktop source-local Runtime environment', () => {
  it('preserves ProgramFiles for Windows host probes', {
    skip: process.platform !== 'win32',
  }, () => {
    const programFiles = process.env.ProgramFiles;
    assert.ok(programFiles && path.isAbsolute(programFiles));

    const environment = runtimeChildEnvironment({
      desktopEnvironment: 'NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_DESKTOP_EXECUTABLE',
      homeDirectory: process.env.USERPROFILE || process.cwd(),
      hostExecutable: 'C:\\host\\desktop.exe',
      realmUrl: 'http://127.0.0.1:3002',
      runtimeEnvironment: 'NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_RUNTIME_EXECUTABLE',
      runtimeExecutable: 'C:\\runtime\\nimi.exe',
    });

    assert.equal(environment.ProgramFiles, programFiles);
  });
});
