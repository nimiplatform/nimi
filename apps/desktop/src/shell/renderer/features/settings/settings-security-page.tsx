import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  prepareNimiRealmTwoFactor,
  updateNimiRealmPassword,
} from '@nimiplatform/sdk/realm';
import { FieldShell, InlineAlert, NimiText, TextField } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  Button,
  Card,
  FormFeedback,
  PageShell,
  SaveFooter,
  Section,
  StatusBadge,
  ToggleRow,
} from './settings-layout-components.js';
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MonitorIcon,
  ShieldIcon,
} from './settings-security-controls.js';

export function SecurityPage() {
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  // Server-confirmed 2FA state, sourced from the auth session store. The
  // "enabled" confirmation may only render from this value.
  const serverTwoFactorEnabled = authUser?.isTwoFactorEnabled === true;
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Pending user intent; only becomes server-confirmed after a successful save.
  const [twoFactorIntent, setTwoFactorIntent] = useState(serverTwoFactorEnabled);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [twoFactorUri, setTwoFactorUri] = useState('');
  const [revealTwoFactorSecret, setRevealTwoFactorSecret] = useState(false);
  const [preparingTwoFactor, setPreparingTwoFactor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const passwordsMatch = newPw === confirmPw;
  const twoFactorDirty = twoFactorIntent !== serverTwoFactorEnabled;
  const isDirty = newPw.trim().length > 0 || twoFactorDirty;

  useEffect(() => {
    setTwoFactorIntent(serverTwoFactorEnabled);
  }, [serverTwoFactorEnabled]);

  useEffect(() => {
    if (!twoFactorIntent) {
      setRevealTwoFactorSecret(false);
    }
  }, [twoFactorIntent]);

  useEffect(() => {
    if (!twoFactorIntent || serverTwoFactorEnabled || twoFactorSecret || preparingTwoFactor) {
      return;
    }
    setPreparingTwoFactor(true);
    void prepareNimiRealmTwoFactor(bindings.sdk.realm())
      .then((payload) => {
        setTwoFactorSecret(String(payload.secret || ''));
        setTwoFactorUri(String(payload.otpauthUri || ''));
      })
      .catch((error) => {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : t('SecuritySettings.prepareTwoFactorFailed'),
        });
        setTwoFactorIntent(serverTwoFactorEnabled);
      })
      .finally(() => {
        setPreparingTwoFactor(false);
      });
  }, [
    serverTwoFactorEnabled,
    bindings.sdk,
    preparingTwoFactor,
    t,
    twoFactorIntent,
    twoFactorSecret,
  ]);

  const refreshCurrentUser = async () => {
    const latest = await realmSocialData.loadCurrentUser();
    const normalized = parseOptionalJsonObject(latest) ?? null;
    setAuthSession(normalized);
  };

  const copyTwoFactorValue = async (value: string, successKey: string, successDefaultValue: string) => {
    if (!value.trim()) {
      return;
    }
    try {
      await bindings.app.commands.writeClipboardText(value);
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
    if (saving || !isDirty) {
      return;
    }
    if (newPw && !passwordsMatch) {
      setFeedback({
        kind: 'error',
        message: t('SecuritySettings.passwordMismatch'),
      });
      return;
    }
    if (twoFactorDirty && twoFactorCode.trim().length !== 6) {
      setFeedback({
        kind: 'error',
        message: t('SecuritySettings.twoFactorCodeRequired'),
      });
      return;
    }
    setSaving(true);
    try {
      if (newPw.trim()) {
        await updateNimiRealmPassword(bindings.sdk.realm(), {
          oldPassword: currentPw.trim() || undefined,
          newPassword: newPw.trim(),
        });
      }

      if (twoFactorDirty) {
        const payload = {
          code: twoFactorCode.trim(),
        };
        if (twoFactorIntent) {
          await enableNimiRealmTwoFactor(bindings.sdk.realm(), payload);
        } else {
          await disableNimiRealmTwoFactor(bindings.sdk.realm(), payload);
        }
      }

      // Refetch the current user so the store (and thus the server-confirmed
      // 2FA state) reflects the save; the sync effect then promotes intent.
      await refreshCurrentUser();

      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTwoFactorCode('');
      if (!twoFactorIntent) {
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
  const showPasswordMismatch = Boolean(newPw && confirmPw && !passwordsMatch);

  return (
    <PageShell
      title={t('SecuritySettings.pageTitle')}
      description={t('SecuritySettings.pageDescription')}
      footer={(
        <SaveFooter
          onSave={() => {
            void handleSave();
          }}
          saving={saving}
          disabled={!isDirty}
          showCancel={false}
        />
      )}
    >
      {feedback ? (
        <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
      ) : null}

      <Section title={t('SecuritySettings.changePasswordTitle')}>
        <Card>
          <div className="flex flex-col gap-4">
            <FieldShell label={t('SecuritySettings.currentPasswordLabel')}>
              <TextField
                type={showPassword ? 'text' : 'password'}
                value={currentPw}
                onChange={(event) => setCurrentPw(event.target.value)}
                placeholder={t('SecuritySettings.currentPasswordPlaceholder')}
                leading={<LockIcon className="h-4 w-4" />}
                autoComplete="current-password"
              />
            </FieldShell>
            <FieldShell label={t('SecuritySettings.newPasswordLabel')}>
              <TextField
                type={showPassword ? 'text' : 'password'}
                value={newPw}
                onChange={(event) => setNewPw(event.target.value)}
                placeholder={t('SecuritySettings.newPasswordPlaceholder')}
                autoComplete="new-password"
              />
            </FieldShell>
            <FieldShell
              label={t('SecuritySettings.confirmPasswordLabel')}
              message={showPasswordMismatch ? t('SecuritySettings.passwordMismatch') : undefined}
              messageTone="danger"
            >
              <TextField
                type={showPassword ? 'text' : 'password'}
                value={confirmPw}
                onChange={(event) => setConfirmPw(event.target.value)}
                placeholder={t('SecuritySettings.confirmPasswordPlaceholder')}
                tone={showPasswordMismatch ? 'danger' : 'default'}
                autoComplete="new-password"
              />
            </FieldShell>
          </div>
          <div className="mt-4">
            <Button
              variant="ghost"
              size="sm"
              icon={showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? t('SecuritySettings.hidePasswords') : t('SecuritySettings.showPasswords')}
            </Button>
          </div>
        </Card>
      </Section>

      <Section
        title={t('SecuritySettings.twoFactorTitle')}
        description={t('SecuritySettings.twoFactorDescription')}
      >
        <Card>
          <ToggleRow
            icon={<ShieldIcon className="h-5 w-5" />}
            title={t('SecuritySettings.enable2faLabel')}
            description={t('SecuritySettings.enable2faDescription')}
            checked={twoFactorIntent}
            onChange={setTwoFactorIntent}
            disabled={preparingTwoFactor || saving}
          />
        </Card>
        {serverTwoFactorEnabled ? (
          <InlineAlert tone="success" icon={<CheckIcon className="h-4 w-4" />}>
            {t('SecuritySettings.twoFactorEnabled')}
          </InlineAlert>
        ) : null}
        {twoFactorDirty ? (
          <InlineAlert tone="info">
            {t('SecuritySettings.twoFactorPendingSave')}
          </InlineAlert>
        ) : null}
        {twoFactorIntent && !serverTwoFactorEnabled ? (
          <Card>
            <NimiText role="label">{t('SecuritySettings.newTwoFactorSetup')}</NimiText>
            {twoFactorSecret || twoFactorUri ? (
              <div className="mt-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                {twoFactorSecret ? (
                  <div className="flex flex-col gap-1">
                    <NimiText role="caption" className="uppercase tracking-wide">
                      {t('SecuritySettings.secretLabel', { defaultValue: 'Secret' })}
                    </NimiText>
                    <p className="break-all font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-primary)]">
                      {maskedTwoFactorSecret}
                    </p>
                  </div>
                ) : null}
                {twoFactorUri ? (
                  <div className="mt-3 flex flex-col gap-1">
                    <NimiText role="caption" className="uppercase tracking-wide">
                      {t('SecuritySettings.uriLabel', { defaultValue: 'URI' })}
                    </NimiText>
                    <p className="break-all font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                      {maskedTwoFactorUri}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setRevealTwoFactorSecret((current) => !current)}
                  >
                    {revealTwoFactorSecret
                      ? t('SecuritySettings.hideSecret', { defaultValue: 'Hide secret' })
                      : t('SecuritySettings.revealSecret', { defaultValue: 'Reveal secret' })}
                  </Button>
                  {twoFactorSecret ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void copyTwoFactorValue(
                          twoFactorSecret,
                          'SecuritySettings.copySecretSuccess',
                          'Secret copied',
                        );
                      }}
                    >
                      {t('SecuritySettings.copySecret', { defaultValue: 'Copy secret' })}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="mt-3">
              <FieldShell label={t('SecuritySettings.authenticatorCodeLabel')}>
                <TextField
                  type="text"
                  value={twoFactorCode}
                  onChange={(event) => {
                    setTwoFactorCode(event.target.value.replace(/\D+/g, '').slice(0, 6));
                  }}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </FieldShell>
            </div>
          </Card>
        ) : null}
        {!twoFactorIntent && serverTwoFactorEnabled ? (
          <Card>
            <FieldShell label={t('SecuritySettings.disableTwoFactorCodeLabel')}>
              <TextField
                type="text"
                value={twoFactorCode}
                onChange={(event) => {
                  setTwoFactorCode(event.target.value.replace(/\D+/g, '').slice(0, 6));
                }}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </FieldShell>
          </Card>
        ) : null}
      </Section>

      <Section
        title={t('SecuritySettings.activeSessionsTitle')}
        description={t('SecuritySettings.activeSessionsDescription')}
      >
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]">
                <MonitorIcon className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <NimiText role="label" className="text-[var(--nimi-text-primary)]">
                  {t('SecuritySettings.thisDevice')}
                </NimiText>
                <NimiText role="caption">
                  {t('SecuritySettings.thisDeviceLastActive')}
                </NimiText>
              </div>
            </div>
            <StatusBadge status="success" text={t('SecuritySettings.currentSession')} />
          </div>
        </Card>
      </Section>
    </PageShell>
  );
}
