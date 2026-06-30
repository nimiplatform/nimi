import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('standard shell OAuth bridge', () => {
  it('Kit auth uses standard shell OAuth bridge names', () => {
    const oauthTypes = read('core/src/oauth/oauth-types.ts');
    const rendererOauth = read('shell/renderer/src/bridge/oauth.ts');
    const desktopWebAuth = read('auth/src/logic/desktop-web-auth.ts');
    const socialOauth = read('auth/src/logic/social-oauth.ts');

    expect(oauthTypes).toMatch(/export type ShellOAuthCodeBridge/);
    expect(oauthTypes).toMatch(/export type ShellOAuthBridge/);
    expect(rendererOauth).toMatch(/createStandardShellOAuthBridge/);
    expect(rendererOauth).toMatch(/hasShellHostInvoke/);
    expect(desktopWebAuth).toMatch(/ShellOAuthCodeBridge/);
    expect(socialOauth).toMatch(/ShellOAuthBridge/);
    expect(desktopWebAuth).not.toMatch(/TauriOAuthCodeBridge|hasTauriInvoke/);
    expect(socialOauth).not.toMatch(/TauriOAuthBridge|hasTauriInvoke/);
  });
});
