import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listSourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'generated' || entry.name === 'gen') {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

test('Auth/OAuth preflight inventory has a real migration point closed in Kit', () => {
  const desktopAuthAdapter = read('apps/desktop/src/shell/renderer/features/auth/desktop-auth-adapter.ts');

  assert.match(desktopAuthAdapter, /createRuntimeAccountBrowserBroker/);

  assert.doesNotMatch(desktopAuthAdapter, /runtime\.account\.beginLogin\(/);
  assert.doesNotMatch(desktopAuthAdapter, /runtime\.account\.completeLogin\(/);
  assert.doesNotMatch(desktopAuthAdapter, /validateRuntimeOAuthAuthorizationUrl/);
  assert.doesNotMatch(desktopAuthAdapter, /realm\.services\.AuthService\./);
  assert.match(desktopAuthAdapter, /checkNimiRealmAuthEmail/);
  assert.match(desktopAuthAdapter, /loginNimiRealmAuthPassword/);
  assert.match(desktopAuthAdapter, /verifyNimiRealmEmailOtp/);
  assert.match(desktopAuthAdapter, /loginNimiRealmOAuth/);
  assert.match(desktopAuthAdapter, /getDesktopAccountRuntime/);
  assert.match(desktopAuthAdapter, /Runtime account login completed without an authenticated account projection/);
  assert.doesNotMatch(desktopAuthAdapter, /runtime\.account\.getAccessToken\(/);
  assert.doesNotMatch(desktopAuthAdapter, /getPlatformClient/);
});

test('Desktop browser auth completion is gated by Runtime account projection readback, not raw token or full bootstrap', () => {
  const desktopAuthAdapter = read('apps/desktop/src/shell/renderer/features/auth/desktop-auth-adapter.ts');
  const completeStart = desktopAuthAdapter.indexOf('complete: async (request: Parameters<typeof broker.complete>[0]) => {');
  assert.notEqual(completeStart, -1, 'desktop Runtime account browser broker complete handler must exist');
  const completeEnd = desktopAuthAdapter.indexOf('\n    },', completeStart);
  const completeSource = desktopAuthAdapter.slice(completeStart, completeEnd);

  assert.match(completeSource, /await broker\.complete\(request\)/);
  assert.match(completeSource, /await loadDesktopRuntimeAccountUser\(\)/);
  assert.doesNotMatch(completeSource, /getAccessToken/);
  assert.doesNotMatch(
    completeSource,
    /rebootstrapRuntime|bootstrapRuntime/,
    'desktop login completion must not wait for full renderer bootstrap after loopback success',
  );
});

test('Desktop auth DTO projection is owned by SDK Realm auth extension', () => {
  const desktopAuthAdapter = read('apps/desktop/src/shell/renderer/features/auth/desktop-auth-adapter.ts');
  const desktopWebAuthMenu = read('apps/desktop/src/shell/renderer/features/auth/web-auth-menu.tsx');

  assert.match(desktopAuthAdapter, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(desktopWebAuthMenu, /toNimiRealmAuthUserRecord/);
  assert.doesNotMatch(desktopAuthAdapter, /toAuthTokensDto|toOAuthLoginResultDto|toCheckEmailResponseDto|isExpectedAnonymousSessionError/);
  assert.doesNotMatch(desktopWebAuthMenu, /auth-session-utils/);
});

test('Desktop OAuth bridge uses the standard shell host availability, not Tauri-only availability', () => {
  const desktopAuthAdapter = read('apps/desktop/src/shell/renderer/features/auth/desktop-auth-adapter.ts');
  const desktopRuntimeBridgeBarrel = read('apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts');

  assert.match(desktopAuthAdapter, /hasShellHostInvoke/);
  assert.match(desktopRuntimeBridgeBarrel, /hasShellHostInvoke/);
  assert.match(desktopAuthAdapter, /hasShellHostInvoke:\s*\(\)\s*=>\s*desktopBridge\.hasShellHostInvoke\(\)/);
  assert.doesNotMatch(desktopAuthAdapter, /hasShellHostInvoke:\s*\(\)\s*=>\s*desktopBridge\.hasTauriInvoke\(\)/);
});

test('Desktop has no app-local Runtime account browser broker', () => {
  const desktopFiles = listSourceFiles(path.join(repoRoot, 'apps/desktop/src'));
  const offenders = desktopFiles
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /runtime\.account\.(beginLogin|completeLogin)\(/.test(source);
    })
    .map((filePath) => path.relative(repoRoot, filePath));

  assert.deepEqual(offenders, []);
});
