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
export const WORLD_DISCOVERY_LEAD_WORLD_IDS = [
  'cbdb-qing-scholar-gentry-world', // 清代士绅世界
  'thinink-plains', // 薄墨平原
  'summerwell-village', // 夏井乡
  'cbdb-tang-literati-world', // 唐代文人世界
  'prism-city-network', // 折光城网
  'oneiric-littoral', // 寐烛山海
  'cbdb-northern-song-scholar-official-world', // 北宋士大夫世界
  'living-echo-continent', // 昼忆大陆
  'cbdb-southern-song-memory-world', // 南宋士人记忆世界
  'cbdb-yuan-literati-academy-world', // 元代文人书院世界
] as const;

const WORLD_DISCOVERY_DEFERRED_WORLD_IDS = new Set([
  'cbdb-qing-scholar-gentry-world',
  'cbdb-tang-literati-world',
  'cbdb-northern-song-scholar-official-world',
  'cbdb-southern-song-memory-world',
  'cbdb-yuan-literati-academy-world',
]);
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
export function selectWorldSpotlight(worlds: readonly WorldListItem[], leadWorlds: readonly WorldListItem[]) {
  const byId = new Map([...worlds, ...leadWorlds].map((world) => [world.id, world]));
  const leads = WORLD_ATLAS_LEAD_WORLD_IDS.flatMap((id) => {
    const world = byId.get(id);
    return world ? [world] : [];
  });
  const leadIds = new Set(leads.map((world) => world.id));
  return [...leads, ...worlds.filter((world) => !leadIds.has(world.id))]
    .filter((world) => !isMainWorld(world) && (world.heroMedia || world.bannerMedia || world.bannerUrl))
    .slice(0, 5);
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function selectWorldDiscoveryWorlds(worlds: readonly WorldListItem[], leadWorlds: readonly WorldListItem[]) {
  const byId = new Map([...worlds, ...leadWorlds].map(world => [world.id, world]));
  const leads = WORLD_DISCOVERY_LEAD_WORLD_IDS.flatMap(id => {
    if (WORLD_DISCOVERY_DEFERRED_WORLD_IDS.has(id)) return [];
    const world = byId.get(id);
    return world ? [world] : [];
  });
  const deferredLeads = WORLD_DISCOVERY_LEAD_WORLD_IDS.flatMap(id => {
    if (!WORLD_DISCOVERY_DEFERRED_WORLD_IDS.has(id)) return [];
    const world = byId.get(id);
    return world ? [world] : [];
  });
  const leadIds = new Set([...leads, ...deferredLeads].map(world => world.id));
  const ordered = [...leads, ...worlds.filter(world => !leadIds.has(world.id))];
  for (const [index, world] of deferredLeads.entries()) {
    const row = WORLD_DISCOVERY_DEFERRED_FIRST_ROW + index * WORLD_DISCOVERY_DEFERRED_ROW_GAP;
    const targetIndex = (row - 1) * WORLD_DISCOVERY_GRID_COLUMNS;
    if (ordered.length < targetIndex) break;
    ordered.splice(targetIndex, 0, world);
  }
  return ordered;
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
