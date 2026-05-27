/**
 * profile-editor.tsx — Learner profile create/edit form (SJ-SHELL-006)
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LearnerProfile } from '@renderer/app-shell/app-store.js';
import type { ProfileFormInput } from '@renderer/hooks/use-profiles.js';

type ProfileEditorProps = {
  profile: LearnerProfile | null; // null = create mode
  onSave: (input: ProfileFormInput) => Promise<void>;
  onCancel: () => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-400 transition-colors';
const textareaCls = `${inputCls} resize-none`;

export function ProfileEditor({ profile, onSave, onCancel }: ProfileEditorProps) {
  const { t } = useTranslation();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [age, setAge] = useState(profile ? String(profile.age) : '');
  const [communicationStyle, setCommunicationStyle] = useState(profile?.communicationStyle ?? '');
  const [guardianGoals, setGuardianGoals] = useState(profile?.guardianGoals ?? '');
  const [strengthTagsInput, setStrengthTagsInput] = useState(
    (profile?.strengthTags ?? []).join(', '),
  );
  const [interestTagsInput, setInterestTagsInput] = useState(
    (profile?.interestTags ?? []).join(', '),
  );
  const [supportNotesInput, setSupportNotesInput] = useState(
    (profile?.supportNotes ?? []).join('\n'),
  );
  const [guidanceInput, setGuidanceInput] = useState(
    profile?.guardianGuidance?.['general'] ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!displayName.trim()) {
      setError(t('profile.errorNameRequired'));
      return;
    }
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 100) {
      setError(t('profile.errorAgeInvalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        displayName: displayName.trim(),
        age: ageNum,
        communicationStyle: communicationStyle.trim(),
        guardianGoals: guardianGoals.trim(),
        strengthTags: strengthTagsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        interestTags: interestTagsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        supportNotes: supportNotesInput
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        guardianGuidance: guidanceInput.trim() ? { general: guidanceInput.trim() } : {},
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="border border-amber-200 rounded-xl p-5 bg-amber-50/30 space-y-4">
      <h3 className="text-sm font-semibold text-neutral-700">
        {profile ? t('profile.edit') : t('profile.create')}
      </h3>

      {/* Name + Age row */}
      <div className="flex gap-3">
        <Field label={`${t('profile.displayName')} *`}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputCls}
            placeholder="小明"
            style={{ flex: 1 }}
          />
        </Field>
        <div className="space-y-1 w-24">
          <label className="text-xs font-medium text-neutral-500">{`${t('profile.age')} *`}</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={1}
            max={100}
            className={inputCls}
            placeholder="10"
          />
        </div>
      </div>

      <Field label={t('profile.communicationStyle')}>
        <textarea
          value={communicationStyle}
          onChange={(e) => setCommunicationStyle(e.target.value)}
          rows={2}
          className={textareaCls}
          placeholder={t('profile.communicationStyleHint')}
        />
      </Field>

      <Field label={t('profile.strengthTags')}>
        <input
          type="text"
          value={strengthTagsInput}
          onChange={(e) => setStrengthTagsInput(e.target.value)}
          className={inputCls}
          placeholder={t('profile.tagsHint')}
        />
      </Field>

      <Field label={t('profile.interestTags')}>
        <input
          type="text"
          value={interestTagsInput}
          onChange={(e) => setInterestTagsInput(e.target.value)}
          className={inputCls}
          placeholder={t('profile.tagsHint')}
        />
      </Field>

      <Field label={t('profile.guardianGoals')}>
        <textarea
          value={guardianGoals}
          onChange={(e) => setGuardianGoals(e.target.value)}
          rows={2}
          className={textareaCls}
          placeholder={t('profile.guardianGoalsHint')}
        />
      </Field>

      <Field label={t('profile.supportNotes')}>
        <textarea
          value={supportNotesInput}
          onChange={(e) => setSupportNotesInput(e.target.value)}
          rows={2}
          className={textareaCls}
          placeholder={t('profile.notesHint')}
        />
      </Field>

      <Field label={t('profile.guardianGuidance')}>
        <textarea
          value={guidanceInput}
          onChange={(e) => setGuidanceInput(e.target.value)}
          rows={2}
          className={textareaCls}
          placeholder={t('profile.guardianGuidanceHint')}
        />
      </Field>

      {error !== null && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {saving ? '…' : t('profile.save')}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 bg-white border border-neutral-200 text-neutral-600 rounded-lg text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 transition-colors"
        >
          {t('profile.cancel')}
        </button>
      </div>
    </div>
  );
}
