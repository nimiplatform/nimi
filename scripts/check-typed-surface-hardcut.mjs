import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    description: 'sdk platform client must not use as never facade glue',
    pattern: 'as never',
    paths: ['sdk/src/platform-client.ts'],
  },
  {
    description: 'sdk public dynamic contracts must expose named JsonObject boundaries instead of raw record casts',
    pattern: 'Record<string, unknown>|as unknown as',
    paths: [
      'sdk/src/realm/client-types.ts',
      'sdk/src/realm/client-helpers.ts',
      'sdk/src/realm/extensions/account-data.ts',
      'sdk/src/runtime/runtime-modules.ts',
      'sdk/src/runtime/runtime-guards.ts',
      'sdk/src/runtime/types.ts',
      'sdk/src/runtime/errors.ts',
      'sdk/src/runtime/internal-context.ts',
      'sdk/src/runtime/runtime.ts',
      'sdk/src/runtime/runtime-lifecycle.ts',
      'sdk/src/runtime/types-media.ts',
      'sdk/src/runtime/runtime-media.ts',
      'sdk/src/ai/ai-config.ts',
      'sdk/src/ai/ai-config-diff.ts',
      'sdk/src/ai/app-ai-config.ts',
      'sdk/src/ai/i18n.ts',
      'sdk/src/ai/local-storage.ts',
      'sdk/src/ai/runtime-route-options.ts',
      'sdk/src/ai/runtime-route.ts',
      'sdk/src/ai/types.ts',
    ],
  },
  {
    description: 'desktop data-sync must not erase callApi results to Promise<any>',
    pattern: 'Promise<any>',
    paths: ['apps/desktop/src/runtime/data-sync'],
  },
  {
    description: 'desktop world data-sync surfaces must not return record-based payload contracts',
    pattern: 'Promise<Array<Record<string, unknown>>>|Promise<Record<string, unknown> \\| null>|items: Array<Record<string, unknown>>',
    paths: [
      'apps/desktop/src/runtime/data-sync/facade.ts',
      'apps/desktop/src/runtime/data-sync/flows/world-flow.ts',
      'apps/desktop/src/shell/renderer/features/world/world-detail-queries.ts',
    ],
  },
  {
    description: 'desktop runtime-bridge exported contracts must not expose raw unknown/record signatures',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/types.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-types.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/local-ai-types.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/external-agent.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/logging.ts',
      'apps/desktop/src/shell/renderer/infra/telemetry/renderer-log.ts',
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
      'apps/desktop/src/runtime/offline/cache-manager.ts',
      'apps/desktop/src/runtime/offline/types.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-connector-discover-command.ts',
    ],
  },
  {
    description: 'desktop agent detail surfaces must not restore typed payloads from raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as',
    paths: [
      'apps/desktop/src/runtime/data-sync/flows/agent-runtime-flow.ts',
      'apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-model.ts',
      'apps/desktop/src/shell/renderer/features/agent-detail/agent-detail-panel.tsx',
    ],
  },
  {
    description: 'desktop renderer-facing parser surfaces must use named JsonObject boundaries instead of raw record casts',
    pattern: 'Promise<unknown>|Record<string, unknown>|as unknown as|Promise<any>|as never',
    paths: [
      'apps/desktop/src/shell/renderer/features/realtime/chat-realtime-cache.ts',
      'apps/desktop/src/shell/renderer/features/relationship/relationship-model.ts',
      'apps/desktop/src/shell/renderer/features/relationship/agent-friend-limit.ts',
      'apps/desktop/src/shell/renderer/features/explore/explore-panel.tsx',
      'apps/desktop/src/shell/renderer/features/notification/notification-model.ts',
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
