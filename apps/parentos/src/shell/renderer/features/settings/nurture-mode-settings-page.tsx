import { Link } from 'react-router-dom';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { NURTURE_MODES, REMINDER_DOMAINS } from '../../knowledge-base/index.js';
import { updateChild } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';

export default function NurtureModeSettingsPage() {
  const { activeChildId, children, setChildren } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  if (!child) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Link to="/settings" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回设置</Link>
        <p className="text-gray-500 mt-6">请先选择一个孩子</p>
      </div>
    );
  }

  const handleModeChange = async (newMode: NurtureMode) => {
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
        nurtureModeOverrides: child.nurtureModeOverrides ? JSON.stringify(child.nurtureModeOverrides) : null,
        allergies: child.allergies ? JSON.stringify(child.allergies) : null,
        medicalNotes: child.medicalNotes ? JSON.stringify(child.medicalNotes) : null,
        recorderProfiles: child.recorderProfiles ? JSON.stringify(child.recorderProfiles) : null,
        now,
      });
      setChildren(children.map((c) => c.childId === child.childId ? { ...c, nurtureMode: newMode, updatedAt: now } : c));
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
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Link to="/settings" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回设置</Link>
      </div>
      <h1 className="text-2xl font-bold">{child.displayName} 的养育模式</h1>

      {/* Global mode selector */}
      <section>
        <h2 className="text-lg font-semibold mb-3">全局模式</h2>
        <div className="grid grid-cols-3 gap-3">
          {NURTURE_MODES.map((m) => (
            <button
              key={m.modeId}
              onClick={() => handleModeChange(m.modeId)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                child.nurtureMode === m.modeId ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <h3 className="font-semibold text-sm">{m.displayName}</h3>
              <p className="text-xs text-gray-600 mt-0.5">{m.subtitle}</p>
              <p className="text-xs text-gray-400 mt-2">{m.description}</p>
              <div className="mt-3 text-xs text-gray-500 space-y-0.5">
                <p>P0: push · P1: {m.parameters.reminderBehavior.P1}</p>
                <p>每日最多 {m.parameters.pushFrequency.maxDailyPush} 条推送</p>
                <p>摘要: {m.parameters.pushFrequency.digestMode}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Domain overrides */}
      <section>
        <h2 className="text-lg font-semibold mb-2">按领域自定义</h2>
        <p className="text-xs text-gray-500 mb-4">可为不同领域设置不同的养育模式。P0 底线规则在任何模式下均不降级。</p>
        <div className="space-y-2">
          {REMINDER_DOMAINS.map((domain) => {
            const override = child.nurtureModeOverrides?.[domain];
            return (
              <div key={domain} className="flex items-center justify-between border rounded-lg px-4 py-2.5">
                <span className="text-sm">{domain}</span>
                <select
                  value={override ?? ''}
                  onChange={(e) => handleDomainOverride(domain, e.target.value ? e.target.value as NurtureMode : null)}
                  className="border rounded-md px-2 py-1 text-xs"
                >
                  <option value="">跟随全局 ({child.nurtureMode})</option>
                  <option value="relaxed">轻松养</option>
                  <option value="balanced">均衡养</option>
                  <option value="advanced">进阶养</option>
                </select>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
