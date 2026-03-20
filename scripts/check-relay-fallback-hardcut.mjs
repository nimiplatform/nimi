import { execFileSync } from 'node:child_process';

const checks = [
  {
    description: 'stable relay media execution must not synthesize default image/video mime types',
    pattern: "mimeType\\s*\\|\\|\\s*'(?:image/png|video/mp4)'|data:\\$\\{artifact\\.mimeType\\s*\\|\\|",
    paths: [
      'apps/relay/src/main/media/media-execution-pipeline.ts',
    ],
  },
  {
    description: 'relay bootstrap and agent pickers must not synthesize stub agents or manual-id fallback',
    pattern: "using stub|return \\{ id: agentId, name: agentId \\}|selectAgent\\(\\{ id, name: id \\}\\)|placeholder=\\\"agent-id\\\"",
    paths: [
      'apps/relay/src/renderer/infra/bootstrap.ts',
      'apps/relay/src/renderer/features/agent/components/agent-selector.tsx',
      'apps/relay/src/renderer/features/agent/components/agent-picker-popover.tsx',
      'apps/relay/test/bootstrap.test.ts',
      'apps/relay/test/agent-core.test.ts',
    ],
  },
  {
    description: 'relay route option discovery must not collapse timeout/error into empty-success results',
    pattern: "withTimeout\\([^\\n]+,\\s*LOAD_TIMEOUT_MS,\\s*(?:\\[\\]|\\{ models: \\[\\], nextPageToken: '' \\})",
    paths: [
      'apps/relay/src/main/route/route-options.ts',
    ],
  },
  {
    description: 'relay media orchestration must not keep fallback-named pseudo-success paths or local/default media route defaults',
    pattern: 'fallbackMessage|fallbackRouteSource|local/default',
    paths: [
      'apps/relay/src/main/chat-pipeline/send-flow.ts',
      'apps/relay/src/main/media/media-route.ts',
      'apps/relay/src/main/chat-pipeline/relay-ai-client.ts',
      'apps/relay/src/main/input-transform.ts',
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
    failures.push(`[relay-fallback-hardcut] ${check.description}\n${matches}`);
  }
}
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[relay-fallback-hardcut] Passed.');
