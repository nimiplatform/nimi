import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Button, Surface, TextField, SelectField, cn } from '@nimiplatform/nimi-kit/ui';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { createChild, createFamily, deleteChild, getChildren, updateChild } from '../../bridge/sqlite-bridge.js';
import { saveChildAvatar } from '../../bridge/child-avatar-bridge.js';
import { mapChildRow } from '../../bridge/mappers.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { fileToBase64 } from '../journal/journal-page-helpers.js';
import { AvatarCropModal } from './avatar-crop-modal.js';
import { ProfileDatePicker } from '../profile/profile-date-picker.js';
import { ChildAvatar } from '../../shared/child-avatar.js';

/** Convert a local filesystem path to a Tauri 2 asset URL */
function assetUrl(path: string): string {
  try { return convertFileSrc(path); } catch { return path; }
}

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
  const location = useLocation();
  const navigate = useNavigate();
  const fromProfile = (location.state as { from?: string } | null)?.from === 'profile';
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const initialOpenHandledRef = useRef(false);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
    if (fromProfile) navigate('/profile');
  };

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

  useEffect(() => {
    if (initialOpenHandledRef.current) return;
    if (!fromProfile) return;
    if (!activeChildId) return;
    if (!children.find((c) => c.childId === activeChildId)) return;
    startEdit(activeChildId);
    initialOpenHandledRef.current = true;
  }, [fromProfile, activeChildId, children]);

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
    <div className="min-h-full bg-transparent p-6">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link to={fromProfile ? '/profile' : '/settings'} className="mb-5 inline-flex items-center gap-1 text-[14px] text-[var(--nimi-text-muted)] hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          {fromProfile ? '返回档案' : '返回设置'}
        </Link>

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">孩子管理</h1>
            <p className="mt-0.5 text-[14px] text-[var(--nimi-text-muted)]">管理孩子档案和基本信息</p>
          </div>
          {!showForm && (
            <Button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }} tone="primary" size="md" className="text-[14px]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加孩子
            </Button>
          )}
        </div>

        {/* Empty state */}
        {children.length === 0 && !showForm && (
          <Surface tone="card" material="solid" elevation="base" padding="lg" className="parentos-radius-xl p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--nimi-action-secondary-bg)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--nimi-text-muted)]" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <p className="text-[16px] font-medium text-[var(--nimi-text-primary)]">还没有添加孩子</p>
            <p className="mt-1 text-[14px] text-[var(--nimi-text-muted)]">点击上方按钮添加第一个孩子</p>
          </Surface>
        )}

        {/* Child list */}
        {!showForm && children.map((child) => {
          const isActive = activeChildId === child.childId;
          return (
            <Surface
              key={child.childId}
              tone="card"
              material="solid"
              elevation="base"
              padding="lg"
              className={cn(
                'mb-4 parentos-radius-xl border-l-[3px] transition-all duration-200 hover:shadow-[var(--nimi-elevation-raised)]',
                isActive ? 'border-l-[var(--nimi-action-primary-bg)]' : 'border-l-transparent',
              )}
            >
              <div className="flex items-center gap-4">
                <ChildAvatar
                  child={child}
                  className={cn(
                    'w-12 h-12 rounded-full object-cover shrink-0',
                    isActive ? 'parentos-child-avatar-outline-active' : 'parentos-child-avatar-outline-idle',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">{child.displayName}</h3>
                    {isActive && <span className="rounded-full bg-[var(--nimi-action-primary-bg)] px-2 py-0.5 text-[12px] text-[var(--nimi-action-primary-text)]">当前</span>}
                  </div>
                  <p className="mt-0.5 text-[14px] text-[var(--nimi-text-muted)]">
                    {child.gender === 'male' ? '男' : '女'} · {child.birthDate} · {MODE_LABELS[child.nurtureMode] ?? child.nurtureMode}
                  </p>
                  {child.recorderProfiles && child.recorderProfiles.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5">
                      {child.recorderProfiles.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-0.5 rounded-full bg-[var(--nimi-action-secondary-bg)] px-2 py-0.5 text-[13px] text-[var(--nimi-text-muted)]">
                          <span>{recorderEmoji(r.name)}</span> {r.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!isActive && (
                    <Button onClick={() => setActiveChildId(child.childId)} tone="secondary" size="sm" className="text-[13px]">
                      设为活跃
                    </Button>
                  )}
                  <Button onClick={() => startEdit(child.childId)} tone="secondary" size="sm" className="text-[13px]">
                    编辑
                  </Button>
                  <Button onClick={() => setDeletingChildId(child.childId)} tone="danger" size="sm" className="text-[13px]">
                    删除
                  </Button>
                </div>
              </div>
              {deletingChildId === child.childId && (
                <div className="mt-4 parentos-radius-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_25%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] p-4">
                  <p className="mb-3 text-[14px] text-[var(--nimi-status-danger)]">
                    删除 <strong>{child.displayName}</strong> 会级联删除所有关联数据（生长记录、疫苗、日记、AI 对话等），此操作不可撤销。
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => void handleDelete(child.childId)} tone="danger" size="sm" className="bg-[var(--nimi-status-danger)] text-[13px] text-[var(--nimi-action-primary-text)]">
                      确认删除
                    </Button>
                    <Button onClick={() => setDeletingChildId(null)} tone="secondary" size="sm" className="text-[13px]">
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </Surface>
          );
        })}

        {/* ── Add / Edit form ── */}
        {showForm && (
          <Surface tone="card" material="solid" elevation="base" padding="lg" className="parentos-radius-xl">
            <h3 className="mb-5 text-[16px] font-semibold text-[var(--nimi-text-primary)]">
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
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--nimi-scrim-modal)] opacity-0 transition-opacity group-hover:opacity-100">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--nimi-action-primary-text)]" strokeWidth="2" strokeLinecap="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              </button>
              <div>
                <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">
                  {form.avatarPreview ? '点击更换头像' : '上传头像'}
                </p>
                <p className="mt-0.5 text-[13px] text-[var(--nimi-text-muted)]">支持 JPG、PNG、WebP 格式</p>
              </div>
            </div>

            {/* Basic info */}
            <p className="mb-3 text-[14px] font-semibold text-[var(--nimi-text-muted)]">基本信息</p>
            <div className="mb-5 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">姓名 *</label>
                <TextField value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="w-full" inputClassName="text-[14px]" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">性别 *</label>
                <SelectField value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as 'male' | 'female' })}
                  options={[{ value: 'male', label: '男' }, { value: 'female', label: '女' }]} />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">出生日期 *</label>
                <ProfileDatePicker value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })}
                  maxDate={new Date().toISOString().slice(0, 10)} size="small" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">养育模式</label>
                <SelectField value={form.nurtureMode} onValueChange={(v) => setForm({ ...form, nurtureMode: v as NurtureMode })}
                  options={[{ value: 'relaxed', label: '轻松养' }, { value: 'balanced', label: '均衡养' }, { value: 'advanced', label: '进阶养' }]} />
              </div>
            </div>

            {/* Birth measurements */}
            <p className="mb-3 text-[14px] font-semibold text-[var(--nimi-text-muted)]">出生数据</p>
            <div className="mb-5 grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">体重 (kg)</label>
                <TextField type="number" step="0.01" value={form.birthWeightKg}
                  onChange={numChange('birthWeightKg', '3.50', 0.01)}
                  className="w-full" inputClassName="text-[14px]" placeholder="3.50" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">身长 (cm)</label>
                <TextField type="number" step="0.1" value={form.birthHeightCm}
                  onChange={numChange('birthHeightCm', '50.0', 0.1)}
                  className="w-full" inputClassName="text-[14px]" placeholder="50.0" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">头围 (cm)</label>
                <TextField type="number" step="0.1" value={form.birthHeadCircCm}
                  onChange={numChange('birthHeadCircCm', '34.0', 0.1)}
                  className="w-full" inputClassName="text-[14px]" placeholder="34.0" />
              </div>
            </div>

            {/* Medical info */}
            <p className="mb-3 text-[14px] font-semibold text-[var(--nimi-text-muted)]">健康信息</p>
            <div className="mb-5 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">过敏史（逗号分隔）</label>
                <TextField value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                  className="w-full" inputClassName="text-[14px]" placeholder="牛奶, 花生" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] text-[var(--nimi-text-muted)]">医疗备注（逗号分隔）</label>
                <TextField value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })}
                  className="w-full" inputClassName="text-[14px]" placeholder="早产, G6PD缺乏" />
              </div>
            </div>

            {/* Recorder profile (single select) */}
            <p className="mb-3 text-[14px] font-semibold text-[var(--nimi-text-muted)]">记录者</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {RECORDER_PRESETS.map((p) => {
                const active = form.recorder.name === p.name;
                return (
                  <button key={p.name} onClick={() => selectRecorder(p)}
                    className={cn(
                      'flex items-center gap-1.5 parentos-radius-lg px-3.5 py-2 text-[14px] transition-all',
                      active
                        ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                        : 'bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)]',
                    )}>
                    <span>{p.emoji}</span> {p.name}
                  </button>
                );
              })}
              <button onClick={selectCustomRecorder}
                className={cn(
                  'flex items-center gap-1 parentos-radius-lg px-3.5 py-2 text-[14px] transition-all',
                  isCustom
                    ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                    : 'bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)]',
                )}>
                👤 自定义
              </button>
            </div>
            {isCustom && (
              <TextField value={form.customRecorderName}
                onChange={(e) => setForm((prev) => ({ ...prev, customRecorderName: e.target.value, recorder: { ...prev.recorder, name: e.target.value, emoji: '👤' } }))}
                className="w-full" inputClassName="text-[14px]" placeholder="输入自定义记录者名称" />
            )}
            <div className="mb-5" />

            {/* Actions */}
            <div className="flex gap-3 border-t border-[var(--nimi-border-subtle)] pt-2">
              <Button onClick={() => void (editingId ? handleUpdate() : handleAdd())} tone="primary" size="md" className="px-6 text-[14px]">
                {editingId ? '保存' : '添加'}
              </Button>
              <Button onClick={resetForm} tone="secondary" size="md" className="px-6 text-[14px]">
                取消
              </Button>
            </div>
          </Surface>
        )}
      </div>

      {/* Avatar crop modal */}
      {cropImageUrl && (
        <AvatarCropModal imageUrl={cropImageUrl} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
      )}
    </div>
  );
}
