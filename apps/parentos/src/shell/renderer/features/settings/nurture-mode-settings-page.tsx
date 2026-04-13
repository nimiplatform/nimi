import { Link } from 'react-router-dom';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { NURTURE_MODES, REMINDER_DOMAINS } from '../../knowledge-base/index.js';
import { updateChild } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { AppSelect } from '../../app-shell/app-select.js';

/* ── design tokens (aligned with dashboard) ────────────────── */

const C = {
  bg: '#E5ECEA', card: '#ffffff', text: '#1a2b4a', sub: '#8a8f9a',
  accent: '#94A533', border: '#e8e5e0',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
  radius: 'rounded-[18px]', radiusSm: 'rounded-[14px]',
} as const;

/* ── labels ─────────────────────────────────────────────────── */

const P1_LABELS: Record<string, string> = { push: '主动推送', silent: '静默记录', hidden: '隐藏' };
const DIGEST_LABELS: Record<string, string> = { realtime: '实时', daily: '每日汇总', weekly: '每周汇总' };

const MODE_META: Record<string, { emoji: string; color: string; border: string; activeBg: string }> = {
  relaxed:  { emoji: '🌿', color: '#10B981', border: '#34D399', activeBg: 'rgba(16, 185, 129, 0.05)' },
  balanced: { emoji: '⚖️', color: '#3B82F6', border: '#60A5FA', activeBg: 'rgba(59, 130, 246, 0.05)' },
  advanced: { emoji: '🔬', color: '#8B5CF6', border: '#A78BFA', activeBg: 'rgba(139, 92, 246, 0.05)' },
};

const DOMAIN_LABELS: Record<string, string> = {
  'bone-age': '骨龄评估', career: '职业启蒙', checkup: '体检', dental: '口腔',
  digital: '数字素养', emotional: '情绪管理', growth: '生长发育', hygiene: '卫生习惯',
  independence: '独立能力', interest: '兴趣培养', language: '语言发展', nutrition: '营养膳食',
  relationship: '人际关系', safety: '安全防护', sensitivity: '敏感期', sexuality: '性教育',
  sleep: '睡眠', vaccine: '疫苗接种', values: '价值观', vision: '视力',
};

const DOMAIN_GROUPS: Array<{ label: string; emoji: string; color: string; domains: string[] }> = [
  { label: '身体健康', emoji: '💪', color: '#ddedfb', domains: ['growth', 'nutrition', 'sleep', 'checkup', 'vaccine', 'dental', 'vision', 'bone-age'] },
  { label: '心智发展', emoji: '🧠', color: '#f3e5f5', domains: ['language', 'emotional', 'sensitivity', 'independence'] },
  { label: '社会能力', emoji: '🤝', color: '#fce4ec', domains: ['relationship', 'values', 'sexuality', 'safety', 'hygiene'] },
  { label: '兴趣与规划', emoji: '🌟', color: '#fff3e0', domains: ['interest', 'career', 'digital'] },
];

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function NurtureModeSettingsPage() {
  const { activeChildId, children, setChildren } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  if (!child) {
    return (
      <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
        <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 86 }}>
          <Link to="/settings" className="text-[12px] hover:underline" style={{ color: C.sub }}>← 返回设置</Link>
          <p className="mt-6 text-[13px]" style={{ color: C.sub }}>请先选择一个孩子</p>
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
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 86 }}>

        <Link to="/settings" className="inline-flex items-center gap-1 text-[12px] mb-5 hover:underline" style={{ color: C.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        {/* ── Header ─────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: C.text }}>{child.displayName} 的养育模式</h1>
          <p className="text-[12px] mt-0.5" style={{ color: C.sub }}>
            控制提醒频率和内容深度，底线安全规则在任何模式下均不降级
          </p>
        </div>

        {/* ── Global mode selector ───────────────────────── */}
        <div className={`${C.radius} p-5 mb-5`} style={{ background: C.card, boxShadow: C.shadow }}>
          <h2 className="text-[14px] font-bold mb-4" style={{ color: C.text }}>全局模式</h2>
          <div className="grid grid-cols-3 gap-3">
            {NURTURE_MODES.map((m) => {
              const active = child.nurtureMode === m.modeId;
              const meta = MODE_META[m.modeId] ?? { emoji: '📋', color: C.accent, border: C.accent, activeBg: '#f4f7ea' };
              return (
                <button key={m.modeId} onClick={() => void handleModeChange(m.modeId)}
                  className={`${C.radiusSm} p-4 text-left transition-all duration-200 ${active ? '' : 'hover:shadow-md hover:scale-[1.01]'}`}
                  style={{
                    background: active ? meta.activeBg : C.card,
                    border: `2px solid ${active ? meta.border : C.border}`,
                  }}>
                  {/* Mode icon + name */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-[16px]"
                      style={{ background: active ? `${meta.color}20` : '#f5f3ef' }}>
                      {meta.emoji}
                    </div>
                    <div>
                      <h3 className="text-[13px] font-semibold" style={{ color: active ? meta.color : '#1F2937' }}>{m.displayName}</h3>
                      <p className="text-[10px]" style={{ color: '#6B7280' }}>{m.subtitle}</p>
                    </div>
                  </div>
                  {/* Description */}
                  <p className="text-[11px] leading-[1.6] mb-3" style={{ color: '#4B5563' }}>{m.description}</p>
                  {/* Parameters */}
                  <div className="space-y-1.5">
                    {[
                      `一般提醒：${P1_LABELS[m.parameters.reminderBehavior.P1] ?? m.parameters.reminderBehavior.P1}`,
                      `每日最多 ${m.parameters.pushFrequency.maxDailyPush} 条`,
                      `汇总：${DIGEST_LABELS[m.parameters.pushFrequency.digestMode] ?? m.parameters.pushFrequency.digestMode}`,
                    ].map((line) => (
                      <p key={line} className="text-[10px] leading-[1.6] flex items-center gap-1.5" style={{ color: '#6B7280' }}>
                        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: active ? meta.color : '#d0d5db' }} />
                        {line}
                      </p>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Domain overrides ───────────────────────────── */}
        <div className={`${C.radius} p-5`} style={{ background: C.card, boxShadow: C.shadow }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-bold" style={{ color: C.text }}>按领域自定义</h2>
              <p className="text-[11px] mt-0.5" style={{ color: C.sub }}>可为不同领域设置不同的养育模式</p>
            </div>
            {overrideCount > 0 && (
              <span className="text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: '#f4f7ea', color: C.accent }}>
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
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[14px]" style={{ background: group.color }}>
                      {group.emoji}
                    </div>
                    <h3 className="text-[12px] font-bold" style={{ color: C.text }}>{group.label}</h3>
                  </div>
                  {/* Domain rows */}
                  <div className="space-y-1.5">
                    {validDomains.map((domain) => {
                      const override = child.nurtureModeOverrides?.[domain];
                      const overrideMeta = override ? MODE_META[override] : null;
                      return (
                        <div key={domain}
                          className={`flex items-center justify-between ${C.radiusSm} px-4 py-2.5 transition-all`}
                          style={{
                            background: override ? overrideMeta?.activeBg ?? '#f4f7ea' : '#fafaf8',
                            border: `1px solid ${override ? (overrideMeta?.border ?? C.accent) + '60' : C.border}`,
                          }}>
                          <span className="text-[12px] font-medium" style={{ color: C.text }}>{DOMAIN_LABELS[domain] ?? domain}</span>
                          <AppSelect
                            value={override ?? ''}
                            onChange={(v) => void handleDomainOverride(domain, v ? v as NurtureMode : null)}
                            placeholder={`跟随全局（${globalLabel}）`}
                            options={[
                              { value: 'relaxed', label: '🌿 轻松养' },
                              { value: 'balanced', label: '⚖️ 均衡养' },
                              { value: 'advanced', label: '🔬 进阶养' },
                            ]}
                            style={{ color: override ? (overrideMeta?.color ?? C.accent) : '#4B5563' }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
