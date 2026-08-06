import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiAppAIProfileClient,
  type NimiAppAIProfilePreview,
} from '@nimiplatform/sdk/ai';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { AIProfileAuthoringPage } from './runtime-config-page-profile-authoring.js';
import {
  summarizeDesktopPortableAIProfile,
  type DesktopPortableAIProfileSummary,
} from './runtime-config-portable-profile.js';

type ProfileFeedback = {
  readonly tone: 'info' | 'success' | 'danger';
  readonly message: string;
  readonly technicalDetail?: string;
};

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<'portable' | 'author'>('portable');
  return (
    <>
      <div className="px-6 pt-6" data-testid="runtime-profiles-subnavigation">
        <div className="inline-flex rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-1">
          <button
            type="button"
            aria-pressed={section === 'portable'}
            onClick={() => setSection('portable')}
            className={section === 'portable'
              ? 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-semibold text-[var(--nimi-action-primary-fg)]'
              : 'rounded-lg px-3 py-2 text-xs font-semibold text-[var(--nimi-text-secondary)]'}
          >
            {t('runtimeConfig.profiles.useProfileTab')}
          </button>
          <button
            type="button"
            aria-pressed={section === 'author'}
            onClick={() => setSection('author')}
            className={section === 'author'
              ? 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-semibold text-[var(--nimi-action-primary-fg)]'
              : 'rounded-lg px-3 py-2 text-xs font-semibold text-[var(--nimi-text-secondary)]'}
          >
            {t('runtimeConfig.profiles.authorProfileTab')}
          </button>
        </div>
      </div>
      {section === 'author' ? <AIProfileAuthoringPage /> : <PortableProfileApplyPage />}
    </>
  );
}

function PortableProfileApplyPage() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const profileClient = useMemo(
    () => createNimiAppAIProfileClient(sdk.accountProduct().aiConfig),
    [sdk],
  );
  const [sourceText, setSourceText] = useState('');
  const [summary, setSummary] = useState<DesktopPortableAIProfileSummary | null>(null);
  const [preview, setPreview] = useState<NimiAppAIProfilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [appliedCloudIntentCount, setAppliedCloudIntentCount] = useState(0);
  const [feedback, setFeedback] = useState<ProfileFeedback>({
    tone: 'info',
    message: 'Load a portable AIProfile, preview its App-owned intent, then confirm Apply explicitly.',
  });

  const clearPreview = (nextSource: string) => {
    setSourceText(nextSource);
    setSummary(null);
    setPreview(null);
    setAppliedCloudIntentCount(0);
  };

  const previewSource = async () => {
    setBusy(true);
    try {
      const nextSummary = summarizeDesktopPortableAIProfile(sourceText);
      const nextPreview = await profileClient.preview(sourceText);
      setSummary(nextSummary);
      setPreview(nextPreview);
      setFeedback({
        tone: 'info',
        message: nextPreview.identical
          ? 'Preview completed. This profile would not change the current App AIConfig.'
          : `Preview completed. Confirm Apply to replace App AIConfig with ${nextPreview.after.capabilities.length} capability intent(s).`,
      });
    } catch (error) {
      setSummary(null);
      setPreview(null);
      setFeedback({
        tone: 'danger',
        message: 'This portable AIProfile could not be previewed.',
        technicalDetail: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const applyPreviewedSource = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const config = await profileClient.apply(preview.source);
      setPreview(null);
      setAppliedCloudIntentCount(config.capabilities.filter(
        (capability) => capability.route.oneofKind === 'cloud',
      ).length);
      setFeedback({
        tone: 'success',
        message: `Applied ${summary?.title || 'the portable AIProfile'} to the Nimi Desktop App AIConfig (${config.capabilities.length} intent(s)).`,
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: 'The portable AIProfile could not be applied.',
        technicalDetail: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const previewCloudIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'cloud',
  ).length ?? 0;
  const cloudGuidanceCount = Math.max(previewCloudIntentCount, appliedCloudIntentCount);

  return (
    <RuntimePageShell maxWidth="full" className="max-w-[78rem] space-y-4 px-6 py-6">
      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-source">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.portableTitle', { defaultValue: 'Portable AIProfile' })}
          </h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
            Profile source remains separate from mutable App AIConfig. Desktop keeps no profile library or second AIConfig store; Preview is non-committing and Apply writes through Runtime.
          </p>
        </div>
        <textarea
          aria-label={t('runtimeConfig.profiles.portableJsonLabel', { defaultValue: 'Portable AIProfile JSON' })}
          value={sourceText}
          onChange={(event) => clearPreview(event.currentTarget.value)}
          rows={12}
          spellCheck={false}
          placeholder={t('runtimeConfig.profiles.portableJsonPlaceholder', {
            defaultValue: 'Paste a canonical portable AIProfile JSON document',
          })}
          className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
        />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[var(--nimi-border-subtle)] px-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
            Load JSON file…
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                void file.text().then(clearPreview, (error) => {
                  setFeedback({
                    tone: 'danger',
                    message: 'The selected AIProfile file could not be read.',
                    technicalDetail: errorMessage(error),
                  });
                });
              }}
            />
          </label>
          <Button
            size="sm"
            disabled={busy || !sourceText.trim()}
            onClick={() => { void previewSource(); }}
          >
            {busy ? 'Working…' : 'Preview for Nimi Desktop'}
          </Button>
          <Button
            size="sm"
            tone="primary"
            disabled={busy || !preview}
            onClick={() => { void applyPreviewedSource(); }}
          >
            Confirm Apply
          </Button>
        </div>
      </Surface>

      {summary ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-summary">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{summary.title}</div>
            <div className="mt-1 font-mono text-[11px] text-[var(--nimi-text-muted)]">{summary.profileId}</div>
          </div>
          <div className="grid gap-2">
            {summary.capabilities.map((capability) => (
              <div key={capability.capabilityContract} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs">
                <div className="font-semibold text-[var(--nimi-text-primary)]">{capability.capabilityContract}</div>
                <div className="mt-1 text-[var(--nimi-text-secondary)]">
                  {capability.route === 'local' ? 'Local intent' : 'Cloud intent'}
                  {capability.requiredFeatures.length > 0
                    ? ` · required features: ${capability.requiredFeatures.join(', ')}`
                    : ' · no required features'}
                  {capability.hasDefaults ? ' · portable defaults included' : ''}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {cloudGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-cloud-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.cloudAuthorizationTitle', {
              defaultValue: 'Cloud account authorization stays separate',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.cloudAuthorizationGuidance', {
              defaultValue: 'Portable AIProfiles never carry connector, account, or ConnectorGrant identity. After Apply, review each Cloud intent and explicitly select an active account authorization. Until then, Runtime reports an informational selection-required state.',
            })}
          </p>
          <div>
            <Button
              onClick={() => {
                setActiveTab('runtime');
                runtimeConfigNavigation.openPage('cloud');
              }}
              size="sm"
              tone="secondary"
            >
              {t('runtimeConfig.profiles.openAccountAuthorization', {
                defaultValue: 'Open account authorizations',
              })}
            </Button>
          </div>
        </Surface>
      ) : null}

      <InlineAlert tone={feedback.tone}>{feedback.message}</InlineAlert>
      {feedback.technicalDetail ? (
        <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer font-semibold">
            {t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">{feedback.technicalDetail}</pre>
        </details>
      ) : null}
    </RuntimePageShell>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown profile error');
}
