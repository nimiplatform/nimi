import { existsSync, promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const forbiddenMarkers = [
  ['realm-profile-context', /realmProfileContext|realm_profile_context/gu],
  ['anchor-profile-prompt', /publicChatAnchorSystemPromptFromMetadata|conversationAnchorProfileContext|publicChatRealmProfilePromptHeader/gu],
  ['apml-repair', /repairPublicChatStructuredEnvelope|shouldAttemptPublicChatAPMLRepair|Runtime APML repair task/gu],
];

function runtimeConsumerSourceFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z', '--', 'runtime/internal/services/runtimeagent'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return [...new Set(output.split('\0').filter(Boolean))]
    .filter((relPath) => existsSync(path.join(repoRoot, relPath)))
    .filter((relPath) => relPath.endsWith('.go'))
    .filter((relPath) => !relPath.endsWith('_test.go'))
    .filter((relPath) => !relPath.includes('/generated/'))
    .sort();
}

export async function runtimeContextConsumerCodeFindings(repoRoot) {
  const findings = [];
  for (const relPath of runtimeConsumerSourceFiles(repoRoot)) {
    const content = await fs.readFile(path.join(repoRoot, relPath), 'utf8');
    for (const [id, pattern] of forbiddenMarkers) {
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)];
      if (matches.length === 0) continue;
      const lines = [...new Set(matches.map((match) => content.slice(0, match.index).split('\n').length))];
      findings.push(`${id}: ${relPath}:${lines.join(',')} (${matches.length} occurrence(s))`);
    }
  }
  for (const relPath of [
    'runtime/internal/services/runtimeagent/agent_turn_context_compiler.go',
    'runtime/internal/services/runtimeagent/agent_turn_context_projection.go',
  ]) {
    try {
      const stat = await fs.stat(path.join(repoRoot, relPath));
      if (!stat.isFile()) findings.push(`typed-context-compiler: ${relPath} is not a file`);
    } catch {
      findings.push(`typed-context-compiler: ${relPath} is missing`);
    }
  }
  return findings;
}
