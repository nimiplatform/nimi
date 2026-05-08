import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { readTextIfFile } from "./fs-helpers.mjs";
import { packetAuthorityCoverage, packetAuthorityCoverageError } from "./topic-authority-coverage.mjs";
import { isRecognizedLifecycleArtifactName } from "./topic-lifecycle-artifacts.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";
import { loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import { getTopicWaves, loadTopicReport, topicHasEnrichedShape } from "./topic-scaffold.mjs";

export function readFrontmatterObject(text) {
  const parsed = parsePacketDraft(text);
  return parsed && typeof parsed == "object" ? parsed : null;
}
export function parsePacketDraft(text) {
  if (!text) return null;
  if (
    text.startsWith(`---
`)
  ) {
    const closing = text.indexOf(
      `
---
`,
      4,
    );
    if (closing !== -1) {
      const frontmatter = text.slice(4, closing);
      return parseYamlText(frontmatter);
    }
  }
  return parseYamlText(text);
}
export function packetFilenameFromId(packetId) {
  return `packet-${packetId}.md`;
}
export function resultFilename(waveId, slug, resultKind) {
  return `result-${waveId}-${resultKind}.md`;
}
export function decisionReviewFilename(slug) {
  return `decision-review-${slug}.md`;
}
export function remediationFilename(waveId, kind, reason) {
  return `packet-${waveId}-remediation-${kind}-${reason}.md`;
}
export function overflowContinuationFilename(waveId, continuationPacketId) {
  return `overflow-continuation-${waveId}-${continuationPacketId}.md`;
}
export function waveCloseoutFilename(waveId) {
  return `closeout-${waveId}.md`;
}
export function topicCloseoutFilename() {
  return "closeout-topic.md";
}
export function topicTrueCloseAuditFilename() {
  return "topic-true-close-audit.md";
}
export function topicTrueCloseJudgementFilename() {
  return "result-topic-true-close-audit.md";
}
export function topicTrueCloseRecordFilename() {
  return "result-topic-true-close.md";
}
export function pendingNoteFilename() {
  return "pending-note.md";
}
export function pendingNoteMarkdown(note) {
  return `---
${YAML.stringify(note).trimEnd()}
---

# Pending Note

Recorded by \`nimicoding topic hold\`.
`;
}
export function packetMarkdown(packet) {
  return `---
${YAML.stringify(packet).trimEnd()}
---

# Packet ${packet.packet_id}

Frozen by \`nimicoding topic packet freeze\`.
`;
}
export async function freezePacketForTopic(projectRoot, input, draftPath) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  if (!topicHasEnrichedShape(loaded.topic, authority))
    return { ok: false, error: "Packet freeze requires an enriched topic root." };
  const draftText = await readTextIfFile(path.resolve(projectRoot, draftPath));
  if (draftText === null) return { ok: false, error: `Draft packet not found: ${draftPath}` };
  const packet = parsePacketDraft(draftText);
  if (!packet || typeof packet != "object")
    return { ok: false, error: `Draft packet is not valid YAML/frontmatter: ${draftPath}` };
  const missingFields = authority.packetRequiredFields.filter((field) => {
    const value = packet[field];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
  if (missingFields.length > 0)
    return {
      ok: false,
      error: `Draft packet is missing required fields: ${missingFields.join(", ")}`,
    };
  if (packet.topic_id !== loaded.topicId)
    return {
      ok: false,
      error: `Draft packet topic_id does not match topic (${packet.topic_id} vs ${loaded.topicId})`,
    };
  if (!getTopicWaves(loaded.topic).find((entry) => entry.wave_id === packet.wave_id))
    return {
      ok: false,
      error: `Draft packet wave_id does not resolve inside the topic: ${packet.wave_id}`,
    };
  const wave = getTopicWaves(loaded.topic).find((entry) => entry.wave_id === packet.wave_id);
  const coverage = packetAuthorityCoverage(packet, wave);
  if (!coverage.ok)
    return {
      ok: false,
      error: packetAuthorityCoverageError(coverage),
      missingAuthorityOwnerRefs: coverage.missingAuthorityOwnerRefs,
      missingCanonicalSeamRefs: coverage.missingCanonicalSeamRefs,
    };
  if (!authority.packetFreezeAllowedStatuses.includes(packet.status))
    return { ok: false, error: `Draft packet status is not freezeable: ${packet.status}` };
  const packetFileName = packetFilenameFromId(packet.packet_id);
  if (!isRecognizedLifecycleArtifactName(packetFileName))
    return {
      ok: false,
      error: `Draft packet packet_id would create an ambiguous lifecycle artifact name: ${packetFileName}. Use a wave-prefixed packet id such as ${packet.wave_id}-${packet.packet_id}.`,
    };
  packet.status = "candidate";
  const packetPath = path.join(loaded.topicDir, packetFileName);
  return (
    await writeFile(packetPath, packetMarkdown(packet), "utf8"),
    {
      ok: true,
      topicId: loaded.topicId,
      topicRef: toPortableRelativePath(path.relative(projectRoot, loaded.topicDir)),
      packetId: packet.packet_id,
      packetRef: toPortableRelativePath(path.relative(projectRoot, packetPath)),
      waveId: packet.wave_id,
      status: packet.status,
    }
  );
}
export async function loadTopicPacket(projectRoot, input, packetId) {
  const loaded = await loadTopicReport(projectRoot, input);
  if (!loaded.ok) return loaded;
  const packetPath = path.join(loaded.topicDir, packetFilenameFromId(packetId)),
    packetText = await readTextIfFile(packetPath);
  if (packetText === null) return { ok: false, error: `Packet not found: ${packetId}` };
  const packet = parsePacketDraft(packetText);
  return !packet || typeof packet != "object"
    ? { ok: false, error: `Packet is not valid YAML/frontmatter: ${packetId}` }
    : { ok: true, ...loaded, packetPath, packet };
}
export async function listWavePackets(topicDir, waveId) {
  const entries = await readdir(topicDir, { withFileTypes: true }),
    packets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("packet-") || !entry.name.endsWith(".md"))
      continue;
    const packetPath = path.join(topicDir, entry.name),
      packetText = await readTextIfFile(packetPath),
      packet = readFrontmatterObject(packetText ?? "");
    packet?.wave_id === waveId && packets.push({ packet, packetPath, packetRefName: entry.name });
  }
  return packets.sort((left, right) => left.packetRefName.localeCompare(right.packetRefName));
}
export async function listWaveResults(topicDir, waveId) {
  const entries = await readdir(topicDir, { withFileTypes: true }),
    results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("result-") || !entry.name.endsWith(".md"))
      continue;
    const resultPath = path.join(topicDir, entry.name),
      resultText = await readTextIfFile(resultPath),
      result = readFrontmatterObject(resultText ?? "");
    result?.wave_id === waveId && results.push({ result, resultPath, resultRefName: entry.name });
  }
  return results.sort((left, right) => left.resultRefName.localeCompare(right.resultRefName));
}
