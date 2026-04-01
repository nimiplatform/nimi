/**
 * knowledge-graph-page.tsx — SJ-KNOW-005, SJ-KNOW-006, SJ-KNOW-007
 *
 * Knowledge graph page: accumulated learning across all worlds.
 *   - Top level: group by World (historical period)
 *   - Second level: group by domain
 *   - Leaf: concept with depth indicator (grey=0, blue=1, gold=2)
 *   - Statistics bar: total concepts, verified %, domain distribution
 *   - Cross-world connections as dotted-line badges (SJ-KNOW-006)
 *   - Classification provenance per world (SJ-KNOW-007)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sqliteGetKnowledgeEntries,
  type KnowledgeEntry,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { getActiveCatalogEntries } from '@renderer/data/world-catalog.js';
import {
  getClassification,
  type ClassificationPair,
} from '@renderer/data/classification.js';

// ── Depth color helpers ─────────────────────────────────────────────────

const DEPTH_COLORS: Record<number, string> = {
  0: 'bg-stone-500',   // grey — mentioned
  1: 'bg-blue-500',    // blue — explained
  2: 'bg-amber-500',   // gold — verified
};

const DEPTH_RING: Record<number, string> = {
  0: 'ring-stone-500/30',
  1: 'ring-blue-500/30',
  2: 'ring-amber-500/30',
};

function DepthDot({ depth }: { depth: number }) {
  const color = DEPTH_COLORS[depth] ?? DEPTH_COLORS[0];
  const ring = DEPTH_RING[depth] ?? DEPTH_RING[0];
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color} ring-2 ${ring}`}
      title={`depth ${depth}`}
    />
  );
}

// ── Domain label ────────────────────────────────────────────────────────

const DOMAIN_KEYS = [
  'politics',
  'military',
  'philosophy',
  'economy',
  'culture',
  'geography',
  'institution',
  'unknown',
] as const;

// ── Types ───────────────────────────────────────────────────────────────

type GroupedWorld = {
  worldId: string;
  worldName: string;
  classification: ClassificationPair | null;
  domains: Map<string, KnowledgeEntry[]>;
  totalCount: number;
  verifiedCount: number;
};

// ── Main component ────────────────────────────────────────────────────────

export default function KnowledgeGraphPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedWorlds, setExpandedWorlds] = useState<Set<string>>(new Set());

  // ── Load all knowledge entries for learner ──────────────────────────────

  useEffect(() => {
    if (!activeProfile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all = await sqliteGetKnowledgeEntries(activeProfile.id);
        if (!cancelled) setEntries(all);
      } catch {
        // Non-critical — show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile]);

  // ── Group entries by world → domain ─────────────────────────────────────

  const { worldGroups, crossWorldKeys, globalStats } = useMemo(() => {
    const catalog = getActiveCatalogEntries();
    const catalogMap = new Map(catalog.map((c) => [c.worldId, c]));

    // Group by worldId
    const worldMap = new Map<string, KnowledgeEntry[]>();
    for (const e of entries) {
      const list = worldMap.get(e.worldId) ?? [];
      list.push(e);
      worldMap.set(e.worldId, list);
    }

    const groups: GroupedWorld[] = [];
    let totalAll = 0;
    let verifiedAll = 0;

    for (const [worldId, worldEntries] of worldMap) {
      const catalogEntry = catalogMap.get(worldId);
      const worldName = catalogEntry?.displayName ?? worldId;
      const classification = catalogEntry
        ? getClassification(catalogEntry.contentType, catalogEntry.truthMode)
        : null;

      // Group by domain within world
      const domains = new Map<string, KnowledgeEntry[]>();
      let verified = 0;
      for (const e of worldEntries) {
        const domainKey = DOMAIN_KEYS.includes(e.domain as typeof DOMAIN_KEYS[number])
          ? e.domain
          : 'unknown';
        const list = domains.get(domainKey) ?? [];
        list.push(e);
        domains.set(domainKey, list);
        if (e.depth >= 2) verified++;
      }

      totalAll += worldEntries.length;
      verifiedAll += verified;

      groups.push({
        worldId,
        worldName,
        classification,
        domains,
        totalCount: worldEntries.length,
        verifiedCount: verified,
      });
    }

    // Cross-world connections (SJ-KNOW-006): concept keys appearing in multiple worlds
    const keyWorldCount = new Map<string, string[]>();
    for (const e of entries) {
      const worlds = keyWorldCount.get(e.conceptKey) ?? [];
      if (!worlds.includes(e.worldId)) worlds.push(e.worldId);
      keyWorldCount.set(e.conceptKey, worlds);
    }
    const crossKeys = new Map<string, string[]>();
    for (const [key, worlds] of keyWorldCount) {
      if (worlds.length >= 2) crossKeys.set(key, worlds);
    }

    return {
      worldGroups: groups,
      crossWorldKeys: crossKeys,
      globalStats: { total: totalAll, verified: verifiedAll },
    };
  }, [entries]);

  // ── Toggle world expansion ──────────────────────────────────────────────

  function toggleWorld(worldId: string) {
    setExpandedWorlds((prev) => {
      const next = new Set(prev);
      if (next.has(worldId)) next.delete(worldId);
      else next.add(worldId);
      return next;
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  const verifiedPercent =
    globalStats.total > 0
      ? Math.round((globalStats.verified / globalStats.total) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      {/* Header */}
      <h1 className="text-2xl font-bold text-stone-100 mb-1">
        {t('knowledge.title')}
      </h1>

      {/* Stats bar */}
      {globalStats.total > 0 && (
        <div className="flex items-center gap-4 text-sm text-stone-400 mb-6">
          <span>{t('knowledge.totalConcepts', { count: globalStats.total })}</span>
          <span className="text-amber-400">
            {t('knowledge.verifiedPercent', { percent: verifiedPercent })}
          </span>
          {/* Depth legend */}
          <span className="flex items-center gap-1.5 ml-auto text-xs">
            <DepthDot depth={0} />{t('knowledge.depthMentioned')}
            <DepthDot depth={1} />{t('knowledge.depthExplained')}
            <DepthDot depth={2} />{t('knowledge.depthVerified')}
          </span>
        </div>
      )}

      {/* Empty state */}
      {worldGroups.length === 0 && (
        <div className="text-stone-500 text-sm mt-12 text-center">
          {t('knowledge.empty')}
        </div>
      )}

      {/* Cross-world connections banner (SJ-KNOW-006) */}
      {crossWorldKeys.size > 0 && (
        <div className="bg-stone-800/60 border border-stone-700/50 rounded-lg px-4 py-3 mb-6">
          <p className="text-stone-300 text-sm font-medium mb-2">
            {t('knowledge.crossWorld')}
          </p>
          <div className="flex flex-wrap gap-2">
            {[...crossWorldKeys.entries()].slice(0, 12).map(([key, worlds]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 bg-stone-700/60 border border-dashed border-stone-500/40 rounded px-2 py-0.5 text-xs text-stone-300"
                title={worlds.join(', ')}
              >
                <span className="text-amber-400">{key}</span>
                <span className="text-stone-500">×{worlds.length}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* World groups */}
      <div className="space-y-4">
        {worldGroups.map((group) => {
          const expanded = expandedWorlds.has(group.worldId);
          const worldVerifiedPercent =
            group.totalCount > 0
              ? Math.round((group.verifiedCount / group.totalCount) * 100)
              : 0;

          return (
            <div
              key={group.worldId}
              className="bg-stone-800/40 border border-stone-700/50 rounded-xl overflow-hidden"
            >
              {/* World header */}
              <button
                onClick={() => toggleWorld(group.worldId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-800/60 transition-colors"
              >
                <span className="text-stone-400 text-sm">{expanded ? '▾' : '▸'}</span>
                <span className="text-stone-100 font-medium">{group.worldName}</span>

                {/* Classification badge (SJ-KNOW-007) */}
                {group.classification && (
                  <span className="text-xs px-2 py-0.5 rounded bg-stone-700 text-stone-300">
                    {group.classification.badge}
                  </span>
                )}

                <span className="ml-auto text-xs text-stone-500">
                  {group.totalCount} · {worldVerifiedPercent}%
                </span>
              </button>

              {/* Expanded: domains → concepts */}
              {expanded && (
                <div className="border-t border-stone-700/40 px-4 py-3 space-y-3">
                  {DOMAIN_KEYS.map((domainKey) => {
                    const domainEntries = group.domains.get(domainKey);
                    if (!domainEntries || domainEntries.length === 0) return null;
                    return (
                      <div key={domainKey}>
                        <p className="text-xs text-stone-500 font-medium mb-1.5 uppercase tracking-wide">
                          {t(`knowledge.domains.${domainKey}`)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {domainEntries.map((entry) => {
                            const isCrossWorld = crossWorldKeys.has(entry.conceptKey);
                            return (
                              <span
                                key={entry.id}
                                className={[
                                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm',
                                  'bg-stone-700/50 text-stone-200',
                                  isCrossWorld ? 'border border-dashed border-amber-600/40' : '',
                                ].join(' ')}
                                title={`${entry.conceptKey} (depth ${entry.depth})`}
                              >
                                <DepthDot depth={entry.depth} />
                                <span>{entry.conceptKey.split('.').pop()}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Link to world detail page */}
                  <button
                    onClick={() => navigate(`/knowledge/${group.worldId}`)}
                    className="text-xs text-amber-400 hover:text-amber-300 mt-2"
                  >
                    {t('knowledge.worldKnowledge', { world: group.worldName })} →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
