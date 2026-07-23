import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  clearDesktopNimiClientSession,
  setDesktopNimiClientSessionForTests,
  withDesktopRuntimeProtectedScopes,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session';

const __filename = fileURLToPath(import.meta.url);
const desktopRoot = resolve(dirname(__filename), '..');
const sessionPath = resolve(
  desktopRoot,
  'src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts',
);
const rootGateRel = 'scripts/check-no-anonymous-fallback-shim.mjs';

function readSessionSource(): string {
  return readFileSync(sessionPath, 'utf8');
}

function findNimiRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    const ownsGate = existsSync(join(current, rootGateRel));
    const ownsDesktop = existsSync(join(current, 'apps/desktop'));
    if (ownsGate && ownsDesktop) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      assert.fail(`repo root containing ${rootGateRel} not found from ${startDir}`);
    }
    current = parent;
  }
}

function importsRuntimeAsValueFromSdkRuntime(source: string): boolean {
  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@nimiplatform\/sdk\/runtime['"]/gu;
  for (const match of source.matchAll(importRe)) {
    if (match[1]) {
      continue;
    }
    const specifiers = (match[2] ?? '')
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean);
    if (specifiers.some((specifier) => /^Runtime(?:\s+as\s+\w+)?$/u.test(specifier))) {
      return true;
    }
  }
  return false;
}

test('desktop Runtime Realm session delegates exact client construction to the SDK owner', () => {
  const source = readSessionSource();

  assert.doesNotMatch(source, /\bnew\s+Runtime\s*\(/u);
  assert.equal(importsRuntimeAsValueFromSdkRuntime(source), false);
  assert.match(source, /\bcreateNimiDesktopFirstPartyRuntimeClients\b/);
  assert.doesNotMatch(source, /\bcreateNimiRuntimePlatformClient\b/);
  assert.doesNotMatch(source, /readonly runtime(?:\?|): Runtime\b/);
});

test('desktop Runtime Realm session accepts the Electron IPC Runtime transport', () => {
  const source = readSessionSource();

  assert.match(source, /readonly type: 'tauri-ipc'/u);
  assert.match(source, /readonly type: 'electron-ipc'/u);
  assert.match(source, /type: 'electron-ipc'/u);
  assert.doesNotMatch(
    source,
    /const transport = input\.runtimeTransport \|\| \{\s*type: 'tauri-ipc' as const,/u,
    'Desktop Runtime transport must not silently default Electron shell back to Tauri IPC',
  );
});

test('desktop Electron Runtime calls leave host-owned auth metadata to the Electron shell', async () => {
  setDesktopNimiClientSessionForTests({
    appId: 'nimi.desktop',
    runtimeTransport: { type: 'electron-ipc' },
    runtimeClients: {},
    accountRuntime: {
      account: {
        getAccountSessionStatus: async () => {
          throw new Error('Electron renderer must not mint Runtime account metadata');
        },
      },
    },
    accountCaller: {},
    realm: {},
  } as never);
  try {
    const result = await withDesktopRuntimeProtectedScopes(['runtime.agent.read'], async (callOptions) => {
      assert.deepEqual(callOptions, {});
      return 'electron-host-owned';
    });
    assert.equal(result, 'electron-host-owned');
  } finally {
    clearDesktopNimiClientSession();
  }
});

test('desktop Tauri Runtime calls use the exact host carrier without minting a public Grant token', async () => {
  let accountStatusCalls = 0;
  let publicGrantCalls = 0;
  setDesktopNimiClientSessionForTests({
    appId: 'nimi.desktop',
    runtimeTransport: { type: 'tauri-ipc' },
    runtimeClients: {},
    accountRuntime: {
      account: {
        getAccountSessionStatus: async () => {
          accountStatusCalls += 1;
          return {
            state: AccountSessionState.AUTHENTICATED,
            accountProjection: { accountId: 'user-1' },
          };
        },
      },
      grants: {
        authorizeExternalPrincipal: async () => {
          publicGrantCalls += 1;
          return { tokenId: 'public-token', secret: 'public-secret' };
        },
      },
    },
    accountCaller: {},
    realm: {},
  } as never);
  try {
    const result = await withDesktopRuntimeProtectedScopes(
      ['runtime.agent.read'],
      async (callOptions) => {
        assert.deepEqual(callOptions, {});
        return 'tauri-host-owned';
      },
    );
    assert.equal(result, 'tauri-host-owned');
    assert.equal(accountStatusCalls, 0);
    assert.equal(publicGrantCalls, 0);
    const source = readSessionSource();
    assert.doesNotMatch(source, /authorizeExternalPrincipal/u);
    assert.doesNotMatch(source, /x-nimi-access-token-(?:id|secret)/u);
  } finally {
    clearDesktopNimiClientSession();
  }
});

test('root anonymous fallback gate scans the desktop session path for renderer Runtime construction', () => {
  const nimiRepoRoot = findNimiRepoRoot(dirname(__filename));
  const driftScript = join(nimiRepoRoot, rootGateRel);
  const workdir = mkdtempSync(join(tmpdir(), 'desktop-runtime-session-gate-'));
  const syntheticSessionPath = join(
    workdir,
    'apps/desktop/src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts',
  );
  try {
    mkdirSync(dirname(syntheticSessionPath), { recursive: true });
    writeFileSync(
      syntheticSessionPath,
      [
        "import { Runtime } from '@nimiplatform/sdk/runtime';",
        "export const runtime = new Runtime({ appId: 'desktop', transport: { type: 'tauri-ipc' } });",
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync('node', [driftScript], {
      cwd: workdir,
      encoding: 'utf8',
      env: process.env,
    });

    assert.notEqual(result.status, 0, 'root drift gate must reject renderer Runtime construction');
    assert.match(result.stderr, /desktop-nimi-client-session\.ts/u);
    assert.match(result.stderr, /new Runtime\(/u);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});
