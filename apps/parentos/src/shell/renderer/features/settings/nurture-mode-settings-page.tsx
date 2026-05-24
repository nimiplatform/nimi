import { Link } from 'react-router-dom';
import { SelectField, Surface, cn } from '@nimiplatform/kit/ui';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { NURTURE_MODES, REMINDER_DOMAINS } from '../../knowledge-base/index.js';
import { updateChild } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';

/* ── labels ─────────────────────────────────────────────────── */

const P1_LABELS: Record<string, string> = { push: '主动推送', silent: '静默记录', hidden: '隐藏' };
const DIGEST_LABELS: Record<string, string> = { realtime: '实时', daily: '每日汇总', weekly: '每周汇总' };

const MODE_META: Record<string, {
  emoji: string;
  cardClassName: string;
  iconClassName: string;
  textClassName: string;
  dotClassName: string;
  domainRowClassName: string;
}> = {
  relaxed: {
    emoji: '🌿',
    cardClassName: 'parentos-mode-card-relaxed-active',
    iconClassName: 'parentos-mode-icon-relaxed-active',
    textClassName: 'parentos-mode-text-relaxed-active',
    dotClassName: 'parentos-mode-dot-relaxed-active',
    domainRowClassName: 'parentos-domain-row-relaxed-active',
  },
  balanced: {
    emoji: '⚖️',
    cardClassName: 'parentos-mode-card-balanced-active',
    iconClassName: 'parentos-mode-icon-balanced-active',
    textClassName: 'parentos-mode-text-balanced-active',
    dotClassName: 'parentos-mode-dot-balanced-active',
    domainRowClassName: 'parentos-domain-row-balanced-active',
  },
  advanced: {
    emoji: '🔬',
    cardClassName: 'parentos-mode-card-advanced-active',
    iconClassName: 'parentos-mode-icon-advanced-active',
    textClassName: 'parentos-mode-text-advanced-active',
    dotClassName: 'parentos-mode-dot-advanced-active',
    domainRowClassName: 'parentos-domain-row-advanced-active',
  },
};

const FALLBACK_MODE_META = {
  emoji: '📋',
  cardClassName: 'parentos-mode-card-advanced-active',
  iconClassName: 'parentos-mode-icon-fallback-active',
  textClassName: 'parentos-mode-text-fallback-active',
  dotClassName: 'parentos-mode-dot-fallback-active',
  domainRowClassName: 'parentos-domain-row-advanced-active',
};

const DOMAIN_LABELS: Record<string, string> = {
  'bone-age': '骨龄评估', career: '职业启蒙', checkup: '体检', dental: '口腔',
  digital: '数字素养', emotional: '情绪管理', growth: '生长发育', hygiene: '卫生习惯',
  independence: '独立能力', interest: '兴趣培养', language: '语言发展', nutrition: '营养膳食',
  relationship: '人际关系', safety: '安全防护', sensitivity: '敏感期', sexuality: '性教育',
  sleep: '睡眠', vaccine: '疫苗接种', values: '价值观', vision: '视力',
};

const DOMAIN_GROUPS: Array<{ label: string; emoji: string; iconClassName: string; domains: string[] }> = [
  { label: '身体健康', emoji: '💪', iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,var(--nimi-surface-card))]', domains: ['growth', 'nutrition', 'sleep', 'checkup', 'vaccine', 'dental', 'vision', 'bone-age'] },
  { label: '心智发展', emoji: '🧠', iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-card))]', domains: ['language', 'emotional', 'sensitivity', 'independence'] },
  { label: '社会能力', emoji: '🤝', iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]', domains: ['relationship', 'values', 'sexuality', 'safety', 'hygiene'] },
  { label: '兴趣与规划', emoji: '🌟', iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))]', domains: ['interest', 'career', 'digital'] },
];

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function NurtureModeSettingsPage() {
  const { activeChildId, children, setChildren } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  if (!child) {
    return (
      <div className="h-full overflow-y-auto bg-transparent">
        <div className="mx-auto max-w-3xl px-6 pb-6 pt-[86px]">
          <Link to="/settings" className="text-[14px] text-[var(--nimi-text-muted)] hover:underline">← 返回设置</Link>
          <p className="mt-6 text-[14px] text-[var(--nimi-text-muted)]">请先选择一个孩子</p>
        </div>
      </div>
    );
  }

  const handleModeChange = async (newMode: NurtureMode) => {
    const nextOverridesEntries = Object.entries(child.nurtureModeOverrides ?? {}).filter(
      ([, mode]) => mode !== newMode,
    );
    const nextOverrides = nextOverridesEntries.length > 0
      ? Object.fromEntries(nextOverridesEntries) as Record<string, NurtureMode>
      : null;
    const now = isoNow();
    try {
      await updateChild({
        childId: child.childId, displayName: child.displayName, gender: child.gender,
        birthDate: child.birthDate, birthWeightKg: child.birthWeightKg,
        birthHeightCm: child.birthHeightCm, birthHeadCircCm: child.birthHeadCircCm,
        avatarPath: child.avatarPath, nurtureMode: newMode,
        nurtureModeOverrides: nextOverrides ? JSON.stringify(nextOverrides) : null,
        allergies: child.allergies ? JSON.stringify(child.allergies) : null,
        medicalNotes: child.medicalNotes ? JSON.stringify(child.medicalNotes) : null,
        recorderProfiles: child.recorderProfiles ? JSON.stringify(child.recorderProfiles) : null,
        now,
      });
      setChildren(children.map((c) => c.childId === child.childId
        ? { ...c, nurtureMode: newMode, nurtureModeOverrides: nextOverrides, updatedAt: now }
        : c));
    } catch { /* bridge unavailable */ }
  };

  const handleDomainOverride = async (domain: string, mode: NurtureMode | null) => {
    const overrides = { ...(child.nurtureModeOverrides ?? {}) };
    if (mode === null || mode === child.nurtureMode) {
      delete overrides[domain];
    } else {
      overrides[domain] = mode;
    }
    const newOverrides = Object.keys(overrides).length > 0 ? overrides : null;
    const now = isoNow();
    try {
      await updateChild({
        childId: child.childId, displayName: child.displayName, gender: child.gender,
        birthDate: child.birthDate, birthWeightKg: child.birthWeightKg,
        birthHeightCm: child.birthHeightCm, birthHeadCircCm: child.birthHeadCircCm,
        avatarPath: child.avatarPath, nurtureMode: child.nurtureMode,
        nurtureModeOverrides: newOverrides ? JSON.stringify(newOverrides) : null,
        allergies: child.allergies ? JSON.stringify(child.allergies) : null,
        medicalNotes: child.medicalNotes ? JSON.stringify(child.medicalNotes) : null,
        recorderProfiles: child.recorderProfiles ? JSON.stringify(child.recorderProfiles) : null,
        now,
      });
      setChildren(children.map((c) => c.childId === child.childId ? { ...c, nurtureModeOverrides: newOverrides, updatedAt: now } : c));
    } catch { /* bridge unavailable */ }
  };

  const overrideCount = Object.keys(child.nurtureModeOverrides ?? {}).length;

  return (
    <div className="h-full overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-3xl px-6 pb-6 pt-[86px]">

        <Link to="/settings" className="mb-5 inline-flex items-center gap-1 text-[14px] text-[var(--nimi-text-muted)] hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        {/* ── Header ─────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">{child.displayName} 的养育模式</h1>
          <p className="mt-0.5 text-[14px] text-[var(--nimi-text-muted)]">
            控制提醒频率和内容深度，底线安全规则在任何模式下均不降级
          </p>
        </div>

        {/* ── Global mode selector ───────────────────────── */}
        <Surface tone="card" material="solid" elevation="base" padding="lg" className="mb-5 parentos-radius-xl p-5">
          <h2 className="mb-4 text-[16px] font-bold text-[var(--nimi-text-primary)]">全局模式</h2>
          <div className="grid grid-cols-3 gap-3">
            {NURTURE_MODES.map((m) => {
              const active = child.nurtureMode === m.modeId;
              const meta = MODE_META[m.modeId] ?? FALLBACK_MODE_META;
              return (
                <button key={m.modeId} onClick={() => void handleModeChange(m.modeId)}
                  className={cn(
                    'parentos-radius-lg p-4 text-left transition-all duration-200',
                    active ? meta.cardClassName : 'parentos-mode-card-idle hover:scale-[1.01] hover:shadow-[var(--nimi-elevation-raised)]',
                  )}
                >
                  {/* Mode icon + name */}
                  <div className="mb-2 flex items-center gap-2">
                    <div className={cn(
                      'flex h-[34px] w-[34px] items-center justify-center parentos-radius-10 bg-[var(--nimi-action-secondary-bg)] text-[16px]',
                      active && meta.iconClassName,
                    )}>
                      {meta.emoji}
                    </div>
                    <div>
                      <h3 className={cn('text-[14px] font-semibold text-[var(--nimi-text-primary)]', active && meta.textClassName)}>{m.displayName}</h3>
                      <p className="text-[12px] text-[var(--nimi-text-muted)]">{m.subtitle}</p>
                    </div>
                  </div>
                  {/* Description */}
                  <p className="mb-3 text-[13px] leading-[1.6] text-[var(--nimi-text-secondary)]">{m.description}</p>
                  {/* Parameters */}
                  <div className="space-y-1.5">
                    {[
                      `一般提醒：${P1_LABELS[m.parameters.reminderBehavior.P1] ?? m.parameters.reminderBehavior.P1}`,
                      `每日最多 ${m.parameters.pushFrequency.maxDailyPush} 条`,
                      `汇总：${DIGEST_LABELS[m.parameters.pushFrequency.digestMode] ?? m.parameters.pushFrequency.digestMode}`,
                    ].map((line) => (
                      <p key={line} className="flex items-center gap-1.5 text-[12px] leading-[1.6] text-[var(--nimi-text-muted)]">
                        <span className={cn('h-1 w-1 shrink-0 rounded-full bg-[var(--nimi-border-strong)]', active && meta.dotClassName)} />
                        {line}
                      </p>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Surface>

        {/* ── Domain overrides ───────────────────────────── */}
        <Surface tone="card" material="solid" elevation="base" padding="lg" className="parentos-radius-xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">按领域自定义</h2>
              <p className="mt-0.5 text-[13px] text-[var(--nimi-text-muted)]">可为不同领域设置不同的养育模式</p>
            </div>
            {overrideCount > 0 && (
              <span className="rounded-full bg-[var(--nimi-surface-active)] px-2.5 py-1 text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">
                {overrideCount} 项自定义
              </span>
            )}
          </div>

          <div className="space-y-5">
            {DOMAIN_GROUPS.map((group) => {
              const globalLabel = NURTURE_MODES.find((m) => m.modeId === child.nurtureMode)?.displayName ?? child.nurtureMode;
              const validDomains = group.domains.filter((d) => REMINDER_DOMAINS.includes(d));
              if (validDomains.length === 0) return null;

              return (
                <div key={group.label}>
                  {/* Group header */}
                  <div className="mb-2.5 flex items-center gap-2">
                    <div className={cn('flex h-[28px] w-[28px] items-center justify-center parentos-radius-sm text-[16px]', group.iconClassName)}>
                      {group.emoji}
                    </div>
                    <h3 className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{group.label}</h3>
                  </div>
                  {/* Domain rows */}
                  <div className="space-y-1.5">
                    {validDomains.map((domain) => {
                      const override = child.nurtureModeOverrides?.[domain];
                      const overrideMeta = override ? MODE_META[override] : null;
                      return (
                        <div key={domain}
                          className={cn(
                            'flex items-center justify-between parentos-radius-lg px-4 py-2.5 transition-all',
                            override ? overrideMeta?.domainRowClassName ?? FALLBACK_MODE_META.domainRowClassName : 'parentos-domain-row-idle',
                          )}>
                          <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{DOMAIN_LABELS[domain] ?? domain}</span>
                          <SelectField
                            value={override ?? ''}
                            onValueChange={(v) => void handleDomainOverride(domain, v ? v as NurtureMode : null)}
                            placeholder={`跟随全局（${globalLabel}）`}
                            options={[
                              { value: 'relaxed', label: '🌿 轻松养' },
                              { value: 'balanced', label: '⚖️ 均衡养' },
                              { value: 'advanced', label: '🔬 进阶养' },
                            ]}
                            className="w-[220px] whitespace-nowrap"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

      </div>
    </div>
  );
}
