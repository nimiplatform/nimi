import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const desktopSrcRoot = path.join(repoRoot, 'apps/desktop/src');

function walkFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(absolute);
    return [absolute];
  });
}

function relative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trim();
}

function removeForwardingExports(source: string): string {
  return source
    .replace(/export\s+\{\s*default\s*\}\s+from\s+['"][^'"]+['"]\s*;?/g, '')
    .replace(/export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+['"][^'"]+['"]\s*;?/g, '')
    .trim();
}

test('audited AI/profile/account/auth files do not forward SDK or Kit owner symbols', () => {
  const offenders: string[] = [];
  const forwardingPattern = /export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+['"]@nimiplatform\/(?:sdk|kit)(?:\/[^'"]*)?['"]/g;
  const auditedFiles = [
    'shell/renderer/features/chat/conversation-capability.ts',
    'shell/renderer/bridge/runtime-bridge/account-app-library.ts',
    'shell/renderer/bridge/runtime-bridge/account-profile-library.ts',
    'shell/renderer/features/runtime-config/runtime-config-profile-library.ts',
    'shell/renderer/features/auth/web-auth-menu.tsx',
  ];

  for (const file of auditedFiles) {
    const absolute = path.join(desktopSrcRoot, file);
    assert.equal(statSync(absolute).isFile(), true);
    const source = readFileSync(absolute, 'utf8');
    const matches = source.match(forwardingPattern);
    if (matches) {
      offenders.push(`${relative(absolute)}: ${matches.join(' ')}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('pure forwarding shells are limited to the admitted public-web scaffold', () => {
  const allowed = new Set([
    'apps/desktop/src/public-web/app/index.ts',
    'apps/desktop/src/public-web/bridge.ts',
    'apps/desktop/src/public-web/i18n/index.ts',
    'apps/desktop/src/public-web/infra/index.ts',
    'apps/desktop/src/public-web/realm/index.ts',
  ]);
  const actual = new Set<string>();

  for (const absolute of walkFiles(desktopSrcRoot)) {
    if (!/\.(?:ts|tsx)$/.test(absolute)) continue;
    const source = stripComments(readFileSync(absolute, 'utf8'));
    if (source && removeForwardingExports(source) === '') {
      actual.add(relative(absolute));
    }
  }

  assert.deepEqual([...actual].sort(), [...allowed].sort());
});

test('remaining SDK or Kit forwarding exports are explicit separate domains or public-web scaffold', () => {
  const forwardingPattern = /export\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]@nimiplatform\/(?:sdk|kit)(?:\/[^'"]*)?['"]/g;
  const allowed = new Set([
    'apps/desktop/src/public-web/bridge.ts',
    'apps/desktop/src/public-web/infra/index.ts',
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/product-control.ts',
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-types.ts',
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/shared.ts',
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts',
    'apps/desktop/src/shell/renderer/features/apps/apps-lifecycle-bridge.ts',
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service.ts',
    'apps/desktop/src/shell/renderer/features/world/world-detail-types.ts',
    'apps/desktop/src/shell/renderer/first-run/runtime-materialization.ts',
    'apps/desktop/src/shell/renderer/infra/runtime-agent-inspect.ts',
  ]);
  const actual = new Set<string>();

  for (const absolute of walkFiles(desktopSrcRoot)) {
    if (!/\.(?:ts|tsx)$/.test(absolute)) continue;
    const source = readFileSync(absolute, 'utf8');
    if (forwardingPattern.test(source)) {
      actual.add(relative(absolute));
    }
    forwardingPattern.lastIndex = 0;
  }

  assert.deepEqual([...actual].sort(), [...allowed].sort());
});

test('Desktop SDK and Kit helper consumers import owner surfaces directly', () => {
  const conversationCapability = readFileSync(
    path.join(desktopSrcRoot, 'shell/renderer/features/chat/conversation-capability.ts'),
    'utf8',
  );
  const runtimeConfigProfileLibrary = readFileSync(
    path.join(desktopSrcRoot, 'shell/renderer/features/runtime-config/runtime-config-profile-library.ts'),
    'utf8',
  );

  assert.doesNotMatch(conversationCapability, /export\s+\{\s*applyAIProfileToConfig/);
  assert.doesNotMatch(conversationCapability, /createEmptyAIConfig\s*\}\s+from '@nimiplatform\/sdk\/ai'/);
  assert.match(runtimeConfigProfileLibrary, /AccountProfileLibraryProjection as SdkAccountProfileLibraryProjection/);
});
