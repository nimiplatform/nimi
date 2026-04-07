import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { createChild, createFamily, deleteChild, getChildren, updateChild } from '../../bridge/sqlite-bridge.js';
import { mapChildRow } from '../../bridge/mappers.js';
import { isoNow, ulid } from '../../bridge/ulid.js';

/* ── design tokens (same as dashboard) ───────────────────── */

const S = {
  bg: '#E5ECEA',
  card: '#ffffff',
  text: '#1a2b4a',
  sub: '#8a8f9a',
  blue: '#86AFDA',
  accent: '#94A533',
  border: '#e8e5e0',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
  radius: 'rounded-[18px]',
} as const;

/* ── form state ──────────────────────────────────────────── */

interface FormState {
  displayName: string;
  gender: 'male' | 'female';
  birthDate: string;
  birthWeightKg: string;
  birthHeightCm: string;
  birthHeadCircCm: string;
  nurtureMode: NurtureMode;
  allergies: string;
  medicalNotes: string;
  recorderProfiles: string;
}

const EMPTY_FORM: FormState = {
  displayName: '', gender: 'male', birthDate: '', birthWeightKg: '', birthHeightCm: '',
  birthHeadCircCm: '', nurtureMode: 'balanced', allergies: '', medicalNotes: '', recorderProfiles: '',
};

function parseCsvList(value: string) {
  const items = value.split(',').map((i) => i.trim()).filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

function parseRecorderProfiles(value: string) {
  const items = value.split(',').map((i) => i.trim()).filter(Boolean).map((name, idx) => ({ id: `recorder-${idx + 1}`, name }));
  return items.length > 0 ? JSON.stringify(items) : null;
}

const MODE_LABELS: Record<string, string> = { relaxed: '轻松养', balanced: '均衡养', advanced: '进阶养' };

/* ── page ─────────────────────────────────────────────────── */

export default function ChildrenSettingsPage() {
  const { activeChildId, children, familyId, setActiveChildId, setChildren, setFamilyId } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const resetForm = () => { setForm(EMPTY_FORM); setShowForm(false); setEditingId(null); };

  const refreshChildren = async (fid: string | null) => {
    if (!fid) return;
    try { const rows = await getChildren(fid); setChildren(rows.map(mapChildRow)); } catch { /* bridge */ }
  };

  const handleAdd = async () => {
    if (!form.displayName || !form.birthDate) return;
    const now = isoNow();
    try {
      let fid = familyId;
      if (!fid) { fid = ulid(); await createFamily(fid, '我的家庭', now); setFamilyId(fid); }
      await createChild({
        childId: ulid(), familyId: fid, displayName: form.displayName, gender: form.gender,
        birthDate: form.birthDate, birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath: null, nurtureMode: form.nurtureMode, nurtureModeOverrides: null,
        allergies: parseCsvList(form.allergies), medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: parseRecorderProfiles(form.recorderProfiles), now,
      });
      await refreshChildren(fid); resetForm();
    } catch { /* bridge */ }
  };

  const handleUpdate = async () => {
    if (!editingId || !form.displayName || !form.birthDate) return;
    const existing = children.find((c) => c.childId === editingId);
    if (!existing) return;
    try {
      await updateChild({
        childId: editingId, displayName: form.displayName, gender: form.gender,
        birthDate: form.birthDate, birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath: existing.avatarPath, nurtureMode: form.nurtureMode,
        nurtureModeOverrides: existing.nurtureModeOverrides ? JSON.stringify(existing.nurtureModeOverrides) : null,
        allergies: parseCsvList(form.allergies), medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: parseRecorderProfiles(form.recorderProfiles), now: isoNow(),
      });
      await refreshChildren(existing.familyId); resetForm();
    } catch { /* bridge */ }
  };

  const handleDelete = async (childId: string) => {
    try {
      await deleteChild(childId);
      if (activeChildId === childId) setActiveChildId(null);
      setDeletingChildId(null);
      await refreshChildren(familyId);
    } catch { /* bridge */ }
  };

  const startEdit = (childId: string) => {
    const c = children.find((i) => i.childId === childId);
    if (!c) return;
    setForm({
      displayName: c.displayName, gender: c.gender, birthDate: c.birthDate,
      birthWeightKg: c.birthWeightKg?.toString() ?? '', birthHeightCm: c.birthHeightCm?.toString() ?? '',
      birthHeadCircCm: c.birthHeadCircCm?.toString() ?? '', nurtureMode: c.nurtureMode,
      allergies: c.allergies?.join(', ') ?? '', medicalNotes: c.medicalNotes?.join(', ') ?? '',
      recorderProfiles: c.recorderProfiles?.map((i) => i.name).join(', ') ?? '',
    });
    setEditingId(childId); setShowForm(true);
  };

  const inp = 'w-full rounded-xl border-0 px-3.5 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#86AFDA]/40';
  const inputBg = { background: '#f5f3ef', color: S.text };

  return (
    <div className="min-h-full p-6" style={{ background: S.bg }}>
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link to="/settings" className="inline-flex items-center gap-1 text-[12px] mb-5 hover:underline" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-bold" style={{ color: S.text }}>孩子管理</h1>
          {!showForm && (
            <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[13px] font-medium text-white transition-all hover:opacity-90"
              style={{ background: S.blue, boxShadow: '0 2px 8px rgba(134,175,218,0.3)' }}>
              + 添加孩子
            </button>
          )}
        </div>

        {/* Empty state */}
        {children.length === 0 && !showForm && (
          <div className={`${S.radius} p-10 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: '#f5f3ef' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c0bdb8" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <p className="text-[14px] font-medium" style={{ color: S.text }}>还没有添加孩子</p>
            <p className="text-[12px] mt-1" style={{ color: S.sub }}>点击上方按钮添加第一个孩子</p>
          </div>
        )}

        {/* Child list */}
        {!showForm && children.map((child) => {
          const isActive = activeChildId === child.childId;
          const initial = child.displayName.charAt(0);
          return (
            <div key={child.childId} className={`${S.radius} p-5 mb-4 transition-all`}
              style={{ background: S.card, boxShadow: S.shadow, borderLeft: isActive ? `3px solid ${S.blue}` : '3px solid transparent' }}>
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-lg"
                  style={{ background: isActive ? S.blue : '#c0bdb8' }}>
                  {initial}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold" style={{ color: S.text }}>{child.displayName}</h3>
                    {isActive && <span className="text-[9px] px-2 py-0.5 rounded-full text-white" style={{ background: S.accent }}>当前</span>}
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>
                    {child.gender === 'male' ? '男' : '女'} · {child.birthDate} · {MODE_LABELS[child.nurtureMode] ?? child.nurtureMode}
                  </p>
                  {child.recorderProfiles?.length ? (
                    <p className="text-[11px] mt-0.5" style={{ color: '#c0bdb8' }}>
                      记录者：{child.recorderProfiles.map((i) => i.name).join('、')}
                    </p>
                  ) : null}
                </div>
                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  {!isActive && (
                    <button onClick={() => setActiveChildId(child.childId)}
                      className="text-[11px] px-3.5 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                      style={{ background: '#f5f3ef', color: S.text }}>
                      设为活跃
                    </button>
                  )}
                  <button onClick={() => startEdit(child.childId)}
                    className="text-[11px] px-3.5 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                    style={{ background: '#f5f3ef', color: S.text }}>
                    编辑
                  </button>
                  <button onClick={() => setDeletingChildId(child.childId)}
                    className="text-[11px] px-3.5 py-1.5 rounded-full font-medium text-red-600 transition-colors hover:bg-red-50"
                    style={{ background: '#fef2f2' }}>
                    删除
                  </button>
                </div>
              </div>
              {/* Delete confirmation */}
              {deletingChildId === child.childId && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <p className="text-[12px] mb-3" style={{ color: '#b91c1c' }}>
                    删除 <strong>{child.displayName}</strong> 会级联删除所有关联数据（生长记录、疫苗、日记、AI 对话等），此操作不可撤销。
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => void handleDelete(child.childId)}
                      className="text-[11px] px-4 py-1.5 rounded-full text-white font-medium" style={{ background: '#dc2626' }}>
                      确认删除
                    </button>
                    <button onClick={() => setDeletingChildId(null)}
                      className="text-[11px] px-4 py-1.5 rounded-full font-medium" style={{ background: '#f5f3ef', color: S.text }}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add / Edit form */}
        {showForm && (
          <div className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
            <h3 className="text-[16px] font-semibold mb-5" style={{ color: S.text }}>
              {editingId ? '编辑孩子' : '添加孩子'}
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>姓名 *</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>性别 *</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })}
                  className={inp} style={inputBg}>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>出生日期 *</label>
                <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>养育模式</label>
                <select value={form.nurtureMode} onChange={(e) => setForm({ ...form, nurtureMode: e.target.value as NurtureMode })}
                  className={inp} style={inputBg}>
                  <option value="relaxed">轻松养</option>
                  <option value="balanced">均衡养</option>
                  <option value="advanced">进阶养</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>出生体重 (kg)</label>
                <input type="number" step="0.01" value={form.birthWeightKg}
                  onChange={(e) => setForm({ ...form, birthWeightKg: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>出生身长 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeightCm}
                  onChange={(e) => setForm({ ...form, birthHeightCm: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>出生头围 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeadCircCm}
                  onChange={(e) => setForm({ ...form, birthHeadCircCm: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>过敏史（逗号分隔）</label>
                <input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>医疗备注（逗号分隔）</label>
                <input value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
            </div>

            <div className="mb-5">
              <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>记录者（逗号分隔）</label>
              <input value={form.recorderProfiles} onChange={(e) => setForm({ ...form, recorderProfiles: e.target.value })}
                placeholder="妈妈, 爸爸" className={inp} style={inputBg} />
            </div>

            <div className="flex gap-3">
              <button onClick={() => void (editingId ? handleUpdate() : handleAdd())}
                className="px-6 py-2.5 rounded-full text-[13px] font-medium text-white transition-all hover:opacity-90"
                style={{ background: S.blue, boxShadow: '0 2px 8px rgba(134,175,218,0.3)' }}>
                {editingId ? '保存' : '添加'}
              </button>
              <button onClick={resetForm}
                className="px-6 py-2.5 rounded-full text-[13px] font-medium transition-colors"
                style={{ background: '#f5f3ef', color: S.text }}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
