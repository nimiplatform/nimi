import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, type NurtureMode } from '../../app-shell/app-store.js';
import { createChild, createFamily, deleteChild, getChildren, updateChild } from '../../bridge/sqlite-bridge.js';
import { mapChildRow } from '../../bridge/mappers.js';
import { isoNow, ulid } from '../../bridge/ulid.js';

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
  displayName: '',
  gender: 'male',
  birthDate: '',
  birthWeightKg: '',
  birthHeightCm: '',
  birthHeadCircCm: '',
  nurtureMode: 'balanced',
  allergies: '',
  medicalNotes: '',
  recorderProfiles: '',
};

function parseCsvList(value: string) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

function parseRecorderProfiles(value: string) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name, index) => ({ id: `recorder-${index + 1}`, name }));
  return items.length > 0 ? JSON.stringify(items) : null;
}

export default function ChildrenSettingsPage() {
  const {
    activeChildId,
    children,
    familyId,
    setActiveChildId,
    setChildren,
    setFamilyId,
  } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
  };

  const refreshChildren = async (nextFamilyId: string | null) => {
    if (!nextFamilyId) return;
    try {
      const rows = await getChildren(nextFamilyId);
      setChildren(rows.map(mapChildRow));
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const handleAdd = async () => {
    if (!form.displayName || !form.birthDate) return;
    const now = isoNow();

    try {
      let nextFamilyId = familyId;
      if (!nextFamilyId) {
        nextFamilyId = ulid();
        await createFamily(nextFamilyId, '我的家庭', now);
        setFamilyId(nextFamilyId);
      }

      await createChild({
        childId: ulid(),
        familyId: nextFamilyId,
        displayName: form.displayName,
        gender: form.gender,
        birthDate: form.birthDate,
        birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath: null,
        nurtureMode: form.nurtureMode,
        nurtureModeOverrides: null,
        allergies: parseCsvList(form.allergies),
        medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: parseRecorderProfiles(form.recorderProfiles),
        now,
      });

      await refreshChildren(nextFamilyId);
      resetForm();
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !form.displayName || !form.birthDate) return;
    const existingChild = children.find((child) => child.childId === editingId);
    if (!existingChild) return;

    try {
      await updateChild({
        childId: editingId,
        displayName: form.displayName,
        gender: form.gender,
        birthDate: form.birthDate,
        birthWeightKg: form.birthWeightKg ? parseFloat(form.birthWeightKg) : null,
        birthHeightCm: form.birthHeightCm ? parseFloat(form.birthHeightCm) : null,
        birthHeadCircCm: form.birthHeadCircCm ? parseFloat(form.birthHeadCircCm) : null,
        avatarPath: existingChild.avatarPath,
        nurtureMode: form.nurtureMode,
        nurtureModeOverrides: existingChild.nurtureModeOverrides
          ? JSON.stringify(existingChild.nurtureModeOverrides)
          : null,
        allergies: parseCsvList(form.allergies),
        medicalNotes: parseCsvList(form.medicalNotes),
        recorderProfiles: parseRecorderProfiles(form.recorderProfiles),
        now: isoNow(),
      });

      await refreshChildren(existingChild.familyId);
      resetForm();
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const handleDelete = async (childId: string) => {
    try {
      await deleteChild(childId);
      if (activeChildId === childId) {
        setActiveChildId(null);
      }
      setDeletingChildId(null);
      await refreshChildren(familyId);
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const startEdit = (childId: string) => {
    const child = children.find((item) => item.childId === childId);
    if (!child) return;
    setForm({
      displayName: child.displayName,
      gender: child.gender,
      birthDate: child.birthDate,
      birthWeightKg: child.birthWeightKg?.toString() ?? '',
      birthHeightCm: child.birthHeightCm?.toString() ?? '',
      birthHeadCircCm: child.birthHeadCircCm?.toString() ?? '',
      nurtureMode: child.nurtureMode,
      allergies: child.allergies?.join(', ') ?? '',
      medicalNotes: child.medicalNotes?.join(', ') ?? '',
      recorderProfiles: child.recorderProfiles?.map((item) => item.name).join(', ') ?? '',
    });
    setEditingId(childId);
    setShowForm(true);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; 返回设置
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">孩子管理</h1>
        {!showForm && (
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setShowForm(true);
            }}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            + 添加孩子
          </button>
        )}
      </div>

      {children.length === 0 && !showForm && <p className="text-gray-400">还没有添加孩子</p>}

      {!showForm &&
        children.map((child) => (
          <div
            key={child.childId}
            className={`border rounded-lg p-4 mb-3 ${
              activeChildId === child.childId ? 'border-indigo-300 bg-indigo-50/30' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{child.displayName}</h3>
                <p className="text-xs text-gray-500">
                  {child.gender === 'male' ? '男' : '女'} · {child.birthDate} · {child.nurtureMode}
                </p>
                {child.recorderProfiles?.length ? (
                  <p className="text-xs text-gray-400 mt-1">
                    记录者：{child.recorderProfiles.map((item) => item.name).join('、')}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {activeChildId !== child.childId && (
                  <button
                    onClick={() => setActiveChildId(child.childId)}
                    className="text-xs px-3 py-1.5 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    设为活跃
                  </button>
                )}
                <button
                  onClick={() => startEdit(child.childId)}
                  className="text-xs px-3 py-1.5 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  编辑
                </button>
                <button
                  onClick={() => setDeletingChildId(child.childId)}
                  className="text-xs px-3 py-1.5 text-red-600 bg-red-50 rounded-md hover:bg-red-100"
                >
                  删除
                </button>
              </div>
            </div>
            {deletingChildId === child.childId && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700 mb-2">
                  删除 <strong>{child.displayName}</strong> 会级联删除该孩子的生长记录、疫苗记录、日记、AI
                  对话和提醒状态，此操作不可撤销。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleDelete(child.childId)}
                    className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700"
                  >
                    确认删除
                  </button>
                  <button
                    onClick={() => setDeletingChildId(null)}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

      {showForm && (
        <div className="border rounded-lg p-6 space-y-4">
          <h3 className="font-medium">{editingId ? '编辑孩子' : '添加孩子'}</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">姓名 *</label>
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">性别 *</label>
              <select
                value={form.gender}
                onChange={(event) => setForm({ ...form, gender: event.target.value as 'male' | 'female' })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              >
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">出生日期 *</label>
              <input
                type="date"
                value={form.birthDate}
                onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">养育模式</label>
              <select
                value={form.nurtureMode}
                onChange={(event) => setForm({ ...form, nurtureMode: event.target.value as NurtureMode })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              >
                <option value="relaxed">轻松养</option>
                <option value="balanced">均衡养</option>
                <option value="advanced">进阶养</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">出生体重 (kg)</label>
              <input
                type="number"
                step="0.01"
                value={form.birthWeightKg}
                onChange={(event) => setForm({ ...form, birthWeightKg: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">出生身长 (cm)</label>
              <input
                type="number"
                step="0.1"
                value={form.birthHeightCm}
                onChange={(event) => setForm({ ...form, birthHeightCm: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">出生头围 (cm)</label>
              <input
                type="number"
                step="0.1"
                value={form.birthHeadCircCm}
                onChange={(event) => setForm({ ...form, birthHeadCircCm: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">过敏史（逗号分隔）</label>
              <input
                value={form.allergies}
                onChange={(event) => setForm({ ...form, allergies: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">医疗备注（逗号分隔）</label>
              <input
                value={form.medicalNotes}
                onChange={(event) => setForm({ ...form, medicalNotes: event.target.value })}
                className="border rounded-md px-3 py-1.5 text-sm w-full"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">记录者（逗号分隔）</label>
            <input
              value={form.recorderProfiles}
              onChange={(event) => setForm({ ...form, recorderProfiles: event.target.value })}
              placeholder="妈妈, 爸爸"
              className="border rounded-md px-3 py-1.5 text-sm w-full"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void (editingId ? handleUpdate() : handleAdd())}
              className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              {editingId ? '保存' : '添加'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
