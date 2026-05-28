import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const checks = [
  {
    description: 'stable sync output helpers must not parse text/vector payloads from Struct.fields or record reparsing',
    pattern: 'fields\\.(text|vectors)|asRecord\\(output\\)|asRecord\\(record\\.output\\)|asRecord\\(outputValue\\.(textGenerate|textEmbed)\\)',
    paths: [
      'sdk/src/runtime/helpers.ts',
      'sdk/src/ai-provider/helpers.ts',
      'apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts',
    ],
  },
  {
    description: 'stable audio/media input bridges must not guess mime types via application/octet-stream or audio/wav defaults',
    pattern: 'application/octet-stream|audio/wav',
    paths: [
      'sdk/src/ai-provider/helpers.ts',
      'runtime/internal/nimillm/transcription_chat_compat.go',
      'apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts',
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
      'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-profiles.ts',
    ],
  },
  {
    description: 'stable stream helpers must not treat typed runtime events as generic records',
    pattern: 'asRecord\\(event\\.payload\\)|asRecord\\(deltaPayload\\)|oneofKind\\s*===\\s*[\'"]delta[\'"]',
    paths: [
      'sdk/src/runtime/runtime-ai-text.ts',
      'sdk/src/runtime/runtime-modality.ts',
      'sdk/src/ai-provider/model-factory-language.ts',
    ],
  },
  {
    description: 'stable ai-provider request builders must not erase typed scenario requests to Record<string, unknown>',
    pattern: 'as unknown as Record<string, unknown>',
    paths: [
      'sdk/src/ai-provider/model-factory-image.ts',
      'sdk/src/ai-provider/model-factory-video.ts',
      'sdk/src/ai-provider/model-factory-speech.ts',
      'sdk/src/ai-provider/model-factory-transcription.ts',
    ],
  },
  {
    description: 'stable transcription/text helpers must not reconstruct product semantics from artifact bytes after typed output exists',
    pattern: 'decodeUtf8\\(first\\.bytes\\)|toUtf8\\(firstArtifact\\.bytes\\)|artifacts:\\s*artifacts\\.artifacts',
    paths: [
      'sdk/src/runtime/runtime-modality.ts',
      'sdk/src/ai-provider/model-factory-transcription.ts',
    ],
  },
  {
    description: 'desktop must not restore local kernel turn orchestration after Runtime Agent ownership',
    pattern: 'executeLocalKernelTurn|ExecuteLocalKernelTurn|stateDelta:|memoryWrites:',
    paths: [
      'apps/desktop/src/runtime/llm-adapter',
    ],
  },
  {
    description: 'desktop runtime execution bridges must not carry redundant fallbackPolicy fields or re-inject fallback deny into stable requests',
    pattern: 'fallbackPolicy|fallback:\\s*resolved\\.',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts',
    ],
  },
];

function runRipgrep(pattern, paths) {
  const existingPaths = paths.filter((targetPath) => existsSync(targetPath));
  if (existingPaths.length === 0) {
    return '';
  }
  try {
    return execFileSync('rg', ['-n', pattern, ...existingPaths], {
      cwd: process.cwd(),
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
