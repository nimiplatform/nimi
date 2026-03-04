import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { PageShell, SaveFooter, SectionTitle } from '../../settings-layout-components';

export function SecurityPage() {
  const { t } = useTranslation();
  const authToken = useAppStore((state) => state.auth.token);
  const refreshToken = useAppStore((state) => state.auth.refreshToken);
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const initialTwoFactorEnabled = authUser?.isTwoFactorEnabled === true;
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactor, setTwoFactor] = useState(initialTwoFactorEnabled);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [twoFactorUri, setTwoFactorUri] = useState('');
  const [preparingTwoFactor, setPreparingTwoFactor] = useState(false);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  const passwordsMatch = newPw === confirmPw;

  useEffect(() => {
    setTwoFactor(initialTwoFactorEnabled);
  }, [initialTwoFactorEnabled]);

  useEffect(() => {
    if (!twoFactor || initialTwoFactorEnabled || twoFactorSecret || preparingTwoFactor) {
      return;
    }
    setPreparingTwoFactor(true);
    void dataSync.prepareTwoFactor()
      .then((payload) => {
        setTwoFactorSecret(String(payload.secret || ''));
        setTwoFactorUri(String(payload.otpauthUri || ''));
      })
      .catch((error) => {
        setStatusBanner({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to prepare two-factor authentication',
        });
        setTwoFactor(false);
      })
      .finally(() => {
        setPreparingTwoFactor(false);
      });
  }, [
    initialTwoFactorEnabled,
    preparingTwoFactor,
    setStatusBanner,
    twoFactor,
    twoFactorSecret,
  ]);

  const refreshCurrentUser = async () => {
    const latest = await dataSync.loadCurrentUser();
    const normalized = latest && typeof latest === 'object'
      ? (latest as Record<string, unknown>)
      : null;
    setAuthSession(normalized, authToken, refreshToken || undefined);
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }
    if (newPw && !passwordsMatch) {
      setStatusBanner({
        kind: 'error',
        message: t('SecuritySettings.passwordMismatch'),
      });
      return;
    }
    if (twoFactor !== initialTwoFactorEnabled && twoFactorCode.trim().length !== 6) {
      setStatusBanner({
        kind: 'error',
        message: 'Please enter a 6-digit 2FA code to confirm this change.',
      });
      return;
    }
    setSaving(true);
    try {
      if (newPw.trim()) {
        await dataSync.updatePassword({
          oldPassword: currentPw.trim() || undefined,
          newPassword: newPw.trim(),
        });
      }

      if (twoFactor !== initialTwoFactorEnabled) {
        const payload = {
          code: twoFactorCode.trim(),
        };
        if (twoFactor) {
          await dataSync.enableTwoFactor(payload);
        } else {
          await dataSync.disableTwoFactor(payload);
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
      }

      setStatusBanner({
        kind: 'success',
        message: 'Security settings updated.',
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update security settings',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('SecuritySettings.pageTitle')}
      description={t('SecuritySettings.pageDescription')}
      footer={<SaveFooter onSave={handleSave} saving={saving} />}
    >
      {/* Change Password */}
      <section>
        <SectionTitle>{t('SecuritySettings.changePasswordTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
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
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
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
          <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-700">New 2FA setup</p>
            {twoFactorSecret ? (
              <p className="mt-1 break-all text-xs text-gray-500">Secret: {twoFactorSecret}</p>
            ) : null}
            {twoFactorUri ? (
              <p className="mt-1 break-all text-xs text-gray-400">URI: {twoFactorUri}</p>
            ) : null}
            <div className="mt-3">
              <label className="mb-2 block text-xs font-medium text-gray-700">
                Enter current authenticator code
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
          <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <label className="mb-2 block text-xs font-medium text-gray-700">
              Enter current authenticator code to disable 2FA
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

      {/* Login Alerts */}
      <section className="mt-8">
        <SectionTitle description={t('SecuritySettings.loginAlertsDescription')}>
          {t('SecuritySettings.loginAlertsTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<BellIcon className="h-5 w-5" />}
            title={t('SecuritySettings.emailAlertsLabel')}
            description={t('SecuritySettings.emailAlertsDescription')}
            checked={loginAlerts}
            onChange={setLoginAlerts}
          />
        </div>
      </section>

      {/* Active Sessions */}
      <section className="mt-8">
        <SectionTitle description={t('SecuritySettings.activeSessionsDescription')}>
          {t('SecuritySettings.activeSessionsTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
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
    </PageShell>
  );
}

// Password Field Component
function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  showPassword: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-900">{label}</label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        )}
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 ${
            icon ? 'pl-11' : 'px-4'
          }`}
        />
      </div>
    </div>
  );
}

// Setting Row Component
function SettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${checked ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'}`}>
            {icon}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// Toggle Switch Component
function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-mint-500' : 'bg-gray-200'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// Icons
function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function MonitorIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
