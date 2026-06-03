import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  disableRealmTwoFactor,
  enableRealmTwoFactor,
  prepareRealmTwoFactor,
  updateRealmPassword,
} from '@nimiplatform/sdk/realm';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { FormFeedback, PageShell, SaveFooter, SectionTitle } from './settings-layout-components.js';
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MonitorIcon,
  PasswordField,
  SettingRow,
  ShieldIcon,
} from './settings-security-controls.js';

export function SecurityPage() {
  const { t } = useTranslation();
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const initialTwoFactorEnabled = authUser?.isTwoFactorEnabled === true;
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactor, setTwoFactor] = useState(initialTwoFactorEnabled);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [twoFactorUri, setTwoFactorUri] = useState('');
  const [revealTwoFactorSecret, setRevealTwoFactorSecret] = useState(false);
  const [preparingTwoFactor, setPreparingTwoFactor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const passwordsMatch = newPw === confirmPw;

  useEffect(() => {
    setTwoFactor(initialTwoFactorEnabled);
  }, [initialTwoFactorEnabled]);

  useEffect(() => {
    if (!twoFactor) {
      setRevealTwoFactorSecret(false);
    }
  }, [twoFactor]);

  useEffect(() => {
    if (!twoFactor || initialTwoFactorEnabled || twoFactorSecret || preparingTwoFactor) {
      return;
    }
    setPreparingTwoFactor(true);
    void prepareRealmTwoFactor(getPlatformClient().realm)
      .then((payload) => {
        setTwoFactorSecret(String(payload.secret || ''));
        setTwoFactorUri(String(payload.otpauthUri || ''));
      })
      .catch((error) => {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : t('SecuritySettings.prepareTwoFactorFailed'),
        });
        setTwoFactor(false);
      })
      .finally(() => {
        setPreparingTwoFactor(false);
      });
  }, [
    initialTwoFactorEnabled,
    preparingTwoFactor,
    t,
    twoFactor,
    twoFactorSecret,
  ]);

  const refreshCurrentUser = async () => {
    const latest = await realmSocialData.loadCurrentUser();
    const normalized = parseOptionalJsonObject(latest) ?? null;
    setAuthSession(normalized);
  };

  const copyTwoFactorValue = async (value: string, successKey: string, successDefaultValue: string) => {
    if (!value.trim() || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({
        kind: 'success',
        message: t(successKey, { defaultValue: successDefaultValue }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('SecuritySettings.copySecretFailed', { defaultValue: 'Failed to copy secret' }),
      });
    }
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }
    if (newPw && !passwordsMatch) {
      setFeedback({
        kind: 'error',
        message: t('SecuritySettings.passwordMismatch'),
      });
      return;
    }
    if (twoFactor !== initialTwoFactorEnabled && twoFactorCode.trim().length !== 6) {
      setFeedback({
        kind: 'error',
        message: t('SecuritySettings.twoFactorCodeRequired'),
      });
      return;
    }
    setSaving(true);
    try {
      if (newPw.trim()) {
        await updateRealmPassword(getPlatformClient().realm, {
          oldPassword: currentPw.trim() || undefined,
          newPassword: newPw.trim(),
        });
      }

      if (twoFactor !== initialTwoFactorEnabled) {
        const payload = {
          code: twoFactorCode.trim(),
        };
        if (twoFactor) {
          await enableRealmTwoFactor(getPlatformClient().realm, payload);
        } else {
          await disableRealmTwoFactor(getPlatformClient().realm, payload);
        }
      }

      if (newPw.trim() || twoFactor !== initialTwoFactorEnabled) {
        await refreshCurrentUser();
      }

      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTwoFactorCode('');
      if (!twoFactor) {
        setTwoFactorSecret('');
        setTwoFactorUri('');
        setRevealTwoFactorSecret(false);
      }

      setFeedback({
        kind: 'success',
        message: t('SecuritySettings.updateSuccess'),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('SecuritySettings.updateError'),
      });
    } finally {
      setSaving(false);
    }
  };

  const maskedTwoFactorSecret = revealTwoFactorSecret
    ? twoFactorSecret
    : '•'.repeat(Math.max(8, Math.min(twoFactorSecret.length, 24)));
  const maskedTwoFactorUri = revealTwoFactorSecret
    ? twoFactorUri
    : '•'.repeat(Math.max(12, Math.min(twoFactorUri.length, 32)));

  return (
    <PageShell
      title={t('SecuritySettings.pageTitle')}
      description={t('SecuritySettings.pageDescription')}
    >
      {feedback ? (
        <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-6" />
      ) : null}
      {/* Change Password */}
      <section>
        <SectionTitle>{t('SecuritySettings.changePasswordTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <PasswordField
              label={t('SecuritySettings.currentPasswordLabel')}
              value={currentPw}
              onChange={setCurrentPw}
              placeholder={t('SecuritySettings.currentPasswordPlaceholder')}
              showPassword={showPassword}
              icon={<LockIcon className="h-5 w-5" />}
            />
            <PasswordField
              label={t('SecuritySettings.newPasswordLabel')}
              value={newPw}
              onChange={setNewPw}
              placeholder={t('SecuritySettings.newPasswordPlaceholder')}
              showPassword={showPassword}
            />
            <div>
              <PasswordField
                label={t('SecuritySettings.confirmPasswordLabel')}
                value={confirmPw}
                onChange={setConfirmPw}
                placeholder={t('SecuritySettings.confirmPasswordPlaceholder')}
                showPassword={showPassword}
              />
              {newPw && confirmPw && !passwordsMatch && (
                <p className="mt-1.5 text-xs text-red-500">{t('SecuritySettings.passwordMismatch')}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="mt-4 flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            {showPassword ? t('SecuritySettings.hidePasswords') : t('SecuritySettings.showPasswords')}
          </button>
        </div>
      </section>

      {/* Two-Factor Authentication */}
      <section className="mt-8">
        <SectionTitle description={t('SecuritySettings.twoFactorDescription')}>
          {t('SecuritySettings.twoFactorTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<ShieldIcon className="h-5 w-5" />}
            title={t('SecuritySettings.enable2faLabel')}
            description={t('SecuritySettings.enable2faDescription')}
            checked={twoFactor}
            onChange={setTwoFactor}
            disabled={preparingTwoFactor || saving}
          />
        </div>
        {twoFactor && (
          <div className="mt-3 rounded-2xl border border-green-100 bg-green-50/50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckIcon className="h-4 w-4" />
              </div>
              <p className="text-sm text-green-700">{t('SecuritySettings.twoFactorEnabled')}</p>
            </div>
          </div>
        )}
        {twoFactor && !initialTwoFactorEnabled ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-700">{t('SecuritySettings.newTwoFactorSetup')}</p>
            {twoFactorSecret || twoFactorUri ? (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                {twoFactorSecret ? (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {t('SecuritySettings.secretLabel', { defaultValue: 'Secret' })}
                    </p>
                    <p className="break-all font-mono text-xs text-gray-700">{maskedTwoFactorSecret}</p>
                  </div>
                ) : null}
                {twoFactorUri ? (
                  <div className="mt-3 space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {t('SecuritySettings.uriLabel', { defaultValue: 'URI' })}
                    </p>
                    <p className="break-all font-mono text-[11px] text-gray-500">{maskedTwoFactorUri}</p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRevealTwoFactorSecret((current) => !current)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    {revealTwoFactorSecret
                      ? t('SecuritySettings.hideSecret', { defaultValue: 'Hide secret' })
                      : t('SecuritySettings.revealSecret', { defaultValue: 'Reveal secret' })}
                  </button>
                  {twoFactorSecret ? (
                    <button
                      type="button"
                      onClick={() => {
                        void copyTwoFactorValue(
                          twoFactorSecret,
                          'SecuritySettings.copySecretSuccess',
                          'Secret copied',
                        );
                      }}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                    >
                      {t('SecuritySettings.copySecret', { defaultValue: 'Copy secret' })}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="mt-3">
              <label className="mb-2 block text-xs font-medium text-gray-700">
                {t('SecuritySettings.authenticatorCodeLabel')}
              </label>
              <input
                type="text"
                value={twoFactorCode}
                onChange={(event) => {
                  setTwoFactorCode(event.target.value.replace(/\D+/g, '').slice(0, 6));
                }}
                placeholder="123456"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
              />
            </div>
          </div>
        ) : null}
        {!twoFactor && initialTwoFactorEnabled ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <label className="mb-2 block text-xs font-medium text-gray-700">
              {t('SecuritySettings.disableTwoFactorCodeLabel')}
            </label>
            <input
              type="text"
              value={twoFactorCode}
              onChange={(event) => {
                setTwoFactorCode(event.target.value.replace(/\D+/g, '').slice(0, 6));
              }}
              placeholder="123456"
              className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
            />
          </div>
        ) : null}
      </section>

      {/* Active Sessions */}
      <section className="mt-8">
        <SectionTitle description={t('SecuritySettings.activeSessionsDescription')}>
          {t('SecuritySettings.activeSessionsTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                <MonitorIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{t('SecuritySettings.thisDevice')}</p>
                <p className="text-xs text-gray-500">{t('SecuritySettings.thisDeviceLastActive')}</p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              {t('SecuritySettings.currentSession')}
            </span>
          </div>
        </div>
      </section>

      <SaveFooter
        onSave={() => {
          void handleSave();
        }}
        saving={saving}
        showCancel={false}
      />
    </PageShell>
  );
}
