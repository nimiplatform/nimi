/**
 * use-runtime-ready regression tests.
 *
 * Realm connection / authentication state is owned by the Overtone bootstrap
 * (see overtone-bootstrap.ts). This hook is read-only with respect to realm
 * auth state and only contributes runtime daemon + AI capability probe
 * results.
 *
 * Source-text static lock: the hook MUST NOT read `VITE_NIMI_REALM_ACCESS_TOKEN`
 * or any bearer-token env shortcut. The "dev convenience" path is removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('use-runtime-ready (RuntimeAccountService boundary)', () => {
  it('hook module does not read VITE_NIMI_REALM_ACCESS_TOKEN or call deleted ensureOvertonePlatformClient helpers', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'use-runtime-ready.ts'), 'utf8');
    // Wave A-fix constraint: bearer-token env shortcut MUST NOT survive in
    // any renderer surface.
    expect(source).not.toMatch(/VITE_NIMI_REALM_ACCESS_TOKEN/);
    // The legacy auth-adapter helpers are gone; this hook MUST NOT import
    // them.
    expect(source).not.toMatch(/\bensureOvertonePlatformClient\b/);
    expect(source).not.toMatch(/\bclearOvertonePlatformClient\b/);
    // No app-owned token plumbing.
    expect(source).not.toMatch(/\bauthToken\b/);
    expect(source).not.toMatch(/\bauthRefreshToken\b/);
    // No app-side realm.ready probe with an env-driven token — realm auth
    // state comes from the bootstrap-projected store fields.
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
  });

  it('hook module reads realm-connection state from the app store, not from env', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'use-runtime-ready.ts'), 'utf8');
    // The hook now snapshots realmConfigured / realmAuthenticated from the
    // store. These are populated by overtone-bootstrap.ts based on
    // runtime.account.getAccountSessionStatus.
    expect(source).toMatch(/realmConfigured/);
    expect(source).toMatch(/realmAuthenticated/);
    expect(source).toMatch(/getPlatformClient/);
  });
});
