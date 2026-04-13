import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { createChild, createFamily, deleteChild, getChildren, updateChild } from '../../bridge/sqlite-bridge.js';
import { saveChildAvatar } from '../../bridge/child-avatar-bridge.js';
import { mapChildRow } from '../../bridge/mappers.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { fileToBase64 } from '../journal/journal-page-helpers.js';
import { AvatarCropModal } from './avatar-crop-modal.js';
import { ProfileDatePicker } from '../profile/profile-date-picker.js';
import { AppSelect } from '../../app-shell/app-select.js';

/** Convert a local filesystem path to a Tauri 2 asset URL */
function assetUrl(path: string): string {
  try { return convertFileSrc(path); } catch { return path; }
}

/* ── design tokens ───────────────────────────────────────── */

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
  radiusSm: 'rounded-[14px]',
} as const;

/* ── recorder presets ────────────────────────────────────── */

interface RecorderProfile {
  id: string;
  name: string;
  emoji: string;
}

const RECORDER_PRESETS: Array<{ name: string; emoji: string }> = [
  { name: '妈妈', emoji: '👩' },
  { name: '爸爸', emoji: '👨' },
  { name: '奶奶', emoji: '👵' },
  { name: '爷爷', emoji: '👴' },
  { name: '外婆', emoji: '👵' },
  { name: '外公', emoji: '👴' },
];

function recorderEmoji(name: string): string {
  return RECORDER_PRESETS.find((p) => p.name === name)?.emoji ?? '👤';
}

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
  recorders: RecorderProfile[];
  avatarFile: File | null;
  avatarPreview: string | null;
}

const EMPTY_FORM: FormState = {
  displayName: '', gender: 'male', birthDate: '', birthWeightKg: '', birthHeightCm: '',
  birthHeadCircCm: '', nurtureMode: 'balanced', allergies: '', medicalNotes: '',
  recorders: [{ id: ulid(), name: '妈妈', emoji: '👩' }],
  avatarFile: null, avatarPreview: null,
};

function parseCsvList(value: string) {
  const items = value.split(',').map((i) => i.trim()).filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

function serializeRecorders(recorders: RecorderProfile[]) {
  const items = recorders.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name.trim() }));
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
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);

  const resetForm = () => { setForm(EMPTY_FORM); setShowForm(false); setEditingId(null); };

  const refreshChildren = async (fid: string | null) => {
    if (!fid) return;
    try { const rows = await getChildren(fid); setChildren(rows.map(mapChildRow)); } catch { /* bridge */ }
  };

  const uploadAvatar = async (childId: string): Promise<string | null> => {
    if (!form.avatarFile) return null;
    try {
      const base64 = await fileToBase64(form.avatarFile);
      const result = await saveChildAvatar({ childId, mimeType: form.avatarFile.type, imageBase64: base64 });
      return result.path;
    } catch { return null; }
  };

  const handleAdd = async () => {
    if (!form.displayName || !form.birthDate) return;
    const now = isoNow();
    const childId = ulid();
    try {
      let fid = familyId;
      if (!fid) { fid = ulid(); await createFamily(fid, '我的家庭', now); setFamilyId(fid); }
      const avatarPath = await uploadAvatar(childId);
      await createChild({
        childId, familyId: fid, displayName: form.displayName, gender: form.gender,
        birthDate: form.birthDate, birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath, nurtureMode: form.nurtureMode, nurtureModeOverrides: null,
        allergies: parseCsvList(form.allergies), medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: serializeRecorders(form.recorders), now,
      });
      await refreshChildren(fid); resetForm();
    } catch { /* bridge */ }
  };

  const handleUpdate = async () => {
    if (!editingId || !form.displayName || !form.birthDate) return;
    const existing = children.find((c) => c.childId === editingId);
    if (!existing) return;
    try {
      const avatarPath = form.avatarFile ? await uploadAvatar(editingId) : existing.avatarPath;
      await updateChild({
        childId: editingId, displayName: form.displayName, gender: form.gender,
        birthDate: form.birthDate, birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath: avatarPath ?? null, nurtureMode: form.nurtureMode,
        nurtureModeOverrides: existing.nurtureModeOverrides ? JSON.stringify(existing.nurtureModeOverrides) : null,
        allergies: parseCsvList(form.allergies), medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: serializeRecorders(form.recorders), now: isoNow(),
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
      recorders: c.recorderProfiles?.map((r) => ({ ...r, emoji: recorderEmoji(r.name) })) ?? [],
      avatarFile: null, avatarPreview: c.avatarPath ? assetUrl(c.avatarPath) : null,
    });
    setEditingId(childId); setShowForm(true);
  };

  const handleAvatarSelect = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setCropImageUrl(previewUrl);
  };

  const handleCropConfirm = (croppedFile: File) => {
    const previewUrl = URL.createObjectURL(croppedFile);
    setForm((prev) => ({ ...prev, avatarFile: croppedFile, avatarPreview: previewUrl }));
    setCropImageUrl(null);
  };

  const handleCropCancel = () => {
    setCropImageUrl(null);
  };

  const addRecorder = (preset?: { name: string; emoji: string }) => {
    const newR: RecorderProfile = preset
      ? { id: ulid(), name: preset.name, emoji: preset.emoji }
      : { id: ulid(), name: '', emoji: '👤' };
    setForm((prev) => ({ ...prev, recorders: [...prev.recorders, newR] }));
  };

  const updateRecorder = (id: string, name: string) => {
    setForm((prev) => ({
      ...prev,
      recorders: prev.recorders.map((r) =>
        r.id === id ? { ...r, name, emoji: recorderEmoji(name) } : r,
      ),
    }));
  };

  const removeRecorder = (id: string) => {
    setForm((prev) => ({ ...prev, recorders: prev.recorders.filter((r) => r.id !== id) }));
  };

  const inp = 'w-full rounded-xl border-0 px-3.5 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#86AFDA]/40';
  const inputBg = { background: '#f5f3ef', color: S.text };

  // Which presets are not yet added
  const usedNames = new Set(form.recorders.map((r) => r.name));
  const availablePresets = RECORDER_PRESETS.filter((p) => !usedNames.has(p.name));

  return (
    <div className="min-h-full p-6" style={{ background: 'transparent' }}>
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link to="/settings" className="inline-flex items-center gap-1 text-[12px] mb-5 hover:underline" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: S.text }}>孩子管理</h1>
            <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>管理孩子档案和基本信息</p>
          </div>
          {!showForm && (
            <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[13px] font-medium text-white transition-all hover:scale-[1.02] hover:shadow-md"
              style={{ background: S.blue, boxShadow: '0 2px 8px rgba(134,175,218,0.3)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加孩子
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
          return (
            <div key={child.childId} className={`${S.radius} p-5 mb-4 transition-all duration-200 hover:shadow-md`}
              style={{ background: S.card, boxShadow: S.shadow, borderLeft: isActive ? `3px solid ${S.blue}` : '3px solid transparent' }}>
              <div className="flex items-center gap-4">
                {child.avatarPath ? (
                  <img src={assetUrl(child.avatarPath)} alt=""
                    className="w-12 h-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-lg"
                    style={{ background: isActive ? S.blue : '#c0bdb8' }}>
                    {child.displayName.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold" style={{ color: S.text }}>{child.displayName}</h3>
                    {isActive && <span className="text-[9px] px-2 py-0.5 rounded-full text-white" style={{ background: S.accent }}>当前</span>}
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>
                    {child.gender === 'male' ? '男' : '女'} · {child.birthDate} · {MODE_LABELS[child.nurtureMode] ?? child.nurtureMode}
                  </p>
                  {child.recorderProfiles && child.recorderProfiles.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      {child.recorderProfiles.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: '#f5f3ef', color: S.sub }}>
                          <span>{recorderEmoji(r.name)}</span> {r.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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

        {/* ── Add / Edit form ── */}
        {showForm && (
          <div className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
            <h3 className="text-[16px] font-semibold mb-5" style={{ color: S.text }}>
              {editingId ? '编辑孩子' : '添加孩子'}
            </h3>

            {/* Avatar upload */}
            <div className="flex items-center gap-5 mb-6">
              <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => handleAvatarSelect(e.target.files)} />
              <button onClick={() => avatarInputRef.current?.click()} className="relative group shrink-0">
                {form.avatarPreview ? (
                  <img src={form.avatarPreview} alt="" className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: '#f5f3ef' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c0bdb8" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              </button>
              <div>
                <p className="text-[13px] font-medium" style={{ color: S.text }}>
                  {form.avatarPreview ? '点击更换头像' : '上传头像'}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: S.sub }}>支持 JPG、PNG、WebP 格式</p>
              </div>
            </div>

            {/* Basic info */}
            <p className="text-[12px] font-semibold mb-3" style={{ color: S.sub }}>基本信息</p>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>姓名 *</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>性别 *</label>
                <AppSelect value={form.gender} onChange={(v) => setForm({ ...form, gender: v as 'male' | 'female' })}
                  options={[{ value: 'male', label: '男' }, { value: 'female', label: '女' }]} />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>出生日期 *</label>
                <ProfileDatePicker value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })}
                  maxDate={new Date().toISOString().slice(0, 10)} size="small" />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>养育模式</label>
                <AppSelect value={form.nurtureMode} onChange={(v) => setForm({ ...form, nurtureMode: v as NurtureMode })}
                  options={[{ value: 'relaxed', label: '轻松养' }, { value: 'balanced', label: '均衡养' }, { value: 'advanced', label: '进阶养' }]} />
              </div>
            </div>

            {/* Birth measurements */}
            <p className="text-[12px] font-semibold mb-3" style={{ color: S.sub }}>出生数据</p>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>体重 (kg)</label>
                <input type="number" step="0.01" value={form.birthWeightKg}
                  onChange={(e) => setForm({ ...form, birthWeightKg: e.target.value })}
                  className={inp} style={inputBg} placeholder="3.50" />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>身长 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeightCm}
                  onChange={(e) => setForm({ ...form, birthHeightCm: e.target.value })}
                  className={inp} style={inputBg} placeholder="50.0" />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>头围 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeadCircCm}
                  onChange={(e) => setForm({ ...form, birthHeadCircCm: e.target.value })}
                  className={inp} style={inputBg} placeholder="34.0" />
              </div>
            </div>

            {/* Medical info */}
            <p className="text-[12px] font-semibold mb-3" style={{ color: S.sub }}>健康信息</p>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>过敏史（逗号分隔）</label>
                <input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                  className={inp} style={inputBg} placeholder="牛奶, 花生" />
              </div>
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: S.sub }}>医疗备注（逗号分隔）</label>
                <input value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })}
                  className={inp} style={inputBg} placeholder="早产, G6PD缺乏" />
              </div>
            </div>

            {/* Recorder profiles */}
            <p className="text-[12px] font-semibold mb-3" style={{ color: S.sub }}>记录者</p>
            <div className="space-y-2 mb-3">
              {form.recorders.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="text-[20px] w-8 text-center shrink-0">{r.emoji}</span>
                  <input value={r.name} onChange={(e) => updateRecorder(r.id, e.target.value)}
                    className={`flex-1 ${inp}`} style={inputBg} placeholder="输入名称" />
                  <button onClick={() => removeRecorder(r.id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors hover:bg-red-50"
                    style={{ color: '#dc2626' }} title="移除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Quick add preset recorders */}
            <div className="flex flex-wrap gap-2 mb-5">
              {availablePresets.map((p) => (
                <button key={p.name} onClick={() => addRecorder(p)}
                  className={`${S.radiusSm} px-3 py-1.5 text-[12px] flex items-center gap-1.5 transition-colors hover:opacity-80`}
                  style={{ background: '#f5f3ef', color: S.text }}>
                  <span>{p.emoji}</span> {p.name}
                </button>
              ))}
              <button onClick={() => addRecorder()}
                className={`${S.radiusSm} px-3 py-1.5 text-[12px] flex items-center gap-1 transition-colors hover:opacity-80`}
                style={{ background: '#f5f3ef', color: S.sub }}>
                + 自定义
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2" style={{ borderTop: `1px solid ${S.border}` }}>
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

      {/* Avatar crop modal */}
      {cropImageUrl && (
        <AvatarCropModal imageUrl={cropImageUrl} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}
    </div>
  );
}
