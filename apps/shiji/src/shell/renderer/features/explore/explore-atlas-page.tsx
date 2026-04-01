/**
 * explore-atlas-page.tsx — SJ-MAP-001 ~ 005
 *
 * Historical atlas view. Currently blocked on backend endpoint:
 *   GET /api/world/by-id/{worldId}/map-profile (status: proposed)
 *
 * Per SJ-MAP-005: fail-close on missing data — show "unavailable" message
 * rather than fabricating placeholder geography.
 *
 * Per SJ-MAP-002: map display requires both catalog gating (mapAvailability)
 * and a matching map profile. Both are currently unavailable.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getActiveCatalogEntries } from '@renderer/data/world-catalog.js';

export default function ExploreAtlasPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Check catalog for map-eligible worlds (SJ-MAP-002)
  const mapEligibleWorlds = useMemo(() => {
    return getActiveCatalogEntries().filter((w) => w.mapAvailability);
  }, []);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <h1 className="text-2xl font-bold text-stone-100 mb-2">
        历史地图
      </h1>
      <p className="text-stone-500 text-sm mb-8">
        时间长河的空间维度 — 地点、路线与事件
      </p>

      {/* SJ-MAP-005: fail-close — map profile endpoint not yet available */}
      <div className="bg-stone-800/40 border border-stone-700/50 rounded-xl px-6 py-8 text-center max-w-lg mx-auto mt-12">
        <div className="text-4xl mb-4">🗺️</div>
        <p className="text-stone-300 font-medium mb-2">
          {t('error.mapUnavailable')}
        </p>
        <p className="text-stone-500 text-sm mb-1">
          地图数据端点 (map-profile API) 尚未上线。
        </p>
        <p className="text-stone-500 text-sm mb-4">
          {mapEligibleWorlds.length > 0
            ? `${mapEligibleWorlds.length} 个时期标记为地图可用，等待后端支持。`
            : '目前没有时期标记为地图可用。'}
        </p>
        <button
          onClick={() => navigate('/explore')}
          className="text-amber-400 hover:text-amber-300 text-sm underline"
        >
          返回时间长河
        </button>
      </div>
    </div>
  );
}
