import { isMainWorld, type WorldListItem } from './world-list-model';

const WORLD_MEDIA_PLACEHOLDER = 'var(--nimi-surface-hero)';

// Curated flagship r16 worlds for the Explore Hero carousel: alternating
// genre, palette, and tone so first-time visitors see the breadth of Nimi Realm.
export const WORLD_ATLAS_LEAD_WORLD_IDS = [
  'tianting-outsourcing',  // 南天门外包部：西游后五百年 (myth-cyber comedy)
  'changan-demon-ward',    // 长安十二坊：大理寺捉妖录 (Tang night mystery)
  'neon-kowloon-sector9',  // 九龙雨夜：第九义体城寨 (cyberpunk rain mystery)
  'z04',                   // 鲤灯夜游：星河渡水上夜市 (luminous canal fantasy/romance)
  'pawprint-harbor-town',  // 爪印海港镇：全员毛绒自治 (cozy coastal everyday)
] as const;

// Opening discovery grid worlds verified in r16 with full cast, scenes, and voice.
export const WORLD_DISCOVERY_OPENING_IDS = [
  'shanhai-749-market',       // 山海 749：地下异兽收容夜市
  'midnight-apex-circuit',    // 午夜湾岸：零点极速联赛
  'honglou-brocade-mansion',  // 金陵春尽：大观园暗涌
  'cloudvein-oceans',         // 云脉气海：万米浮空商团
  'apocalypse-hotpot-bunker', // 零下六十度：满级地堡涮火锅
] as const;

export const WORLD_DISCOVERY_DEFERRED_IDS: readonly string[] = [] as const;

const WORLD_DISCOVERY_GRID_COLUMNS = 3;
const WORLD_DISCOVERY_DEFERRED_FIRST_ROW = 21;
const WORLD_DISCOVERY_DEFERRED_ROW_GAP = 5;

// Reviewed cover sequence across the r16 catalog so consecutive 3-column rows
// alternate visual mood, era, and topic instead of clustering alphabetical IDs.
const WORLD_DISCOVERY_ORDER: readonly string[] = [
  'fengshen-bronze-ruins',    // Shang-Zhou bronze epic
  'love-show-night-stall',    // Sunlit island romance/comedy
  'global-death-exam',        // High-stakes future arena
  'liaozhai-paper-village',   // Atmospheric folklore mystery
  'junkyard-mecha-girl',      // Scrapyard mecha comedy/arena
  'cwe-b01-u08',              // 1928 Sapphire Express mystery
  'yokai-department-9f',      // Midnight supernatural department store
  'song-frontier-squad',      // Northern Song time-travel frontier
  'rainy-rental-alley',       // Warm rainy-season slice of life
  'tower-livestream-arena',   // Tower livestream spectacle
  'dayong-court-gossip',      // Imperial court mind-reading comedy
  'frontier-cantina-belt',    // Asteroid-belt space cantina
  'escort-of-ghost-road',     // Wilderness rules-horror caravan
  'shanghai-88f-pitch',       // Modern Lujiazui 88F drama/comedy
  'cwe-b02-u10',              // Slacker cultivation mountain
  'x02',                      // Venetian masked falsetto auction
  'eighteen-great-grandma',   // Rejuvenated great-grandma comedy
  'di-fu-bureaucracy',        // Underworld reincarnation lottery
  'u01',                      // Lingnan lion-dance arcade street
  'astral-academy-district',  // Eccentric astral academy
  'jianghu-debt-inn',         // Wuxia debt-ledger inn
  'cwe-b06-u11',              // Holographic wasteland night stall
  'cwe-b01-u07',              // Haunted grand hotel comedy
  'x01',                      // Masked wrestler courtyard
  'general-in-urban-village', // Ancient general in urban village
  'z03',                      // Fog-strait lighthouse & whale-bone post
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
