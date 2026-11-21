import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  createElectronShellFileProtocolHost,
  type NimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentRegistration,
  type NimiElectronShellFileProtocolHost,
} from '@nimiplatform/kit/shell/electron/main';
import { ElectronLocalDevelopmentHost } from '../src-electron/local-development-host.js';

const HANDLE = 'ab'.repeat(32);

function makeRegistration(projectRoot: string): NimiElectronLocalDevelopmentRegistration {
  return {
    registrationHandle: HANDLE,
    project: {
      appId: 'nimi.shijing',
      displayName: 'ShiJing',
      canonicalProjectRoot: projectRoot,
      canonicalManifestPath: path.join(projectRoot, 'nimi.app.yaml'),
      shell: 'electron',
      appAccess: ['text.generate'],
      sourceGeneration: 1,
      declarationGeneration: 1,
    },
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
  };
}

function makeControl(projectRoot: string): NimiElectronLocalDevelopmentControl {
  const reg = makeRegistration(projectRoot);
  return {
    register: async () => reg,
    listRegistrations: async () => [reg],
    removeRegistration: async () => undefined,
    launch: async () => ({
      processId: 10,
      bindDeadlineUnixMs: Date.now() + 10_000,
      hostProfileRoot: path.join(projectRoot, '.host-profile'),
    }),
    access: async () => ({
      available: true,
      reasonCode: 'ACTION_EXECUTED',
      executionScopeRef: `execution_scope_${'A'.repeat(43)}`,
    }),
    hostStatus: async () => ({ running: false, exitCode: null }),
    focusHost: async () => undefined,
    terminateHost: async () => undefined,
    endRun: async () => undefined,
  };
}

function makeTrackedProtocolHost() {
  const granted = new Set<string>();
  const unregistered: string[] = [];
  const inner = createElectronShellFileProtocolHost({
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: () => undefined,
    },
  });
  const host: NimiElectronShellFileProtocolHost = {
    ...inner,
    registerReadableFile: async (absolutePath, scope) => {
      const canonical = await inner.registerReadableFile(absolutePath, scope);
      granted.add(canonical);
      return canonical;
    },
    unregisterReadableFile: async (absolutePath) => {
      unregistered.push(absolutePath);
      granted.delete(absolutePath);
      await inner.unregisterReadableFile?.(absolutePath);
    },
  };
  return { host, granted, unregistered };
}

describe('ElectronLocalDevelopmentHost local_development_project_storefront', () => {
  it('reads bilingual markdown + storefront images via nimi-shell-file, enforces realpath containment, and revokes replaced/removed grants', async (context) => {
    const tempParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-dev-storefront-')));
    const homeDir = path.join(tempParent, 'home');
    const projectRoot = path.join(tempParent, 'project');
    const outsideDir = path.join(tempParent, 'outside');
    await mkdir(homeDir, { recursive: true });
    await mkdir(path.join(projectRoot, 'assets', 'storefront'), { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    context.after(async () => {
      await rm(tempParent, { recursive: true, force: true });
    });

    const coverZh = path.join(projectRoot, 'assets', 'storefront', 'cover-zh.webp');
    const coverEn = path.join(projectRoot, 'assets', 'storefront', 'cover-en.webp');
    const shot1 = path.join(projectRoot, 'assets', 'storefront', 'shot-1.webp');
    const shot2 = path.join(projectRoot, 'assets', 'storefront', 'shot-2.webp');
    const outsidePng = path.join(outsideDir, 'secret.png');
    await writeFile(coverZh, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(coverEn, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(shot1, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(shot2, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(outsidePng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    let symlinkCreated = false;
    const symlinkShot = path.join(projectRoot, 'assets', 'storefront', 'escape.png');
    try {
      await symlink(outsidePng, symlinkShot);
      symlinkCreated = true;
    } catch {
      // Windows without developer mode/elevation may refuse file symlinks; traversal path still tested.
    }

    await writeFile(path.join(projectRoot, 'NIMI_APP.md'), '# 时镜\n\n中文介绍。');
    await writeFile(path.join(projectRoot, 'NIMI_APP.en.md'), '# ShiJing\n\nEnglish introduction.');
    await writeFile(path.join(projectRoot, 'nimi.app.yaml'), [
      'app_id: nimi.shijing',
      'display_name: 时镜',
      'metadata:',
      '  summary: 本地 AI 时间镜',
      '  storefront:',
      '    category: companions-worlds',
      '    default_locale: zh',
      '    locales:',
      '      zh:',
      '        tags: [命理, 本地]',
      '        highlights:',
      '          - title: 六镜视角',
      '            description: 多维时间洞察。',
      '      en:',
      '        display_name: ShiJing',
      '        summary: Local AI temporal mirror',
      '        introduction: NIMI_APP.en.md',
      '        tags: [Bazi, Local]',
      '        highlights:',
      '          - title: Six Lenses',
      '            description: Multi-scale temporal view.',
      '    media:',
      '      cover:',
      '        path: assets/storefront/cover-zh.webp',
      '        locales:',
      '          en: assets/storefront/cover-en.webp',
      '      gallery:',
      '        - id: daily',
      '          kind: image',
      '          path: assets/storefront/shot-1.webp',
      '          caption:',
      '            zh: 日镜视图',
      '            en: Daily view',
      '        - id: traversal',
      '          kind: image',
      '          path: ../outside/secret.png',
      ...(symlinkCreated ? [
        '        - id: symlink-escape',
        '          kind: image',
        '          path: assets/storefront/escape.png',
      ] : []),
    ].join('\n'));

    const tracked = makeTrackedProtocolHost();
    const host = new ElectronLocalDevelopmentHost(
      makeControl(projectRoot),
      homeDir,
      undefined,
      undefined,
      undefined,
      undefined,
      tracked.host,
    );
    context.after(async () => {
      await host.shutdown();
    });

    const registrations = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
    assert.equal(registrations.length, 1);
    const devSelector = registrations[0]!.selector;

    const first = await host.invoke('local_development_project_storefront', {
      payload: { selector: devSelector },
    }) as {
      selector: string;
      storefront: {
        category: string;
        defaultLocale: string;
        locales: Array<{ locale: string; displayName: string; introductionMarkdown?: string | null }>;
        cover: { defaultUrl: string | null; localeUrls: Record<string, string> } | null;
        gallery: Array<{ id: string; defaultUrl: string | null; caption: Record<string, string> }>;
      } | null;
    };

    assert.equal(first.selector, devSelector);
    assert.ok(first.storefront);
    assert.equal(first.storefront.category, 'companions-worlds');
    assert.equal(first.storefront.defaultLocale, 'zh');
    const enLocale = first.storefront.locales.find((item) => item.locale === 'en');
    assert.equal(enLocale?.displayName, 'ShiJing');
    assert.match(enLocale?.introductionMarkdown ?? '', /English introduction/);
    assert.match(first.storefront.cover?.defaultUrl ?? '', /^nimi-shell-file:\/\/local\//);
    assert.match(first.storefront.cover?.localeUrls.en ?? '', /^nimi-shell-file:\/\/local\//);
    // Traversal and symlink escape entries must be dropped
    assert.deepEqual(first.storefront.gallery.map((g) => g.id), ['daily']);
    assert.equal(tracked.granted.size, 3);
    assert.equal(await tracked.host.hasReadableFile(shot1), true);
    assert.equal(await tracked.host.hasReadableFile(outsidePng), false);

    await rm(path.join(projectRoot, 'NIMI_APP.en.md'));
    const missingIntro = await host.invoke('local_development_project_storefront', {
      payload: { selector: devSelector },
    }) as typeof first;
    assert.equal(missingIntro.storefront?.locales.find((item) => item.locale === 'en')?.introductionMarkdown, null);
    assert.equal(missingIntro.storefront?.locales.find((item) => item.locale === 'zh')?.introductionMarkdown, undefined);

    // Swap gallery shot-1.webp -> shot-2.webp and refresh: shot-1 must be revoked
    await writeFile(path.join(projectRoot, 'nimi.app.yaml'), [
      'app_id: nimi.shijing',
      'display_name: 时镜',
      'metadata:',
      '  summary: 本地 AI 时间镜',
      '  storefront:',
      '    category: companions-worlds',
      '    default_locale: zh',
      '    media:',
      '      cover:',
      '        path: assets/storefront/cover-zh.webp',
      '      gallery:',
      '        - id: daily',
      '          kind: image',
      '          path: assets/storefront/shot-2.webp',
    ].join('\n'));

    const refreshed = await host.invoke('local_development_project_storefront', {
      payload: { selector: devSelector },
    }) as typeof first;
    assert.equal(refreshed.storefront?.gallery.length, 1);
    assert.equal(tracked.granted.size, 2);
    assert.equal(await tracked.host.hasReadableFile(shot2), true);
    assert.equal(await tracked.host.hasReadableFile(shot1), false);
    assert.equal(await tracked.host.hasReadableFile(coverEn), false);

    // Removing the registration must revoke all remaining storefront grants
    await host.invoke('local_development_registration_remove', {
      payload: { selector: devSelector },
    });
    assert.equal(tracked.granted.size, 0);
    assert.equal(await tracked.host.hasReadableFile(coverZh), false);
    assert.equal(await tracked.host.hasReadableFile(shot2), false);
  });

  it('revokes newly granted files when registration removal races with an in-flight storefront refresh', async (context) => {
    const tempParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-dev-sf-race-')));
    const homeDir = path.join(tempParent, 'home');
    const projectRoot = path.join(tempParent, 'project');
    await mkdir(homeDir, { recursive: true });
    await mkdir(path.join(projectRoot, 'assets', 'storefront'), { recursive: true });
    context.after(async () => {
      await rm(tempParent, { recursive: true, force: true });
    });

    const coverZh = path.join(projectRoot, 'assets', 'storefront', 'cover-zh.webp');
    await writeFile(coverZh, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(path.join(projectRoot, 'NIMI_APP.md'), '# 时镜\n\n介绍。');
    await writeFile(path.join(projectRoot, 'nimi.app.yaml'), [
      'app_id: nimi.shijing',
      'display_name: 时镜',
      'metadata:',
      '  summary: 本地 AI 时间镜',
      '  storefront:',
      '    category: lifestyle',
      '    default_locale: zh',
      '    media:',
      '      cover:',
      '        path: assets/storefront/cover-zh.webp',
    ].join('\n'));

    let enteredRegister!: () => void;
    const registerEntered = new Promise<void>((resolve) => { enteredRegister = resolve; });
    let releaseRegister!: () => void;
    const registerGate = new Promise<void>((resolve) => { releaseRegister = resolve; });

    const tracked = makeTrackedProtocolHost();
    const origRegister = tracked.host.registerReadableFile;
    const blockingProtocolHost: NimiElectronShellFileProtocolHost = {
      ...tracked.host,
      registerReadableFile: async (absolutePath, scope) => {
        enteredRegister();
        await registerGate;
        return origRegister(absolutePath, scope);
      },
    };

    const host = new ElectronLocalDevelopmentHost(
      makeControl(projectRoot),
      homeDir,
      undefined,
      undefined,
      undefined,
      undefined,
      blockingProtocolHost,
    );
    context.after(async () => {
      await host.shutdown();
    });

    const registrations = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
    const devSelector = registrations[0]!.selector;

    const refreshPromise = host.invoke('local_development_project_storefront', {
      payload: { selector: devSelector },
    });
    await registerEntered;

    // Remove the registration while readProjectStorefront is paused mid-grant.
    await host.invoke('local_development_registration_remove', {
      payload: { selector: devSelector },
    });
    releaseRegister();

    await assert.rejects(refreshPromise, /local-development-registration-not-found/u);
    assert.equal(tracked.granted.size, 0, 'no stale grant may remain after concurrent removal');
    assert.equal(await tracked.host.hasReadableFile(coverZh), false);
  });

  it('rejects a new storefront preview read started after registration removal has already begun', async (context) => {
    const tempParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-dev-sf-rev-race-')));
    const homeDir = path.join(tempParent, 'home');
    const projectRoot = path.join(tempParent, 'project');
    await mkdir(homeDir, { recursive: true });
    await mkdir(path.join(projectRoot, 'assets', 'storefront'), { recursive: true });
    context.after(async () => {
      await rm(tempParent, { recursive: true, force: true });
    });

    const coverZh = path.join(projectRoot, 'assets', 'storefront', 'cover-zh.webp');
    await writeFile(coverZh, Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '));
    await writeFile(path.join(projectRoot, 'NIMI_APP.md'), '# 时镜\n\n介绍。');
    await writeFile(path.join(projectRoot, 'nimi.app.yaml'), [
      'app_id: nimi.shijing',
      'display_name: 时镜',
      'metadata:',
      '  summary: 本地 AI 时间镜',
      '  storefront:',
      '    category: lifestyle',
      '    default_locale: zh',
      '    media:',
      '      cover:',
      '        path: assets/storefront/cover-zh.webp',
    ].join('\n'));

    let enteredControlRemove!: () => void;
    const controlRemoveEntered = new Promise<void>((resolve) => { enteredControlRemove = resolve; });
    let releaseControlRemove!: () => void;
    const controlRemoveGate = new Promise<void>((resolve) => { releaseControlRemove = resolve; });

    const baseControl = makeControl(projectRoot);
    const blockingControl = {
      ...baseControl,
      removeRegistration: async (handle: string) => {
        enteredControlRemove();
        await controlRemoveGate;
        return baseControl.removeRegistration(handle);
      },
    };
    const tracked = makeTrackedProtocolHost();
    const host = new ElectronLocalDevelopmentHost(
      blockingControl,
      homeDir,
      undefined,
      undefined,
      undefined,
      undefined,
      tracked.host,
    );
    context.after(async () => {
      await host.shutdown();
    });

    const registrations = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
    const devSelector = registrations[0]!.selector;

    // Removal begins and pauses inside control.removeRegistration (after revokeStorefrontAssetGrants, before selector delete).
    const removePromise = host.invoke('local_development_registration_remove', {
      payload: { selector: devSelector },
    });
    await controlRemoveEntered;

    // A new storefront refresh arriving mid-removal must fail closed without granting any files.
    await assert.rejects(
      host.invoke('local_development_project_storefront', { payload: { selector: devSelector } }),
      /local-development-registration-not-found/u,
    );
    releaseControlRemove();
    await removePromise;

    assert.equal(tracked.granted.size, 0, 'no grant may be created after removal started');
    assert.equal(await tracked.host.hasReadableFile(coverZh), false);
  });
});
