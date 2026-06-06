import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    description: 'vNext SDK root facades must not use as never facade glue',
    pattern: 'as never',
    paths: [
      'sdks/typescript/root-client.ts',
      'sdks/typescript/core-client/index.ts',
      'sdks/typescript/runtime/index.ts',
      'sdks/typescript/realm/index.ts',
    ],
  },
  {
    description: 'vNext SDK public dynamic contracts must expose named JSON boundaries instead of raw record casts',
    pattern: 'Record<string, unknown>|as unknown as',
    paths: [
      'sdks/typescript/types/json.ts',
      'sdks/typescript/core/contracts/primitives.ts',
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/core/ai/text-runner.ts',
      'sdks/typescript/runtime/runtime-agent-consume-types.ts',
      'sdks/typescript/features/generation/runtime-scenarios.ts',
    ],
  },
  {
    description: 'desktop SDK/Realm session boundaries must not erase SDK calls to Promise<any>',
    pattern: 'Promise<any>',
    paths: [
      'apps/desktop/src/shell/renderer/infra/sdk',
      'apps/desktop/src/shell/renderer/infra/realm/realm-platform-session.ts',
    ],
  },
  {
    description: 'desktop world projection surfaces must not return record-based payload contracts',
    pattern: 'Promise<Array<Record<string, unknown>>>|Promise<Record<string, unknown> \\| null>|items: Array<Record<string, unknown>>|Array<Record<string, unknown>>',
    paths: [
      'apps/desktop/src/shell/renderer/features/world/world-detail-queries.ts',
    ],
  },
  {
    description: 'desktop runtime-bridge exported contracts must not expose raw unknown/record signatures',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/types.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-types.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/shared.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-parsers.ts',
    ],
  },
  {
    description: 'desktop runtime-config bridge projection surfaces must not fall back to raw record contracts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-derived.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller-bridge-sync.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller-utils.ts',
    ],
  },
  {
    description: 'desktop runtime-config storage normalization must not erase types through raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-normalize.ts',
    ],
  },
  {
    description: 'desktop offline cache surfaces must use typed cache contracts instead of raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/infra/offline/cache-manager.ts',
      'apps/desktop/src/shell/renderer/infra/offline/types.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-connector-discover-command.ts',
    ],
  },
  {
    description: 'desktop agent detail surfaces must not restore typed payloads from raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-model.ts',
      'apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-panel.tsx',
      'apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-queries.ts',
    ],
  },
  {
    description: 'desktop renderer-facing parser surfaces must use named JsonObject boundaries instead of raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as|Promise<any>|as never',
    paths: [
      'apps/desktop/src/shell/renderer/features/relationship/relationship-model.ts',
      'apps/desktop/src/shell/renderer/features/relationship/agent-friend-limit.ts',
      'apps/desktop/src/shell/renderer/features/explore/explore-panel.tsx',
      'apps/desktop/src/shell/renderer/features/notification/notification-query.ts',
      'apps/desktop/src/shell/renderer/features/settings/settings-storage.ts',
      'apps/desktop/src/shell/renderer/features/settings/settings-advanced-panel.tsx',
      'apps/desktop/src/shell/renderer/features/settings/settings-account-panel.tsx',
      'apps/desktop/src/shell/renderer/features/settings/settings-security-page.tsx',
      'apps/desktop/src/shell/renderer/features/profile/create-post-modal-helpers.ts',
      'apps/desktop/src/shell/renderer/features/profile/profile-panel.tsx',
    ],
  },
  {
    description: 'web adapters must not expose unknown or record placeholder contracts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as|: unknown\\b',
    paths: [
      'apps/web/src/post-permalink-page.tsx',
      'apps/web/src/desktop-adapter/runtime-config-panel.web.tsx',
    ],
  },
];

function runRipgrep(pattern, paths) {
  const missingPaths = paths.filter((targetPath) => !existsSync(path.join(repoRoot, targetPath)));
  if (missingPaths.length > 0) {
    return `missing required typed-surface scan target(s): ${missingPaths.join(', ')}`;
  }
  try {
    return execFileSync(path.join(repoRoot, 'scripts', 'rg.sh'), ['-n', pattern, ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (typeof error.status === 'number' && error.status === 1) {
      return '';
    }
    throw error;
  }
}

const failures = checks
  .map((check) => ({
    ...check,
    matches: runRipgrep(check.pattern, check.paths).trim(),
  }))
  .filter((check) => check.matches.length > 0);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[typed-surface-hardcut] ${failure.description}`);
    console.error(failure.matches);
  }
  process.exit(1);
}

console.log('Typed surface hardcut check passed');
