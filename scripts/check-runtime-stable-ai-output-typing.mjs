import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    description: 'vNext stable sync output helpers must not parse text/vector payloads from Struct.fields or record reparsing',
    pattern: 'fields\\.(text|vectors)|asRecord\\(output\\)|asRecord\\(record\\.output\\)|asRecord\\(outputValue\\.(textGenerate|textEmbed)\\)',
    paths: [
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/core/ai/text-runner.ts',
      'sdks/typescript/core/ai/embeddings.ts',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge',
    ],
  },
  {
    description: 'vNext stable audio/media bridges must not guess mime types through generic defaults',
    pattern: '\\|\\|\\s*[\'"](?:application/octet-stream|audio/wav)[\'"]|\\?\\?\\s*[\'"](?:application/octet-stream|audio/wav)[\'"]',
    paths: [
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/features/generation/runtime-scenarios.ts',
      'runtime/internal/nimillm/transcription_chat_compat.go',
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge',
    ],
  },
  {
    description: 'runtime stable transcription paths must not synthesize heuristic usage when provider usage is absent',
    pattern: 'EstimateTokens\\(text\\)|len\\(audio\\)/256|len\\(audio\\)/64',
    paths: [
      'runtime/internal/nimillm/transcription_chat_compat.go',
    ],
  },
  {
    description: 'desktop stable audio cache helpers must fail-close instead of returning nullable cache writes or unchanged artifacts on cache failure',
    pattern: 'Promise<RuntimePackageMediaCachePutResult \\| null>|return input\\.artifact;|!cached\\?\\.uri',
    paths: [
      'apps/desktop/src/shell/renderer/infra/offline/cache-manager.ts',
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sdk-service.ts',
    ],
  },
  {
    description: 'vNext stable stream helpers must not treat typed runtime events as generic records',
    pattern: 'asRecord\\(event\\.payload\\)|asRecord\\(deltaPayload\\)|as unknown as Record<string, unknown>',
    paths: [
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/core/ai/text-runner.ts',
      'sdks/typescript/adapters/vercel-ai',
    ],
  },
  {
    description: 'vNext generation request builders must not erase typed scenario requests to Record<string, unknown>',
    pattern: 'as unknown as Record<string, unknown>',
    paths: [
      'sdks/typescript/features/generation/runtime-scenarios.ts',
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/adapters/openai-compatible',
      'sdks/typescript/adapters/vercel-ai',
    ],
  },
  {
    description: 'vNext transcription/text helpers must not reconstruct product semantics or hide missing artifact arrays after typed output exists',
    pattern: 'decodeUtf8\\(first\\.bytes\\)|toUtf8\\(firstArtifact\\.bytes\\)|artifacts:\\s*artifacts\\.artifacts\\s*\\|\\|',
    paths: [
      'sdks/typescript/runtime/scenario-jobs.ts',
      'sdks/typescript/core/ai/runtime-model.ts',
      'sdks/typescript/features/generation/runtime-scenarios.ts',
    ],
  },
  {
    description: 'desktop must not restore local kernel turn orchestration after Runtime Agent ownership',
    pattern: 'executeLocalKernelTurn|ExecuteLocalKernelTurn|stateDelta:|memoryWrites:',
    paths: [
      'apps/desktop/src/shell/renderer',
    ],
  },
  {
    description: 'desktop runtime execution bridges must not carry redundant fallbackPolicy fields or re-inject fallback deny into stable requests',
    pattern: 'fallbackPolicy|fallback:\\s*resolved\\.',
    paths: [
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge',
    ],
  },
];

function runRipgrep(pattern, paths) {
  const missingPaths = paths.filter((targetPath) => !existsSync(path.join(repoRoot, targetPath)));
  if (missingPaths.length > 0) {
    return `missing required runtime stable output scan target(s): ${missingPaths.join(', ')}`;
  }
  try {
    return execFileSync('rg', ['-n', pattern, ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
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
    failures.push(`[runtime-stable-ai-output-typing] ${check.description}\n${matches}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[runtime-stable-ai-output-typing] Passed.');
