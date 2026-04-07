import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { NURTURE_MODES, REMINDER_DOMAINS } from '../../knowledge-base/index.js';
import { updateChild } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';

const P1_LABELS: Record<string, string> = { push: '主动推送', silent: '静默记录', hidden: '隐藏' };
const DIGEST_LABELS: Record<string, string> = { realtime: '实时', daily: '每日汇总', weekly: '每周汇总' };

const DOMAIN_LABELS: Record<string, string> = {
  'bone-age': '骨龄评估', career: '职业启蒙', checkup: '体检', dental: '口腔',
  digital: '数字素养', emotional: '情绪管理', growth: '生长发育', hygiene: '卫生习惯',
  independence: '独立能力', interest: '兴趣培养', language: '语言发展', nutrition: '营养膳食',
  relationship: '人际关系', safety: '安全防护', sensitivity: '敏感期', sexuality: '性教育',
  sleep: '睡眠', vaccine: '疫苗接种', values: '价值观', vision: '视力',
};

/** Domains grouped by category, in display order */
const DOMAIN_GROUPS: Array<{ label: string; emoji: string; domains: string[] }> = [
  { label: '身体健康', emoji: '💪', domains: ['growth', 'nutrition', 'sleep', 'checkup', 'vaccine', 'dental', 'vision', 'bone-age'] },
  { label: '心智发展', emoji: '🧠', domains: ['language', 'emotional', 'sensitivity', 'independence'] },
  { label: '社会能力', emoji: '🤝', domains: ['relationship', 'values', 'sexuality', 'safety', 'hygiene'] },
  { label: '兴趣与规划', emoji: '🌟', domains: ['interest', 'career', 'digital'] },
];

export default function NurtureModeSettingsPage() {
  const { activeChildId, children, setChildren } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  if (!child) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
        <Link to="/settings" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回设置</Link>
        <p className="mt-6" style={{ color: S.sub }}>请先选择一个孩子</p>
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
        childId: child.childId, displayName: child.displayName,
        gender: child.gender,
        birthDate: child.birthDate,
        birthWeightKg: child.birthWeightKg,
        birthHeightCm: child.birthHeightCm,
        birthHeadCircCm: child.birthHeadCircCm,
        avatarPath: child.avatarPath,
        nurtureMode: newMode,
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
        childId: child.childId, displayName: child.displayName,
        gender: child.gender,
        birthDate: child.birthDate,
        birthWeightKg: child.birthWeightKg,
        birthHeightCm: child.birthHeightCm,
        birthHeadCircCm: child.birthHeadCircCm,
        avatarPath: child.avatarPath,
        nurtureMode: child.nurtureMode,
        nurtureModeOverrides: newOverrides ? JSON.stringify(newOverrides) : null,
        allergies: child.allergies ? JSON.stringify(child.allergies) : null,
        medicalNotes: child.medicalNotes ? JSON.stringify(child.medicalNotes) : null,
        recorderProfiles: child.recorderProfiles ? JSON.stringify(child.recorderProfiles) : null,
        now,
      });
      setChildren(children.map((c) => c.childId === child.childId ? { ...c, nurtureModeOverrides: newOverrides, updatedAt: now } : c));
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className={S.container + ' space-y-8'} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2">
        <Link to="/settings" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回设置</Link>
      </div>
      <h1 className="text-xl font-bold mb-6" style={{ color: S.text }}>{child.displayName} 的养育模式</h1>

      {/* Global mode selector */}
      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: S.text }}>全局模式</h2>
        <div className="grid grid-cols-3 gap-3">
          {NURTURE_MODES.map((m) => {
            const active = child.nurtureMode === m.modeId;
            return (
            <button
              key={m.modeId}
              onClick={() => handleModeChange(m.modeId)}
              className={`${S.radiusSm} border p-4 text-left transition-colors`}
              style={active
                ? { borderColor: S.accent, background: '#f4f7ea', boxShadow: `0 0 0 2px ${S.accent}40` }
                : { borderColor: S.border }}
            >
              <h3 className="font-semibold text-sm" style={{ color: S.text }}>{m.displayName}</h3>
              <p className="text-xs mt-0.5" style={{ color: S.sub }}>{m.subtitle}</p>
              <p className="text-xs mt-2" style={{ color: S.sub }}>{m.description}</p>
              <div className="mt-3 text-xs space-y-0.5" style={{ color: S.sub }}>
                <p>重要提醒：主动推送 · 一般提醒：{P1_LABELS[m.parameters.reminderBehavior.P1] ?? m.parameters.reminderBehavior.P1}</p>
                <p>每日最多 {m.parameters.pushFrequency.maxDailyPush} 条推送</p>
                <p>消息汇总：{DIGEST_LABELS[m.parameters.pushFrequency.digestMode] ?? m.parameters.pushFrequency.digestMode}</p>
              </div>
            </button>
            );
          })}
        </div>
      </section>

      {/* Domain overrides — grouped */}
      <section>
        <h2 className="text-lg font-semibold mb-2" style={{ color: S.text }}>按领域自定义</h2>
        <p className="text-xs mb-5" style={{ color: S.sub }}>可为不同领域设置不同的养育模式。底线安全规则在任何模式下均不降级。</p>

        <div className="space-y-5">
          {DOMAIN_GROUPS.map((group) => {
            const globalLabel = NURTURE_MODES.find((m) => m.modeId === child.nurtureMode)?.displayName ?? child.nurtureMode;
            // Only render domains that exist in REMINDER_DOMAINS
            const validDomains = group.domains.filter((d) => REMINDER_DOMAINS.includes(d));
            if (validDomains.length === 0) return null;

            return (
              <div key={group.label}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[14px]">{group.emoji}</span>
                  <h3 className="text-[13px] font-semibold" style={{ color: S.text }}>{group.label}</h3>
                </div>
                <div className="space-y-1.5">
                  {validDomains.map((domain) => {
                    const override = child.nurtureModeOverrides?.[domain];
                    return (
                      <div key={domain} className={`flex items-center justify-between border ${S.radiusSm} px-4 py-2`}
                        style={{ borderColor: override ? S.accent + '40' : S.border, background: override ? '#f4f7ea' : undefined }}>
                        <span className="text-[13px]" style={{ color: S.text }}>{DOMAIN_LABELS[domain] ?? domain}</span>
                        <select
                          value={override ?? ''}
                          onChange={(e) => handleDomainOverride(domain, e.target.value ? e.target.value as NurtureMode : null)}
                          className={`border ${S.radiusSm} px-2 py-1 text-xs`}
                          style={{ borderColor: S.border, color: S.text, accentColor: S.accent }}>
                          <option value="">跟随全局（{globalLabel}）</option>
                          <option value="relaxed">轻松养</option>
                          <option value="balanced">均衡养</option>
                          <option value="advanced">进阶养</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
