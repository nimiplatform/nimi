/**
 * parent-mode-panel.tsx — PIN-gated parent mode panel (SJ-SHELL-005:5, SJ-SHELL-006)
 *
 * PIN stored in localStorage via bridge/parent-pin.ts.
 * Unlocked state reveals profile list and editor.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfiles } from '@renderer/hooks/use-profiles.js';
import type { ProfileFormInput } from '@renderer/hooks/use-profiles.js';
import { getParentPin, setParentPin } from '@renderer/bridge/parent-pin.js';
import { ProfileList } from './profile-list.js';
import { ProfileEditor } from './profile-editor.js';
import type { LearnerProfile } from '@renderer/app-shell/app-store.js';

type EditorTarget = LearnerProfile | 'new' | null;

const pinInputCls =
  'w-32 rounded-lg border border-neutral-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-400 text-center tracking-[0.3em] transition-colors';

export function ParentModePanel() {
  const { t } = useTranslation();
  const { profiles, activeProfile, createProfile, updateProfile, switchProfile } = useProfiles();

  const storedPin = getParentPin();
  const [unlocked, setUnlocked] = useState(false);
  const [isSettingPin, setIsSettingPin] = useState(!storedPin);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [editorTarget, setEditorTarget] = useState<EditorTarget>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  function handleSetPin() {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError(t('settings.parentMode.pinInvalidFormat'));
      return;
    }
    if (pinInput !== pinConfirm) {
      setPinError(t('settings.parentMode.pinMismatch'));
      return;
    }
    setParentPin(pinInput);
    setPinError(null);
    setUnlocked(true);
  }

  function handleEnterPin() {
    const current = getParentPin();
    if (pinInput === current) {
      setUnlocked(true);
      setPinError(null);
    } else {
      setPinError(t('settings.parentMode.wrongPin'));
    }
  }

  async function handleSaveProfile(input: ProfileFormInput) {
    setEditorError(null);
    try {
      if (editorTarget === 'new' || editorTarget === null) {
        await createProfile(input);
      } else {
        await updateProfile(editorTarget.id, input);
      }
      setEditorTarget(null);
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : String(e));
      throw e; // re-throw so ProfileEditor shows its own error state
    }
  }

  // ── Locked: set PIN ───────────────────────────────────────────────────────
  if (!unlocked && isSettingPin) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">{t('settings.parentMode.setPinDescription')}</p>
        <div className="space-y-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinInput}
            onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(null); }}
            placeholder={t('settings.parentMode.pinPlaceholder')}
            className={pinInputCls}
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinConfirm}
            onChange={(e) => { setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(null); }}
            placeholder={t('settings.parentMode.pinConfirmPlaceholder')}
            className={pinInputCls}
          />
        </div>
        {pinError !== null && <p className="text-xs text-red-500">{pinError}</p>}
        <button
          onClick={handleSetPin}
          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
        >
          {t('settings.parentMode.setPin')}
        </button>
      </div>
    );
  }

  // ── Locked: enter PIN ─────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">{t('settings.parentMode.enterPinDescription')}</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pinInput}
          onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleEnterPin(); }}
          placeholder="••••"
          className={pinInputCls}
          autoFocus
        />
        {pinError !== null && <p className="text-xs text-red-500">{pinError}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={handleEnterPin}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            {t('settings.parentMode.unlock')}
          </button>
          <button
            onClick={() => { setIsSettingPin(true); setPinInput(''); setPinConfirm(''); setPinError(null); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            {t('settings.parentMode.resetPin')}
          </button>
        </div>
      </div>
    );
  }

  // ── Unlocked ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Profile list — SJ-SHELL-006:5,6 */}
      <ProfileList
        profiles={profiles}
        activeProfileId={activeProfile?.id ?? null}
        onEdit={(p) => { setEditorTarget(p); setEditorError(null); }}
        onSwitch={switchProfile}
      />

      {editorError !== null && (
        <p className="text-xs text-red-500">{editorError}</p>
      )}

      {/* Add profile button — SJ-SHELL-006:5 */}
      {editorTarget === null && (
        <button
          onClick={() => { setEditorTarget('new'); setEditorError(null); }}
          className="flex items-center gap-1.5 text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
        >
          <span className="text-base leading-none">+</span>
          {t('settings.parentMode.addProfile')}
        </button>
      )}

      {/* Profile editor */}
      {editorTarget !== null && (
        <ProfileEditor
          profile={editorTarget === 'new' ? null : editorTarget}
          onSave={(input) => handleSaveProfile(input)}
          onCancel={() => setEditorTarget(null)}
        />
      )}

      {/* Lock button */}
      <div className="pt-2 border-t border-neutral-100">
        <button
          onClick={() => { setUnlocked(false); setPinInput(''); setPinError(null); setEditorTarget(null); }}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          {t('settings.parentMode.lock')}
        </button>
      </div>
    </div>
  );
}
