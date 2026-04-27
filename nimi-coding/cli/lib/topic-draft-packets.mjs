import { readdir } from "node:fs/promises";
import path from "node:path";

import { readTextIfFile } from "./fs-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function parsePacketDraft(text) {
  if (!text) return null;
  if (text.startsWith("---\n")) {
    const closing = text.indexOf("\n---\n", 4);
    if (closing !== -1) {
      return parseYamlText(text.slice(4, closing));
    }
  }
  return parseYamlText(text);
}

export async function findUniqueFreezableDraftPacket(projectRoot, loaded, wave, authority) {
  const matches = [];
  for (const entry of await readdir(loaded.topicDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^draft.*\.(ya?ml|md)$/u.test(entry.name.toLowerCase())) continue;
    const draftPath = path.join(loaded.topicDir, entry.name);
    const packet = parsePacketDraft(await readTextIfFile(draftPath) ?? "");
    if (!packet || typeof packet !== "object") continue;
    if (packet.topic_id !== loaded.topicId || packet.wave_id !== wave.wave_id) continue;
    if (!authority.packetFreezeAllowedStatuses.includes(packet.status)) continue;
    if (authority.packetRequiredFields.some((field) => {
      const value = packet[field];
      return value == null || value === "" || (Array.isArray(value) && value.length === 0);
    })) continue;
    matches.push({
      packet,
      draftRef: toPortableRelativePath(path.relative(projectRoot, draftPath)),
    });
  }
  return matches.length === 1
    ? { ok: true, ...matches[0] }
    : {
      ok: false,
      reasonCode: matches.length === 0
        ? "admitted_wave_requires_packet"
        : "admitted_wave_has_ambiguous_draft_packets",
    };
}
