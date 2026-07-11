import { existsSync, promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const legacyRules = [
  {
    id: 'packet-v1',
    pattern: /realm\.source-materialization-packet\/v1/gu,
  },
  {
    id: 'hmac-secret-config',
    pattern: /SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET|SourceMaterializationPacketHMACSecret|sourceMaterializationPacketHmacSecret|sourceMaterializationPacketHMACSecret|sourceMaterializationHMACSecretEnv|SOURCE_PACKET_HMAC_SECRET/gu,
  },
  {
    id: 'hmac-proof',
    pattern: /hmac-sha256|createHmac|crypto\/hmac/gu,
  },
  {
    id: 'fixed-desktop-audience',
    pattern: /nimi\.desktop\.local-agent\.materialization/gu,
  },
  {
    id: 'initialize-packet-bridge',
    pattern: /sourceMaterializationPacketMetadataKey|initializeRequestHasSourceMaterializationPacket|verifySourceMaterializationPacketForInitialize|sanitizeInitializeAgentMetadata|consumeSourceMaterializationPacketNonce|\bsourceMaterializationPacket\b/gu,
  },
  {
    id: 'runtime-source-bypass',
    pattern: /runtimeSourceRequiresMaterializationPacket/gu,
  },
  {
    id: 'metadata-provenance-fallback',
    pattern: /metadata\.sourceMaterialization|metadata\[['"]sourceMaterialization['"]\]|fromNimiRuntimeProtoStruct\(agent\.metadata\)/gu,
  },
];

// Retired markers may remain only where the implementation or a named test
// proves typed rejection. Each allowance is path + rule + classification
// bound; it cannot hide a marker in another file or another rule family.
const rejectionAllowlist = new Map([
  [
    'runtime/internal/services/runtimeagent/agent_admin_runtime.go::initialize-packet-bridge',
    {
      classification: 'rejected',
      proof: /metadata key %q is reserved/u,
    },
  ],
  [
    'runtime/internal/services/runtimeagent/local_agent_identity_hardcut_test.go::initialize-packet-bridge',
    {
      classification: 'rejected',
      proof: /TestInitializeAgentRejectsRealmSourceAndRetiredPacketMetadata/u,
    },
  ],
]);

function trackedFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'runtime', 'sdks/typescript/runtime'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter((relPath) => existsSync(path.join(repoRoot, relPath)))
    .filter((relPath) => !relPath.startsWith('runtime/gen/'))
    .filter((relPath) => !relPath.startsWith('sdks/typescript/core-generated/'))
    .filter((relPath) => /\.(?:go|ts|tsx|js|mjs|cjs|json|yaml|yml)$/u.test(relPath))
    .sort();
}

export async function runtimeMaterializationCodeFindings(repoRoot) {
  const findings = [];
  for (const relPath of trackedFiles(repoRoot)) {
    const content = await fs.readFile(path.join(repoRoot, relPath), 'utf8');
    for (const rule of legacyRules) {
      rule.pattern.lastIndex = 0;
      const matches = [...content.matchAll(rule.pattern)];
      if (matches.length === 0) continue;
      const allowance = rejectionAllowlist.get(`${relPath}::${rule.id}`);
      if (allowance?.classification === 'rejected' && allowance.proof.test(content)) continue;
      const lines = [...new Set(matches.map((match) => content.slice(0, match.index).split('\n').length))];
      findings.push(`${rule.id}: ${relPath}:${lines.join(',')} (${matches.length} occurrence(s))`);
    }
  }
  return findings;
}
