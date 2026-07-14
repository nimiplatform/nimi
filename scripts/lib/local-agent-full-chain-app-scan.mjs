import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const forbiddenMarkers = [
  ['packet-v1', /realm\.source-materialization-packet\/v1/gu],
  ['source-display-metadata', /sourceDisplayMetadata/gu],
  ['hmac-secret-config', /SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET|SOURCE_PACKET_HMAC_SECRET|SourceMaterializationPacketHMACSecret|sourceMaterializationPacketHmacSecret|sourceMaterializationPacketHMACSecret|sourceMaterializationHMACSecretEnv|sourcePacketSecret/gu],
  ['hmac-proof', /hmac-sha256|createHmac|crypto\/hmac/gu],
  ['fixed-desktop-audience', /nimi\.desktop\.local-agent\.materialization/gu],
  ['realm-profile-context', /realmProfileContext|realm_profile_context/gu],
  ['anchor-profile-prompt', /publicChatAnchorSystemPromptFromMetadata|conversationAnchorProfileContext|publicChatRealmProfilePromptHeader/gu],
  ['apml-repair', /repairPublicChatStructuredEnvelope|shouldAttemptPublicChatAPMLRepair|Runtime APML repair task/gu],
];

export async function fullScopeAppCodeFindings(repoRoot) {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'apps'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const files = [...new Set(output.split('\0').filter(Boolean))]
    .filter((file) => /\.(?:go|rs|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|md)$/u.test(file))
    .sort();
  const findings = [];
  for (const relPath of files) {
    let content;
    try {
      content = await fs.readFile(path.join(repoRoot, relPath), 'utf8');
    } catch (error) {
      // `git ls-files -c` reports index entries that are intentionally deleted
      // in the current hardcut. A deleted path has no active source to scan;
      // every other filesystem failure remains a checker error.
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const [id, pattern] of forbiddenMarkers) {
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)];
      if (matches.length === 0) continue;
      const lines = [...new Set(matches.map((match) => content.slice(0, match.index).split('\n').length))];
      findings.push(`${id}: ${relPath}:${lines.join(',')} (${matches.length} occurrence(s))`);
    }
  }
  return findings;
}
