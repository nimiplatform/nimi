import { isMainWorld, type WorldListItem } from './world-list-model';

const WORLD_MEDIA_PLACEHOLDER = 'var(--nimi-surface-hero)';

export const WORLD_ATLAS_LEAD_WORLD_IDS = [
  'cbdb-ming-lettered-networks-world', // 明代士人交游网络
  'meridian-archipelago', // 行脉诸洲
  'd10', // 春风得意行
  'deepblue-observatories', // 深蓝群站
  'emberware-court', // 瓷炭院
] as const;

// These worlds were reviewed in their real detail pages for both populated
// people catalogs and setting illustrations. This is editorial placement, not
// a local copy of counts.
export const WORLD_DISCOVERY_OPENING_IDS = [
  'thinink-plains', 'summerwell-village', 'prism-city-network', 'oneiric-littoral', 'living-echo-continent',
] as const;

export const WORLD_DISCOVERY_DEFERRED_IDS = [
  'cbdb-qing-scholar-gentry-world', 'cbdb-tang-literati-world', 'cbdb-northern-song-scholar-official-world',
  'cbdb-southern-song-memory-world', 'cbdb-yuan-literati-academy-world',
] as const;

const WORLD_DISCOVERY_GRID_COLUMNS = 3;
const WORLD_DISCOVERY_DEFERRED_FIRST_ROW = 21;
const WORLD_DISCOVERY_DEFERRED_ROW_GAP = 5;

// Reviewed cover sequence for discovery, not World facts. Alternate scenery,
// palette and composition as well as topics: the four table-facing ensemble
// covers (y01/y05/y02/y04) must not form another adjacent block.
const WORLD_DISCOVERY_ORDER: readonly string[] = [
  'x05', 'z04', 'u06', // Snowfield, lantern market, sunlit coast.
  'y01', 'z02', 'x06', // Mecha team, flooded cathedral, jazz bar.
  'y06', 'u05', 'y05', // Palace rooftops, flying dragon, hotpot shelter.
  'x03', 'y03', 'u04', // Neon truck, gala portrait, luminous ocean.
  'y02', 'x04', 'x01', // Mountain sect, bathhouse gathering, street musician.
  'z05', 'x02', 'y04', // Museum heist, masked auction, seaside supper.
];

function orderWorldDiscoveryPage(worlds: readonly WorldListItem[]): WorldListItem[] {
  const reviewed = worlds.filter(world => WORLD_DISCOVERY_ORDER.includes(world.id))
    .sort((left, right) => WORLD_DISCOVERY_ORDER.indexOf(left.id) - WORLD_DISCOVERY_ORDER.indexOf(right.id));
  const topics = new Map<string, WorldListItem[]>();
  for (const world of worlds) {
    if (WORLD_DISCOVERY_ORDER.includes(world.id)) continue;
    // Group by the first explicit topic (or genre), never infer from copy/ids.
    const topic = world.topicIds?.[0] || world.genre || '';
    const group = topics.get(topic) ?? [];
    group.push(world);
    topics.set(topic, group);
  }
  const interleaved: WorldListItem[] = [];
  for (let index = 0; interleaved.length < worlds.length - reviewed.length; index += 1) {
    for (const group of topics.values()) {
      const world = group[index];
      if (world) interleaved.push(world);
    }
  }
  return [...reviewed, ...interleaved];
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function selectWorldCatalogWorlds(
  pages: readonly { items: readonly WorldListItem[] }[],
  searchQuery: string,
  topicId: string,
): WorldListItem[] {
  // Reorder inside each server page so loading more only appends cards. Search
  // and topic results retain their server ranking; favorites use their own list.
  const discovery = !searchQuery.trim() && !topicId;
  return pages.flatMap(page => discovery ? orderWorldDiscoveryPage(page.items) : page.items);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function selectWorldSpotlight(worlds: readonly WorldListItem[], leadWorlds: readonly WorldListItem[], pendingIds: ReadonlySet<string> = new Set()) {
  const byId = new Map([...worlds, ...leadWorlds].map((world) => [world.id, world]));
  const leads: WorldListItem[] = [];
  for (const id of WORLD_ATLAS_LEAD_WORLD_IDS) {
    const world = byId.get(id);
    if (!world && pendingIds.has(id)) return leads;
    if (world && !isMainWorld(world) && (world.heroMedia || world.bannerMedia || world.bannerUrl)) leads.push(world);
  }
  // Opening cards have reserved positions even before the catalog arrives.
  const reserved = new Set<string>([...WORLD_ATLAS_LEAD_WORLD_IDS, ...WORLD_DISCOVERY_OPENING_IDS]);
  const fallback = worlds.filter(world => !reserved.has(world.id)
    && !isMainWorld(world) && (world.heroMedia || world.bannerMedia || world.bannerUrl));
  return [...leads, ...fallback].slice(0, 5);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function selectWorldDiscoverySlots(
  worlds: readonly WorldListItem[], leadWorlds: readonly WorldListItem[], pendingIds: ReadonlySet<string>,
  spotlightIds: ReadonlySet<string>,
) {
  const byId = new Map([...worlds, ...leadWorlds].map(world => [world.id, world]));
  const slots: { id: string; world: WorldListItem | null }[] = [];
  for (const id of WORLD_DISCOVERY_OPENING_IDS) {
    const world = byId.get(id);
    if (world || pendingIds.has(id)) slots.push({ id, world: world ?? null });
  }
  if (WORLD_ATLAS_LEAD_WORLD_IDS.some(id => pendingIds.has(id) && !byId.has(id))) {
    return { slots, waitingForSpotlight: true };
  }

  const reserved = new Set<string>([...WORLD_DISCOVERY_OPENING_IDS, ...WORLD_DISCOVERY_DEFERRED_IDS, ...spotlightIds]);
  for (const world of worlds) {
    if (!reserved.has(world.id)) slots.push({ id: world.id, world });
  }
  const deferred = WORLD_DISCOVERY_DEFERRED_IDS.flatMap(id => {
    const world = byId.get(id);
    return world && !spotlightIds.has(id) ? [world] : [];
  });
  for (const [index, world] of deferred.entries()) {
    const row = WORLD_DISCOVERY_DEFERRED_FIRST_ROW + index * WORLD_DISCOVERY_DEFERRED_ROW_GAP;
    const targetIndex = (row - 1) * WORLD_DISCOVERY_GRID_COLUMNS;
    if (slots.length < targetIndex) break;
    slots.splice(targetIndex, 0, { id: world.id, world });
  }
  return { slots, waitingForSpotlight: false };
}

export function worldHeroBackground(imageUrl: string | null): string {
  if (imageUrl) {
    return `url(${imageUrl}) center/cover no-repeat`;
  }
  return WORLD_MEDIA_PLACEHOLDER;
}

export function worldThumbBackground(imageUrl: string | null): string {
  return imageUrl ? `url(${imageUrl}) center/cover no-repeat` : WORLD_MEDIA_PLACEHOLDER;
}

export function sourceCount(world: WorldListItem): number {
  return world.characterCount + world.personaCharacterCount;
}

/**
 * Display tags come only from the world's explicit genre, themes and optional era, in that
 * order. Nothing is inferred from ids, names, anchors or text, and mixed-script tags are kept.
 */
export function displayTags(world: Pick<WorldListItem, 'genre' | 'themes' | 'era'>, limit = 4): string[] {
  const values: string[] = [];
  for (const value of [world.genre, ...world.themes, world.era]) {
    const tag = value?.trim().replace(/\s+/g, ' ');
    if (!tag || values.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      continue;
    }
    values.push(tag);
  }
  return values.slice(0, Math.max(0, limit));
}

export function worldSummary(world: WorldListItem): string {
  return world.tagline || world.description || world.overview || '';
}

export function statusLabel(world: WorldListItem): string {
  if (world.freezeReason || world.status === 'FROZEN') {
    return 'Locked';
  }
  if (world.status === 'SYSTEM') {
    return 'System';
  }
  return 'Public';
}

export function selectInitialWorld(worlds: readonly WorldListItem[]): string | null {
  const firstCreatorWorld = worlds.find((world) => !isMainWorld(world));
  return firstCreatorWorld?.id ?? worlds[0]?.id ?? null;
}
