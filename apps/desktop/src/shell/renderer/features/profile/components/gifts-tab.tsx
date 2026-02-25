import { useEffect, useMemo, useState } from 'react';
import type { GiftCatalogItemDto } from '@nimiplatform/sdk-realm/models/GiftCatalogItemDto';
import { dataSync } from '@runtime/data-sync';
import type { GiftWallItem } from '../profile-model';

type GiftsTabProps = {
  giftStats: Record<string, number>;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

function GiftCard({ item }: { item: GiftWallItem }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-4 py-5">
      <span className="text-3xl">{item.emoji || '🎁'}</span>
      <span className="text-sm font-medium text-gray-900">{item.name}</span>
      <span className="text-xs text-gray-500">x{item.count}</span>
    </div>
  );
}

function GiftSkeleton() {
  return (
    <div className="animate-pulse flex flex-col items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-4 py-5">
      <div className="h-8 w-8 rounded-full bg-gray-200" />
      <div className="h-3 w-16 rounded bg-gray-200" />
      <div className="h-3 w-8 rounded bg-gray-100" />
    </div>
  );
}

export function GiftsTab({ giftStats }: GiftsTabProps) {
  const [catalog, setCatalog] = useState<GiftCatalogItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoadError(null);
        const items = await dataSync.loadGiftCatalog();
        if (!cancelled && items) setCatalog(items);
      } catch (error) {
        if (!cancelled) {
          setLoadError(toErrorMessage(error, 'Failed to load gift catalog'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const giftWall: GiftWallItem[] = useMemo(() => {
    const wall: GiftWallItem[] = [];
    for (const [giftId, count] of Object.entries(giftStats)) {
      const catalogItem = catalog.find((g) => g.id === giftId);
      if (catalogItem && count > 0) {
        wall.push({
          id: giftId,
          name: catalogItem.name,
          emoji: catalogItem.emoji || '🎁',
          iconUrl: catalogItem.iconUrl || null,
          energyCost: catalogItem.energyCost,
          count,
        });
      }
    }
    return wall.sort((a, b) => b.count - a.count);
  }, [giftStats, catalog]);

  const totalGifts = giftWall.reduce((sum, g) => sum + g.count, 0);

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        <GiftSkeleton />
        <GiftSkeleton />
        <GiftSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
          className="mt-3 rounded-[10px] bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (giftWall.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13" />
          <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
        </svg>
        No gifts received yet
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 text-center text-sm text-gray-500">
        {totalGifts} gift{totalGifts !== 1 ? 's' : ''} received
      </div>
      <div className="grid grid-cols-3 gap-3">
        {giftWall.map((item) => (
          <GiftCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
