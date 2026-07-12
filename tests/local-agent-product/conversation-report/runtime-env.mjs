import path from 'node:path';

import { buildMergedEnv } from '../../../scripts/lib/live-env.mjs';
import { synthesizeLiveProviderEnvDefaults } from '../../../scripts/lib/live-provider-defaults.mjs';
import { repoRoot } from '../harness/registry.mjs';

export function loadConversationReportEnvironment(baseEnv = process.env) {
  const merged = buildMergedEnv({
    baseEnv,
    filePaths: [
      path.join(repoRoot, 'config', 'live', 'dashscope-gold-path.env'),
      path.join(repoRoot, '.env'),
    ],
  });
  const derived = synthesizeLiveProviderEnvDefaults({ repoRoot, env: merged });
  return { ...derived.env, ...merged };
}

export function projectConversationReportRuntimeEnvironment(env) {
  const projected = { ...env };
  for (const [key, value] of Object.entries(env || {})) {
    const match = /^NIMI_LIVE_([A-Z0-9_]+)_(API_KEY|BASE_URL)$/u.exec(key);
    if (!match || !String(value || '').trim()) continue;
    const runtimeKey = `NIMI_RUNTIME_CLOUD_${match[1]}_${match[2]}`;
    if (!String(projected[runtimeKey] || '').trim()) projected[runtimeKey] = value;
  }
  return projected;
}
