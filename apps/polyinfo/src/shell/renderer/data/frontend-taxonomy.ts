import { hasTauriInvoke, invokeChecked } from '@renderer/bridge';
import type {
  FrontendCategoryGroup,
  FrontendCategoryItem,
  FrontendCategoryMapping,
  FrontendCategoryMappingRow,
  SectorTag,
} from './types.js';

const POLYMARKET_WEB_BASE = 'https://polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const FRONTEND_ROOT_CATEGORY_FALLBACK: FrontendCategoryGroup[] = [
  { id: 'politics', label: 'Politics', slug: 'politics', description: 'Polymarket 前台根分类。' },
  { id: 'sports', label: 'Sports', slug: 'sports', description: 'Polymarket 前台根分类。' },
  { id: 'crypto', label: 'Crypto', slug: 'crypto', description: 'Polymarket 前台根分类。' },
  { id: 'esports', label: 'Esports', slug: 'esports', description: 'Polymarket 前台根分类。' },
  { id: 'iran', label: 'Iran', slug: 'iran', description: 'Polymarket 前台根分类。' },
  { id: 'finance', label: 'Finance', slug: 'finance', description: 'Polymarket 前台根分类。' },
  { id: 'geopolitics', label: 'Geopolitics', slug: 'geopolitics', description: 'Polymarket 前台根分类。' },
  { id: 'tech', label: 'Tech', slug: 'tech', description: 'Polymarket 前台根分类。' },
  { id: 'culture', label: 'Culture', slug: 'culture', description: 'Polymarket 前台根分类。' },
  { id: 'economy', label: 'Economy', slug: 'economy', description: 'Polymarket 前台根分类。' },
  { id: 'weather', label: 'Weather', slug: 'weather', description: 'Polymarket 前台根分类。' },
  { id: 'mentions', label: 'Mentions', slug: 'mentions', description: 'Polymarket 前台根分类。' },
  { id: 'elections', label: 'Elections', slug: 'elections', description: 'Polymarket 前台根分类。' },
];

const HOMEPAGE_CATEGORY_BLACKLIST = new Set([
  '',
  'activity',
  'api',
  'breaking',
  'cash',
  'create',
  'event',
  'login',
  'logout',
  'markets',
  'more',
  'new',
  'notifications',
  'portfolio',
  'profile',
  'rewards',
  'search',
  'settings',
  'signup',
  'trending',
]);

const FRONTEND_ROOT_CATEGORY_ALLOWLIST = new Set(
  FRONTEND_ROOT_CATEGORY_FALLBACK.map((item) => item.slug),
);

type FrontendFilteredTagRecord = {
  id?: string | number;
  label?: string;
  name?: string;
  slug?: string;
  count?: number | string;
  eventCount?: number | string;
  eventsCount?: number | string;
  events_count?: number | string;
  marketsCount?: number | string;
  markets_count?: number | string;
};

type FrontendFilteredTagsResponse = {
  tags?: FrontendFilteredTagRecord[];
  data?: FrontendFilteredTagRecord[];
};

type FrontendEventRecord = {
  id?: string | number;
  title?: string;
  slug?: string;
};

type FrontendEventsKeysetResponse = {
  events?: FrontendEventRecord[];
  next_cursor?: string;
};

let rootCategoryCache: Promise<FrontendCategoryGroup[]> | null = null;
let sectorCatalogCache: Promise<SectorTag[]> | null = null;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status}`);
  }
  return response.text();
}

function parseUnknown<T>(value: unknown): T {
  return value as T;
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCount(record: FrontendFilteredTagRecord): number | undefined {
  const candidates = [
    record.count,
    record.eventCount,
    record.eventsCount,
    record.events_count,
    record.marketsCount,
    record.markets_count,
  ];
  for (const candidate of candidates) {
    const next = Number(candidate);
    if (Number.isFinite(next)) {
      return next;
    }
  }
  return undefined;
}

function parseHomepageRootCategories(html: string): FrontendCategoryGroup[] {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const candidates = new Map<string, FrontendCategoryGroup>();

  document.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^\/[a-z0-9-]+$/i.test(href)) {
      return;
    }
    const slug = href.slice(1).toLowerCase();
    if (HOMEPAGE_CATEGORY_BLACKLIST.has(slug)) {
      return;
    }
    if (!FRONTEND_ROOT_CATEGORY_ALLOWLIST.has(slug)) {
      return;
    }
    const label = normalizeLabel(anchor.textContent ?? '');
    if (!label || label.length > 24 || /\d/.test(label)) {
      return;
    }
    if (!candidates.has(slug)) {
      candidates.set(slug, {
        id: slug,
        slug,
        label,
        description: 'Polymarket 前台首页分类。',
      });
    }
  });

  const parsed = [...candidates.values()];
  if (parsed.length === 0) {
    return FRONTEND_ROOT_CATEGORY_FALLBACK;
  }

  const orderIndex = new Map<string, number>(
    FRONTEND_ROOT_CATEGORY_FALLBACK.map((item, index) => [item.slug, index]),
  );

  return parsed.sort((left, right) => {
    const leftKnown = orderIndex.get(left.slug);
    const rightKnown = orderIndex.get(right.slug);
    if (leftKnown !== undefined && rightKnown !== undefined) {
      return leftKnown - rightKnown;
    }
    if (leftKnown !== undefined) {
      return -1;
    }
    if (rightKnown !== undefined) {
      return 1;
    }
    return left.label.localeCompare(right.label);
  });
}

async function fetchHomepageHtml(): Promise<string> {
  return hasTauriInvoke()
    ? await invokeChecked('polymarket_frontend_homepage_html', {}, parseUnknown<string>)
    : await fetchText(`${POLYMARKET_WEB_BASE}/`);
}

async function fetchFilteredTagsBySlug(slug: string): Promise<FrontendFilteredTagRecord[]> {
  const payload = hasTauriInvoke()
    ? await invokeChecked(
      'polymarket_frontend_filtered_tags_by_slug',
      { slug },
      parseUnknown<FrontendFilteredTagsResponse | FrontendFilteredTagRecord[]>,
    )
    : await fetchJson<FrontendFilteredTagsResponse | FrontendFilteredTagRecord[]>(
      `${POLYMARKET_WEB_BASE}/api/tags/filteredBySlug?tag=${encodeURIComponent(slug)}&status=active`,
    );

  if (Array.isArray(payload)) {
    return payload;
  }
  return payload.tags ?? payload.data ?? [];
}

async function fetchEventsKeysetPage(
  slug: string,
  afterCursor?: string,
): Promise<FrontendEventsKeysetResponse> {
  if (hasTauriInvoke()) {
    return invokeChecked(
      'polymarket_events_by_tag_slug',
      { tagSlug: slug, limit: 100, afterCursor },
      parseUnknown<FrontendEventsKeysetResponse>,
    );
  }

  const search = new URLSearchParams({
    limit: '100',
    tag_slug: slug,
    closed: 'false',
    order: 'volume_24hr',
    ascending: 'false',
  });
  if (afterCursor) {
    search.set('after_cursor', afterCursor);
  }
  return fetchJson<FrontendEventsKeysetResponse>(`${GAMMA_API_BASE}/events/keyset?${search.toString()}`);
}

async function fetchAllEventsBySlug(slug: string): Promise<FrontendEventRecord[]> {
  const events: FrontendEventRecord[] = [];
  const seen = new Set<string>();
  let afterCursor: string | undefined;
  let pageCount = 0;

  while (pageCount < 50) {
    const page = await fetchEventsKeysetPage(slug, afterCursor);
    const nextEvents = page.events ?? [];
    for (const event of nextEvents) {
      const id = String(event.id ?? '');
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      events.push(event);
    }
    pageCount += 1;
    if (!page.next_cursor || nextEvents.length === 0) {
      break;
    }
    afterCursor = page.next_cursor;
  }

  return events;
}

async function mapWithConcurrency<TInput, TOutput>(
  input: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(input.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < input.length) {
      const currentIndex = cursor;
      cursor += 1;
      const currentItem = input[currentIndex];
      if (currentItem === undefined) {
        break;
      }
      results[currentIndex] = await worker(currentItem, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, input.length) }, () => runWorker()));
  return results;
}

export async function fetchFrontendRootCategories(): Promise<FrontendCategoryGroup[]> {
  if (!rootCategoryCache) {
    rootCategoryCache = fetchHomepageHtml().then((html) => parseHomepageRootCategories(html));
  }
  return rootCategoryCache;
}

export async function fetchFrontendSectorCatalog(): Promise<SectorTag[]> {
  if (!sectorCatalogCache) {
    sectorCatalogCache = (async () => {
      const roots = await fetchFrontendRootCategories();
      const subcategoryGroups = await mapWithConcurrency(roots, 4, (root) => fetchFrontendSubcategories(root));
      const sectors = new Map<string, SectorTag>();

      for (const root of roots) {
        sectors.set(root.slug, {
          id: root.id,
          label: root.label,
          slug: root.slug,
          description: root.description ?? 'Polymarket 前台根分类。',
        });
      }

      for (const children of subcategoryGroups) {
        for (const child of children) {
          if (child.slug === child.parentSlug) {
            continue;
          }
          const parent = roots.find((root) => root.slug === child.parentSlug);
          sectors.set(child.slug, {
            id: child.id,
            label: child.label,
            slug: child.slug,
            parentSlug: child.parentSlug,
            displayedCount: child.displayedCount,
            description: parent ? `${parent.label} / ${child.label}` : child.label,
          });
        }
      }

      return [...sectors.values()].sort((left, right) => {
        const leftParent = left.parentSlug ?? left.slug;
        const rightParent = right.parentSlug ?? right.slug;
        if (leftParent !== rightParent) {
          return leftParent.localeCompare(rightParent);
        }
        const leftKind = left.parentSlug ? 1 : 0;
        const rightKind = right.parentSlug ? 1 : 0;
        if (leftKind !== rightKind) {
          return leftKind - rightKind;
        }
        return left.label.localeCompare(right.label);
      });
    })();
  }
  return sectorCatalogCache;
}

export async function fetchFrontendSectorDirectory(): Promise<SectorTag[]> {
  const groups = await fetchFrontendRootCategories();
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    slug: group.slug,
    description: group.description,
  }));
}

export async function fetchFrontendSubcategories(root: FrontendCategoryGroup): Promise<FrontendCategoryItem[]> {
  const rows = await fetchFilteredTagsBySlug(root.slug);
  const deduped = new Map<string, FrontendCategoryItem>();

  deduped.set(root.slug, {
    id: root.slug,
    label: 'All',
    slug: root.slug,
    parentSlug: root.slug,
  });

  for (const row of rows) {
    const slug = String(row.slug ?? '').trim().toLowerCase();
    const label = normalizeLabel(String(row.label ?? row.name ?? ''));
    if (!slug || !label) {
      continue;
    }
    deduped.set(slug, {
      id: String(row.id ?? slug),
      label,
      slug,
      parentSlug: root.slug,
      displayedCount: parseCount(row),
    });
  }

  return [...deduped.values()];
}

export async function fetchFrontendCategoryMapping(root: FrontendCategoryGroup): Promise<FrontendCategoryMapping> {
  const categories = await fetchFrontendSubcategories(root);
  const rows = await mapWithConcurrency(categories, 3, async (category): Promise<FrontendCategoryMappingRow> => {
    const events = await fetchAllEventsBySlug(category.slug);
    return {
      category,
      fetchedCount: events.length,
      pageCount: Math.ceil(events.length / 100),
      sampleEvents: events.slice(0, 3).map((event) => ({
        id: String(event.id ?? ''),
        title: String(event.title ?? ''),
        slug: String(event.slug ?? ''),
      })),
    };
  });

  const normalizedRows = rows.map((row) => (
    row.category.slug === root.slug && typeof row.category.displayedCount !== 'number'
      ? {
        ...row,
        category: {
          ...row.category,
          displayedCount: row.fetchedCount,
        },
      }
      : row
  ));

  return {
    root,
    generatedAt: new Date().toISOString(),
    rows: normalizedRows,
  };
}
