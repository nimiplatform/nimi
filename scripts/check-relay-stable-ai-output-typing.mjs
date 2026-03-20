import { execFileSync } from 'node:child_process';

const checks = [
  {
    description: 'relay stable AI object outputs must not be re-parsed through asRecord(result.object)',
    pattern: 'asRecord\\(result\\.object\\)',
    paths: [
      'apps/relay/src/main/chat-pipeline/turn-composer.ts',
      'apps/relay/src/main/chat-pipeline/turn-perception.ts',
      'apps/relay/src/main/proactive/decision.ts',
      'apps/relay/src/main/media/media-planner.ts',
    ],
  },
  {
    description: 'relay stable AI object outputs must call generateObject with an explicit result type',
    pattern: 'generateObject\\({',
    paths: [
      'apps/relay/src/main/chat-pipeline/turn-composer.ts',
      'apps/relay/src/main/chat-pipeline/turn-perception.ts',
      'apps/relay/src/main/proactive/decision.ts',
      'apps/relay/src/main/media/media-planner.ts',
    ],
  },
];

function runRipgrep(pattern, paths) {
  try {
    return execFileSync('rg', ['-n', '-F', pattern, ...paths], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    return error.status === 1 ? '' : (() => { throw error; })();
  }
}

const failures = [];

for (const check of checks) {
  const matches = runRipgrep(check.pattern, check.paths);
  if (matches) {
    failures.push(`[relay-stable-ai-output-typing] ${check.description}\n${matches}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[relay-stable-ai-output-typing] Passed.');
