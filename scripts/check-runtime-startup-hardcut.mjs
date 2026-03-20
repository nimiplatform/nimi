import { execFileSync } from 'node:child_process';

const checks = [
  {
    description: 'runtime startup must not fall back to empty persisted state or empty registry',
    pattern: 'fallback to empty state|fallback to empty registry',
    paths: [
      'runtime/internal/services/localservice/state_store.go',
      'runtime/internal/grpcserver/server.go',
    ],
  },
  {
    description: 'custom speech catalog failure must not fall back to built-in snapshot when a custom dir is configured',
    pattern: 'fallback to built-in snapshot|custom dir ignored',
    paths: [
      'runtime/internal/services/ai/service.go',
      'runtime/internal/aicatalog/resolver.go',
    ],
  },
  {
    description: 'workflow helpers must not rescue invalid payloads or missing noop inputs by returning empty Struct success objects',
    pattern: 'fallback, _ := structpb\\.NewStruct\\(map\\[string\\]any\\{\\}\\)|structpb\\.NewStruct\\(map\\[string\\]any\\{\\}\\)|return map\\[string\\]\\*structpb\\.Struct\\{\"output\": structFromMap\\(map\\[string\\]any\\{\\}\\)\\}',
    paths: [
      'runtime/internal/services/workflow/helpers.go',
      'runtime/internal/services/workflow/executor_standard_nodes.go',
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
    failures.push(`[runtime-startup-hardcut] ${check.description}\n${matches}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[runtime-startup-hardcut] Passed.');
