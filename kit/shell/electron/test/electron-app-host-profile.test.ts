import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  configureNimiElectronAppHostProfile,
  NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY,
} from '../src/main/app-host-profile.js';

function fakeApp(ready = false) {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    isReady: () => ready,
    setPath: (name: string, value: string) => { calls.push([name, value]); },
  };
}

const roots: string[] = [];

function preparedProfile(children = ['user-data', 'session-data', 'tmp']): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-host-profile-'));
  roots.push(root);
  const profile = path.join(root, 'app-hosts', 'scope', 'apps', 'subject');
  for (const child of children) mkdirSync(path.join(profile, child), { recursive: true });
  mkdirSync(profile, { recursive: true });
  return profile;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('configureNimiElectronAppHostProfile', () => {
  it('binds userData, sessionData and temp to the prepared profile before ready', () => {
    const profileRoot = preparedProfile();
    const app = fakeApp();
    const profile = configureNimiElectronAppHostProfile(app, { [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: profileRoot });
    expect(profile).toEqual({
      profileRoot,
      userData: path.join(profileRoot, 'user-data'),
      sessionData: path.join(profileRoot, 'session-data'),
      temp: path.join(profileRoot, 'tmp'),
    });
    expect(app.calls).toEqual([
      ['userData', profile.userData],
      ['sessionData', profile.sessionData],
      ['temp', profile.temp],
    ]);
  });

  it('fails explicitly instead of falling back to default Electron paths', () => {
    const profileRoot = preparedProfile();
    const cases: Array<[Readonly<Record<string, string | undefined>>, boolean, string]> = [
      [{}, false, 'electron-app-host-profile-missing'],
      [{ [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: 'relative/profile' }, false, 'electron-app-host-profile-missing'],
      [{ [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: ` ${profileRoot}` }, false, 'electron-app-host-profile-missing'],
      [{ [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: profileRoot }, true, 'electron-app-host-profile-after-ready'],
      [{ [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: path.join(profileRoot, 'absent') }, false, 'electron-app-host-profile-unavailable'],
    ];
    for (const [environment, ready, reasonCode] of cases) {
      const app = fakeApp(ready);
      expect(() => configureNimiElectronAppHostProfile(app, environment)).toThrow(
        expect.objectContaining({ reasonCode }),
      );
      expect(app.calls).toEqual([]);
    }
  });

  it('is published on its own subpath that loads nothing else from Kit', () => {
    // A Host evaluates this before the rest of Kit main, so a later module
    // that fails to load cannot leave Electron on its default paths.
    const exportsMap = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).exports;
    expect(exportsMap['./shell/electron/host-profile']).toEqual({
      types: './dist/shell/electron/main/app-host-profile.d.ts',
      import: './dist/shell/electron/main/app-host-profile.js',
      default: './dist/shell/electron/main/app-host-profile.js',
    });
    const runtimeImports = (file: string) => [...readFileSync(file, 'utf8')
      .matchAll(/^import (?!type )[^;]*?from '([^']+)';/gmu)].map((match) => match[1]);
    const sourceDirectory = path.resolve(process.cwd(), 'shell/electron/src/main');
    expect(runtimeImports(path.join(sourceDirectory, 'app-host-profile.ts'))).toEqual(['node:fs', 'node:path', './types.js']);
    expect(runtimeImports(path.join(sourceDirectory, 'types.ts'))).toEqual([]);
  });

  it('rejects a profile whose session data is not a real directory', () => {
    const profileRoot = preparedProfile(['user-data', 'tmp']);
    writeFileSync(path.join(profileRoot, 'session-data'), 'not a directory');
    const app = fakeApp();
    expect(() => configureNimiElectronAppHostProfile(app, { [NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]: profileRoot }))
      .toThrow(expect.objectContaining({ reasonCode: 'electron-app-host-profile-unavailable' }));
    expect(app.calls).toEqual([]);
  });
});
