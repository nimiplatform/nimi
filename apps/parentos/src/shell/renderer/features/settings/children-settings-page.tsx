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
import { ChildAvatar } from '../../shared/child-avatar.js';
import { S } from '../../app-shell/page-style.js';

/** Convert a local filesystem path to a Tauri 2 asset URL */
function assetUrl(path: string): string {
  try { return convertFileSrc(path); } catch { return path; }
}

/* ── design tokens — shared theme palette from `app-shell/page-style.ts`.
 * Inner card-on-card separators use a tangible literal (#f1f5f9) because
 * `S.border` (rgba(255,255,255,0.7)) is calibrated for glass surfaces and
 * would vanish against a white card background. */
const INNER_BORDER = '#f1f5f9';

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
  recorder: RecorderProfile;
  customRecorderName: string;
  avatarFile: File | null;
  avatarPreview: string | null;
}

const EMPTY_FORM: FormState = {
  displayName: '', gender: 'male', birthDate: '', birthWeightKg: '', birthHeightCm: '',
  birthHeadCircCm: '', nurtureMode: 'balanced', allergies: '', medicalNotes: '',
  recorder: { id: ulid(), name: '妈妈', emoji: '👩' },
  customRecorderName: '',
  avatarFile: null, avatarPreview: null,
};

function parseCsvList(value: string) {
  const items = value.split(',').map((i) => i.trim()).filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

function serializeRecorder(recorder: RecorderProfile) {
  const name = recorder.name.trim();
  return name ? JSON.stringify([{ id: recorder.id, name }]) : null;
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
        recorderProfiles: serializeRecorder(form.recorder), now,
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
        recorderProfiles: serializeRecorder(form.recorder), now: isoNow(),
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
      recorder: c.recorderProfiles?.[0]
        ? { ...c.recorderProfiles[0], emoji: recorderEmoji(c.recorderProfiles[0].name) }
        : { id: ulid(), name: '妈妈', emoji: '👩' },
      customRecorderName: (() => {
        const first = c.recorderProfiles?.[0];
        return first && !RECORDER_PRESETS.some((p) => p.name === first.name) ? first.name : '';
      })(),
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

  const selectRecorder = (preset: { name: string; emoji: string }) => {
    setForm((prev) => ({ ...prev, recorder: { ...prev.recorder, name: preset.name, emoji: preset.emoji }, customRecorderName: '' }));
  };

  const selectCustomRecorder = () => {
    setForm((prev) => ({ ...prev, recorder: { ...prev.recorder, name: prev.customRecorderName || '', emoji: '👤' } }));
  };

  const inp = 'w-full rounded-xl border-0 px-3.5 py-2.5 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#818CF8]/40';
  const inputBg = { background: '#f5f3ef', color: S.text };

  /** For number inputs: seed from placeholder on first arrow click, then let native step take over */
  const numChange = (field: 'birthWeightKg' | 'birthHeightCm' | 'birthHeadCircCm', placeholder: string, step: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let v = e.target.value;
      if (!form[field] && v !== '') {
        // First interaction via spinner arrows on an empty field: native browser steps from 0.
        // Detect that and seed from placeholder instead.
        const parsed = parseFloat(v);
        if (parsed === step || parsed === -step) {
          v = String(Math.round((parseFloat(placeholder) + (parsed > 0 ? step : -step)) * 100) / 100);
        }
      }
      setForm({ ...form, [field]: v });
    };

  const isCustom = !RECORDER_PRESETS.some((p) => p.name === form.recorder.name);

  return (
    <div className="min-h-full p-6" style={{ background: 'transparent' }}>
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link to="/settings" className="inline-flex items-center gap-1 text-[14px] mb-5 hover:underline" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: S.text }}>孩子管理</h1>
            <p className="text-[14px] mt-0.5" style={{ color: S.sub }}>管理孩子档案和基本信息</p>
          </div>
          {!showForm && (
            <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[14px] font-medium text-white transition-all hover:scale-[1.02] hover:shadow-md"
              style={{ background: S.blue, boxShadow: '0 2px 8px rgba(129,140,248,0.3)' }}>
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
            <p className="text-[16px] font-medium" style={{ color: S.text }}>还没有添加孩子</p>
            <p className="text-[14px] mt-1" style={{ color: S.sub }}>点击上方按钮添加第一个孩子</p>
          </div>
        )}

        {/* Child list */}
        {!showForm && children.map((child) => {
          const isActive = activeChildId === child.childId;
          return (
            <div key={child.childId} className={`${S.radius} p-5 mb-4 transition-all duration-200 hover:shadow-md`}
              style={{ background: S.card, boxShadow: S.shadow, borderLeft: isActive ? `3px solid ${S.blue}` : '3px solid transparent' }}>
              <div className="flex items-center gap-4">
                <ChildAvatar
                  child={child}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                  style={{ outline: isActive ? `2px solid ${S.blue}` : '1px solid rgba(226, 232, 240, 0.95)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-semibold" style={{ color: S.text }}>{child.displayName}</h3>
                    {isActive && <span className="text-[12px] px-2 py-0.5 rounded-full text-white" style={{ background: S.accent }}>当前</span>}
                  </div>
                  <p className="text-[14px] mt-0.5" style={{ color: S.sub }}>
                    {child.gender === 'male' ? '男' : '女'} · {child.birthDate} · {MODE_LABELS[child.nurtureMode] ?? child.nurtureMode}
                  </p>
                  {child.recorderProfiles && child.recorderProfiles.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      {child.recorderProfiles.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-0.5 text-[13px] px-2 py-0.5 rounded-full"
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
                      className="text-[13px] px-3.5 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                      style={{ background: '#f5f3ef', color: S.text }}>
                      设为活跃
                    </button>
                  )}
                  <button onClick={() => startEdit(child.childId)}
                    className="text-[13px] px-3.5 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                    style={{ background: '#f5f3ef', color: S.text }}>
                    编辑
                  </button>
                  <button onClick={() => setDeletingChildId(child.childId)}
                    className="text-[13px] px-3.5 py-1.5 rounded-full font-medium text-red-600 transition-colors hover:bg-red-50"
                    style={{ background: '#fef2f2' }}>
                    删除
                  </button>
                </div>
              </div>
              {deletingChildId === child.childId && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <p className="text-[14px] mb-3" style={{ color: '#b91c1c' }}>
                    删除 <strong>{child.displayName}</strong> 会级联删除所有关联数据（生长记录、疫苗、日记、AI 对话等），此操作不可撤销。
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => void handleDelete(child.childId)}
                      className="text-[13px] px-4 py-1.5 rounded-full text-white font-medium" style={{ background: '#dc2626' }}>
                      确认删除
                    </button>
                    <button onClick={() => setDeletingChildId(null)}
                      className="text-[13px] px-4 py-1.5 rounded-full font-medium" style={{ background: '#f5f3ef', color: S.text }}>
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
                  <ChildAvatar
                    child={{ avatarPath: null, birthDate: form.birthDate, gender: form.gender }}
                    className="w-20 h-20"
                  />
                )}
                <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              </button>
              <div>
                <p className="text-[14px] font-medium" style={{ color: S.text }}>
                  {form.avatarPreview ? '点击更换头像' : '上传头像'}
                </p>
                <p className="text-[13px] mt-0.5" style={{ color: S.sub }}>支持 JPG、PNG、WebP 格式</p>
              </div>
            </div>

            {/* Basic info */}
            <p className="text-[14px] font-semibold mb-3" style={{ color: S.sub }}>基本信息</p>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>姓名 *</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className={inp} style={inputBg} />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>性别 *</label>
                <AppSelect value={form.gender} onChange={(v) => setForm({ ...form, gender: v as 'male' | 'female' })}
                  options={[{ value: 'male', label: '男' }, { value: 'female', label: '女' }]} />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>出生日期 *</label>
                <ProfileDatePicker value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })}
                  maxDate={new Date().toISOString().slice(0, 10)} size="small" />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>养育模式</label>
                <AppSelect value={form.nurtureMode} onChange={(v) => setForm({ ...form, nurtureMode: v as NurtureMode })}
                  options={[{ value: 'relaxed', label: '轻松养' }, { value: 'balanced', label: '均衡养' }, { value: 'advanced', label: '进阶养' }]} />
              </div>
            </div>

            {/* Birth measurements */}
            <p className="text-[14px] font-semibold mb-3" style={{ color: S.sub }}>出生数据</p>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>体重 (kg)</label>
                <input type="number" step="0.01" value={form.birthWeightKg}
                  onChange={numChange('birthWeightKg', '3.50', 0.01)}
                  className={inp} style={inputBg} placeholder="3.50" />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>身长 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeightCm}
                  onChange={numChange('birthHeightCm', '50.0', 0.1)}
                  className={inp} style={inputBg} placeholder="50.0" />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>头围 (cm)</label>
                <input type="number" step="0.1" value={form.birthHeadCircCm}
                  onChange={numChange('birthHeadCircCm', '34.0', 0.1)}
                  className={inp} style={inputBg} placeholder="34.0" />
              </div>
            </div>

            {/* Medical info */}
            <p className="text-[14px] font-semibold mb-3" style={{ color: S.sub }}>健康信息</p>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>过敏史（逗号分隔）</label>
                <input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                  className={inp} style={inputBg} placeholder="牛奶, 花生" />
              </div>
              <div>
                <label className="text-[13px] block mb-1.5" style={{ color: S.sub }}>医疗备注（逗号分隔）</label>
                <input value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })}
                  className={inp} style={inputBg} placeholder="早产, G6PD缺乏" />
              </div>
            </div>

            {/* Recorder profile (single select) */}
            <p className="text-[14px] font-semibold mb-3" style={{ color: S.sub }}>记录者</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {RECORDER_PRESETS.map((p) => {
                const active = form.recorder.name === p.name;
                return (
                  <button key={p.name} onClick={() => selectRecorder(p)}
                    className={`${S.radiusSm} px-3.5 py-2 text-[14px] flex items-center gap-1.5 transition-all`}
                    style={active
                      ? { background: S.blue, color: '#fff', boxShadow: '0 2px 8px rgba(129,140,248,0.3)' }
                      : { background: '#f5f3ef', color: S.text }}>
                    <span>{p.emoji}</span> {p.name}
                  </button>
                );
              })}
              <button onClick={selectCustomRecorder}
                className={`${S.radiusSm} px-3.5 py-2 text-[14px] flex items-center gap-1 transition-all`}
                style={isCustom
                  ? { background: S.blue, color: '#fff', boxShadow: '0 2px 8px rgba(129,140,248,0.3)' }
                  : { background: '#f5f3ef', color: S.sub }}>
                👤 自定义
              </button>
            </div>
            {isCustom && (
              <input value={form.customRecorderName}
                onChange={(e) => setForm((prev) => ({ ...prev, customRecorderName: e.target.value, recorder: { ...prev.recorder, name: e.target.value, emoji: '👤' } }))}
                className={inp} style={inputBg} placeholder="输入自定义记录者名称" />
            )}
            <div className="mb-5" />

            {/* Actions */}
            <div className="flex gap-3 pt-2" style={{ borderTop: `1px solid ${INNER_BORDER}` }}>
              <button onClick={() => void (editingId ? handleUpdate() : handleAdd())}
                className="px-6 py-2.5 rounded-full text-[14px] font-medium text-white transition-all hover:opacity-90"
                style={{ background: S.blue, boxShadow: '0 2px 8px rgba(129,140,248,0.3)' }}>
                {editingId ? '保存' : '添加'}
              </button>
              <button onClick={resetForm}
                className="px-6 py-2.5 rounded-full text-[14px] font-medium transition-colors"
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
