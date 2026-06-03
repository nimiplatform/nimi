// Vite-bound loader for the canonical VRM emote table. Schema normalization
// lives in Kit; avatar only owns bundling the spec raw YAML into this app.

import { parse as parseYaml } from 'yaml';
import emoteTableYaml from '../../../../../../.nimi/spec/avatar/kernel/tables/vrm-emote-states.yaml?raw';
import {
  normalizeVrmEmoteTable,
  type VrmEmoteTable,
} from '@nimiplatform/kit/features/avatar/vrm';

let cached: VrmEmoteTable | null = null;

export function loadVrmEmoteTable(): VrmEmoteTable {
  if (cached !== null) return cached;
  const parsed = parseYaml(emoteTableYaml);
  cached = normalizeVrmEmoteTable(parsed);
  return cached;
}
