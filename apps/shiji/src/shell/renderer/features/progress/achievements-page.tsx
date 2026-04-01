/**
 * achievements-page.tsx — SJ-PROG-004
 *
 * Achievement system with hardcoded definitions:
 *   - Explore achievements: first entry, N periods, all periods
 *   - Knowledge achievements: first verified, N verified, domain mastery
 *   - Dialogue achievements: complete chapter, divergent choice, N campfires
 *   - Special achievements: antagonist perspective, cross-period, full arc
 *
 * Achievements persist in `achievements` SQLite table.
 * Definitions are app-local (not from Realm) per SJ-PROG-004:6.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  sqliteGetAchievements,
  type Achievement,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

// ── Achievement definitions (SJ-PROG-004:6 — hardcoded) ─────────────────

type AchievementCategory = 'explore' | 'knowledge' | 'dialogue' | 'special';

type AchievementDef = {
  key: string;
  category: AchievementCategory;
  icon: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
};

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ── Explore ─────────────────────────────────────────
  {
    key: 'explore.first_world',
    category: 'explore',
    icon: '🌏',
    titleZh: '初入时间长河',
    titleEn: 'First Steps',
    descZh: '第一次进入一个历史时期',
    descEn: 'Enter a historical period for the first time',
  },
  {
    key: 'explore.three_worlds',
    category: 'explore',
    icon: '🗺️',
    titleZh: '三代游侠',
    titleEn: 'Three-Era Traveler',
    descZh: '探索了 3 个不同的历史时期',
    descEn: 'Explore 3 different historical periods',
  },
  {
    key: 'explore.five_worlds',
    category: 'explore',
    icon: '⚡',
    titleZh: '纵横五千年',
    titleEn: 'Five Millennia',
    descZh: '探索了 5 个不同的历史时期',
    descEn: 'Explore 5 different historical periods',
  },
  // ── Knowledge ───────────────────────────────────────
  {
    key: 'knowledge.first_verified',
    category: 'knowledge',
    icon: '📖',
    titleZh: '学有所得',
    titleEn: 'First Insight',
    descZh: '第一次通过知识验证',
    descEn: 'Pass your first knowledge verification',
  },
  {
    key: 'knowledge.ten_verified',
    category: 'knowledge',
    icon: '🏅',
    titleZh: '博闻强识',
    titleEn: 'Well-Read',
    descZh: '通过 10 次知识验证',
    descEn: 'Pass 10 knowledge verifications',
  },
  {
    key: 'knowledge.domain_master',
    category: 'knowledge',
    icon: '👑',
    titleZh: '一域之主',
    titleEn: 'Domain Master',
    descZh: '在一个领域内所有概念都达到验证深度',
    descEn: 'Verify all concepts in a single domain',
  },
  // ── Dialogue ────────────────────────────────────────
  {
    key: 'dialogue.first_chapter',
    category: 'dialogue',
    icon: '📜',
    titleZh: '翻开第一章',
    titleEn: 'First Chapter',
    descZh: '完成第一个章节',
    descEn: 'Complete your first chapter',
  },
  {
    key: 'dialogue.five_campfires',
    category: 'dialogue',
    icon: '🔥',
    titleZh: '篝火夜话',
    titleEn: 'Campfire Tales',
    descZh: '经历了 5 次篝火休憩场景',
    descEn: 'Experience 5 campfire scenes',
  },
  {
    key: 'dialogue.divergent_choice',
    category: 'dialogue',
    icon: '🔀',
    titleZh: '逆流而上',
    titleEn: 'Against the Current',
    descZh: '做出一个与历史走向不同的选择',
    descEn: 'Make a choice that diverges from historical events',
  },
  // ── Special ─────────────────────────────────────────
  {
    key: 'special.cross_period',
    category: 'special',
    icon: '🔗',
    titleZh: '以古鉴今',
    titleEn: 'Connecting Ages',
    descZh: '在不同时期中发现同一个知识点',
    descEn: 'Discover the same concept across different periods',
  },
  {
    key: 'special.antagonist_view',
    category: 'special',
    icon: '🎭',
    titleZh: '兼听则明',
    titleEn: 'Both Sides',
    descZh: '从对立角色的视角理解历史事件',
    descEn: 'Understand events from an antagonist\'s perspective',
  },
  {
    key: 'special.full_arc',
    category: 'special',
    icon: '🌅',
    titleZh: '一生足迹',
    titleEn: 'Full Journey',
    descZh: '完整体验一个历史人物的人生故事',
    descEn: 'Complete a full life arc of a historical figure',
  },
];

const CATEGORY_ORDER: AchievementCategory[] = ['explore', 'knowledge', 'dialogue', 'special'];

// ── Main component ────────────────────────────────────────────────────────

export default function AchievementsPage() {
  const { t, i18n } = useTranslation();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  const isZh = i18n.language.startsWith('zh');

  useEffect(() => {
    if (!activeProfile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const achievements = await sqliteGetAchievements(activeProfile.id);
        if (!cancelled) setUnlocked(achievements);
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile]);

  const unlockedKeys = useMemo(
    () => new Set(unlocked.map((a) => a.achievementKey)),
    [unlocked],
  );

  const unlockedDateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of unlocked) {
      map.set(a.achievementKey, new Date(a.unlockedAt).toLocaleDateString());
    }
    return map;
  }, [unlocked]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <h1 className="text-2xl font-bold text-stone-100 mb-2">
        {t('progress.achievements')}
      </h1>
      <p className="text-stone-500 text-sm mb-6">
        {unlockedKeys.size}/{ACHIEVEMENT_DEFS.length} {t('progress.achievementUnlocked').toLowerCase()}
      </p>

      {/* Category sections */}
      <div className="space-y-8">
        {CATEGORY_ORDER.map((category) => {
          const defs = ACHIEVEMENT_DEFS.filter((d) => d.category === category);
          return (
            <section key={category}>
              <h2 className="text-lg font-semibold text-stone-200 mb-3">
                {t(`progress.achievementCategories.${category}`)}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {defs.map((def) => {
                  const isUnlocked = unlockedKeys.has(def.key);
                  const dateStr = unlockedDateMap.get(def.key);
                  return (
                    <div
                      key={def.key}
                      className={[
                        'border rounded-xl px-4 py-3 transition-colors',
                        isUnlocked
                          ? 'bg-amber-900/20 border-amber-700/40'
                          : 'bg-stone-800/30 border-stone-700/40 opacity-60',
                      ].join(' ')}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{def.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-stone-100 font-medium text-sm">
                            {isZh ? def.titleZh : def.titleEn}
                          </p>
                          <p className="text-stone-400 text-xs mt-0.5">
                            {isZh ? def.descZh : def.descEn}
                          </p>
                          {isUnlocked && dateStr && (
                            <p className="text-amber-500 text-xs mt-1.5">
                              {t('progress.achievementUnlocked')} · {dateStr}
                            </p>
                          )}
                          {!isUnlocked && (
                            <p className="text-stone-600 text-xs mt-1.5">
                              {t('progress.achievementLocked')}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
