/**
 * parent-mode-panel.tsx — PIN-gated parent mode panel (SJ-SHELL-005:5, SJ-SHELL-006)
 *
 * PIN proof is stored behind the Tauri parent PIN bridge.
 * Unlocked state reveals profile list and editor.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfiles } from '@renderer/hooks/use-profiles.js';
import type { ProfileFormInput } from '@renderer/hooks/use-profiles.js';
import { hasParentPin, setParentPin, verifyParentPin } from '@renderer/bridge/parent-pin.js';
import { ProfileList } from './profile-list.js';
import { ProfileEditor } from './profile-editor.js';
import type { LearnerProfile } from '@renderer/app-shell/app-store.js';

type EditorTarget = LearnerProfile | 'new' | null;
type PinGateState = 'loading' | 'ready' | 'error';

const pinInputCls =
  'w-32 rounded-lg border border-neutral-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-400 text-center tracking-[0.3em] transition-colors';

export function ParentModePanel() {
  const { t } = useTranslation();
  const { profiles, activeProfile, createProfile, updateProfile, switchProfile } = useProfiles();

  const [unlocked, setUnlocked] = useState(false);
  const [pinGateState, setPinGateState] = useState<PinGateState>('loading');
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const [editorTarget, setEditorTarget] = useState<EditorTarget>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasParentPin()
      .then((exists) => {
        if (cancelled) return;
        setIsSettingPin(!exists);
        setPinGateState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setPinError(error instanceof Error ? error.message : String(error));
        setPinGateState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSetPin() {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError(t('settings.parentMode.pinInvalidFormat'));
      return;
    }
    if (pinInput !== pinConfirm) {
      setPinError(t('settings.parentMode.pinMismatch'));
      return;
    }
    setPinBusy(true);
    try {
      await setParentPin(pinInput);
      setPinError(null);
      setUnlocked(true);
      setIsSettingPin(false);
      setPinInput('');
      setPinConfirm('');
    } catch (error) {
      setPinError(error instanceof Error ? error.message : String(error));
    } finally {
      setPinBusy(false);
    }
  }

  async function handleEnterPin() {
    setPinBusy(true);
    try {
      if (await verifyParentPin(pinInput)) {
        setUnlocked(true);
        setPinInput('');
        setPinError(null);
      } else {
        setPinError(t('settings.parentMode.wrongPin'));
      }
    } catch (error) {
      setPinError(error instanceof Error ? error.message : String(error));
    } finally {
      setPinBusy(false);
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

  if (!unlocked && pinGateState === 'loading') {
    return <p className="text-xs text-neutral-500">{t('settings.parentMode.loadingPin')}</p>;
  }

  if (!unlocked && pinGateState === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-500">{t('settings.parentMode.pinStorageUnavailable')}</p>
        {pinError !== null && <p className="text-xs text-red-500">{pinError}</p>}
      </div>
    );
  }

  // Locked: set PIN
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
          onClick={() => void handleSetPin()}
          disabled={pinBusy}
          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
        >
          {t('settings.parentMode.setPin')}
        </button>
      </div>
    );
  }

  // Locked: enter PIN
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
          onKeyDown={(e) => { if (e.key === 'Enter') void handleEnterPin(); }}
          placeholder="••••"
          className={pinInputCls}
          autoFocus
        />
        {pinError !== null && <p className="text-xs text-red-500">{pinError}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleEnterPin()}
            disabled={pinBusy}
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

  // Unlocked
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
