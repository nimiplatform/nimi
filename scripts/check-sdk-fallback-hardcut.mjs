#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const checks = [
  {
    description: 'app-facing runtime and ai-provider public types must not expose fallback knobs',
    pattern: 'AiFallbackPolicy|NimiFallbackPolicy|fallback\\?:',
    paths: [
      'sdk/src/types/index.ts',
      'sdk/src/runtime/types-media.ts',
      'sdk/src/runtime/runtime-convenience.ts',
      'sdk/src/ai-provider/types.ts',
    ],
  },
  {
    description: 'stable runtime request builders must not read app-facing fallback input or re-inject deny defaults outside low-level normalization',
    pattern: 'input\\.fallback|toFallbackPolicy\\(|fallback:\\s*FallbackPolicy\\.DENY',
    paths: [
      'sdk/src/runtime/runtime-ai-text.ts',
      'sdk/src/runtime/runtime-media.ts',
      'sdk/src/runtime/runtime-modality.ts',
    ],
  },
  {
    description: 'high-level ai-provider builders must not inject app-facing fallback defaults',
    pattern: 'APP_FACING_FALLBACK_POLICY|fallback:\\s*FallbackPolicy\\.DENY',
    paths: [
      'sdk/src/ai-provider/model-factory-language.ts',
      'sdk/src/ai-provider/model-factory-embedding.ts',
      'sdk/src/ai-provider/model-factory-image.ts',
      'sdk/src/ai-provider/model-factory-video.ts',
      'sdk/src/ai-provider/model-factory-speech.ts',
      'sdk/src/ai-provider/model-factory-transcription.ts',
      'sdk/src/ai-provider/helpers.ts',
    ],
  },
  {
    description: 'high-level runtime convenience must not invent implicit local/default or provider/default targets',
    pattern: "local/default|model\\s*\\|\\|\\s*'default'",
    paths: [
      'sdk/src/runtime/runtime-convenience.ts',
    ],
  },
  {
    description: 'raw runtime client validation must not auto-normalize fallback policy to deny',
    pattern: 'fallback:\\s*FallbackPolicy\\.DENY',
    paths: [
      'sdk/src/runtime/core/client-validation.ts',
    ],
  },
  {
    description: 'stable media helpers must not synthesize placeholder artifacts or default binary mime types',
    pattern: 'fallbackArtifactId|application/octet-stream',
    paths: [
      'sdk/src/runtime/runtime-modality.ts',
    ],
  },
  {
    description: 'realm client must fail-close and may not rescue contract violations via plain-text success paths',
    pattern: 'maybeHandlePlainTextSuccess|ready_probe_failed',
    paths: [
      'sdk/src/realm/client.ts',
    ],
  },
  {
    description: 'app-facing bootstrap and relay paths must not pass fallback allow/deny into stable runtime surfaces',
    pattern: "fallback:\\s*'(?:allow|deny)'",
    paths: [
      'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-media.ts',
      'apps/desktop/src/runtime/llm-adapter/speech/engine/index.ts',
      'apps/desktop/src/runtime/llm-adapter/speech/engine/open-stream.ts',
      'apps/relay/src/main/input-transform.ts',
      'examples/sdk/providers/_common.ts',
    ],
  },
];

function runRipgrep(pattern, paths) {
  try {
    return execFileSync('rg', ['-n', pattern, ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('sdk fallback hardcut requires `rg` to be installed');
    }
    if (typeof error.status === 'number' && error.status === 1) {
      return '';
    }
    throw error;
  }
}

const failures = [];

for (const check of checks) {
  const matches = runRipgrep(check.pattern, check.paths);
  if (matches) {
    failures.push(`[sdk-fallback-hardcut] ${check.description}\n${matches}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[sdk-fallback-hardcut] Passed.');
