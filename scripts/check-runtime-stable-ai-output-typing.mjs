import { execFileSync } from 'node:child_process';

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
      'apps/desktop/src/runtime/llm-adapter/tauri-bridge.ts',
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
    pattern: 'Promise<RuntimeModMediaCachePutResult \\| null>|return input\\.artifact;|!cached\\?\\.uri',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/tauri-bridge.ts',
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
    description: 'desktop text execution must not reparse typed executeScenario responses through record casts',
    pattern: 'asRecord\\(response|responseRecord\\.|asRecord\\(response\\.usage',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts',
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
    description: 'desktop local kernel turn result must stay a named typed contract instead of a raw record payload',
    pattern: 'ExecuteLocalKernelTurnResult = Record<string, unknown>|stateDelta: \\(result\\.stateDelta as Record<string, unknown>\\)',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/execution/types.ts',
      'apps/desktop/src/runtime/execution-kernel/kernel/flows/local-turn-flow.ts',
    ],
  },
  {
    description: 'desktop replay summaries and workflow replay requests must stay typed instead of raw record payloads',
    pattern: 'artifactSummary\\?: Record<string, unknown>|request: Record<string, unknown>|summary: Record<string, unknown>',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/execution/replay.ts',
    ],
  },
  {
    description: 'desktop runtime execution bridges must not carry redundant fallbackPolicy fields or re-inject fallback deny into stable requests',
    pattern: 'fallbackPolicy|fallback:\\s*resolved\\.',
    paths: [
      'apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts',
      'apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts',
      'apps/desktop/src/runtime/llm-adapter/execution/replay.ts',
    ],
  },
  {
    description: 'desktop control-plane client must fail-close instead of returning synthetic verify/grant/revocation/audit fallbacks',
    pattern: 'fallback:\\s|return input\\.fallback|verified:\\s*input\\.mode ===|CONTROL_PLANE_UNAVAILABLE|accepted:\\s*input\\.records\\.length|items:\\s*\\[\\]',
    paths: [
      'apps/desktop/src/runtime/control-plane/http.ts',
      'apps/desktop/src/runtime/control-plane/client.ts',
    ],
  },
];

function runRipgrep(pattern, paths) {
  try {
    return execFileSync('rg', ['-n', pattern, ...paths], {
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
