import type { GiftCatalogItemDto } from '@nimiplatform/sdk/realm';

export type SendGiftCatalogItem = {
  id: string;
  name: string;
  emoji: string;
  iconUrl: string | null;
  sparkCost: number;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function parseSparkCost(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function toGiftCatalogItem(value: unknown): SendGiftCatalogItem | null {
  const record = toRecord(value) as (GiftCatalogItemDto & Record<string, unknown>) | null;
  if (!record) {
    return null;
  }
  const id = String(record.id || '').trim();
  if (!id) {
    return null;
  }
  const sparkCost = parseSparkCost(record.sparkCost);
  if (sparkCost == null) {
    return null;
  }
  const name = String(record.name || id).trim() || id;
  const emoji = String(record.emoji || '').trim() || '🎁';
  const iconUrl = String(record.iconUrl || '').trim() || null;
  return {
    id,
    name,
    emoji,
    iconUrl,
    sparkCost,
  };
}

export function normalizeGiftCatalog(input: unknown): SendGiftCatalogItem[] {
  const root = toRecord(input);
  const rawItems = Array.isArray(input)
    ? input
    : (Array.isArray(root?.items) ? root.items : []);
  return rawItems
    .map((item) => toGiftCatalogItem(item))
    .filter((item): item is SendGiftCatalogItem => Boolean(item));
}

export function resolveSelectedGiftId(
  items: readonly SendGiftCatalogItem[],
  currentId: string,
): string {
  const normalizedCurrentId = String(currentId || '').trim();
  if (normalizedCurrentId && items.some((item) => item.id === normalizedCurrentId)) {
    return normalizedCurrentId;
  }
  return items[0]?.id || '';
}
