import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiAppAIProfileClient,
  type NimiAppAIProfilePreview,
} from '@nimiplatform/sdk/ai';
import { Button, InlineAlert, PillTabs, Surface } from '@nimiplatform/kit/ui';
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
        <PillTabs
          size="sm"
          ariaLabel={t('runtimeConfig.sidebar.profiles', { defaultValue: 'Profiles' })}
          value={section}
          onValueChange={(value) => setSection(value as 'portable' | 'author')}
          items={[
            { value: 'portable', label: t('runtimeConfig.profiles.useProfileTab') },
            { value: 'author', label: t('runtimeConfig.profiles.authorProfileTab') },
          ]}
        />
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
    () => createNimiAppAIProfileClient(sdk.accountProduct().appAIConfig(sdk.appId())),
    [sdk],
  );
  const [sourceText, setSourceText] = useState('');
  const [summary, setSummary] = useState<DesktopPortableAIProfileSummary | null>(null);
  const [preview, setPreview] = useState<NimiAppAIProfilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [appliedCloudIntentCount, setAppliedCloudIntentCount] = useState(0);
  const [appliedLocalIntentCount, setAppliedLocalIntentCount] = useState(0);
  const [feedback, setFeedback] = useState<ProfileFeedback>({
    tone: 'info',
    message: t('runtimeConfig.profiles.feedbackInitial', {
      defaultValue: 'Load a portable AIProfile, preview its App-owned intent, then confirm Apply explicitly.',
    }),
  });

  const clearPreview = (nextSource: string) => {
    setSourceText(nextSource);
    setSummary(null);
    setPreview(null);
    setAppliedCloudIntentCount(0);
    setAppliedLocalIntentCount(0);
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
          ? t('runtimeConfig.profiles.feedbackPreviewUnchanged', {
            defaultValue: 'Preview completed. This profile would not change the current App AIConfig.',
          })
          : t('runtimeConfig.profiles.feedbackPreviewReady', {
            defaultValue: 'Preview completed. Confirm Apply to replace App AIConfig with {{count}} capability intent(s).',
            count: nextPreview.after.capabilities.length,
          }),
      });
    } catch (error) {
      setSummary(null);
      setPreview(null);
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.feedbackPreviewFailed', {
          defaultValue: 'This portable AIProfile could not be previewed.',
        }),
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
      setAppliedLocalIntentCount(config.capabilities.filter(
        (capability) => capability.route.oneofKind === 'local',
      ).length);
      setFeedback({
        tone: 'success',
        message: t('runtimeConfig.profiles.feedbackApplySuccess', {
          defaultValue: 'Applied {{title}} to the Nimi Desktop App AIConfig ({{count}} intent(s)).',
          title: summary?.title || t('runtimeConfig.profiles.portableFallbackTitle', {
            defaultValue: 'the portable AIProfile',
          }),
          count: config.capabilities.length,
        }),
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.feedbackApplyFailed', {
          defaultValue: 'The portable AIProfile could not be applied.',
        }),
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
  const previewLocalIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'local',
  ).length ?? 0;
  const localGuidanceCount = Math.max(previewLocalIntentCount, appliedLocalIntentCount);

  return (
    <RuntimePageShell maxWidth="full" className="max-w-[78rem] space-y-4 px-6 py-6">
      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-source">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.portableTitle', { defaultValue: 'Portable AIProfile' })}
          </h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.portableDescription', {
              defaultValue: 'Profile source remains separate from mutable App AIConfig. Desktop keeps no profile library or second AIConfig store; Preview is non-committing and Apply writes through Runtime.',
            })}
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
            {t('runtimeConfig.profiles.loadJsonFile', { defaultValue: 'Load JSON file…' })}
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
                    message: t('runtimeConfig.profiles.feedbackFileReadFailed', {
                      defaultValue: 'The selected AIProfile file could not be read.',
                    }),
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
            {busy
              ? t('runtimeConfig.profiles.previewWorking', { defaultValue: 'Working…' })
              : t('runtimeConfig.profiles.previewAction', { defaultValue: 'Preview for Nimi Desktop' })}
          </Button>
          <Button
            size="sm"
            tone="primary"
            disabled={busy || !preview}
            onClick={() => { void applyPreviewedSource(); }}
          >
            {t('runtimeConfig.profiles.confirmApply', { defaultValue: 'Confirm Apply' })}
          </Button>
        </div>
      </Surface>

      {summary ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-summary">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{summary.title}</div>
            <div className="mt-1 font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{summary.profileId}</div>
          </div>
          <div className="grid gap-2">
            {summary.capabilities.map((capability) => (
              <div key={capability.capabilityContract} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs">
                <div className="font-semibold text-[var(--nimi-text-primary)]">{capability.capabilityContract}</div>
                <div className="mt-1 text-[var(--nimi-text-secondary)]">
                  {capability.route === 'local'
                    ? t('runtimeConfig.profiles.intentLocal', { defaultValue: 'Local intent' })
                    : t('runtimeConfig.profiles.intentCloud', { defaultValue: 'Cloud intent' })}
                  {capability.requiredFeatures.length > 0
                    ? ` · ${t('runtimeConfig.profiles.summaryRequiredFeatures', {
                      defaultValue: 'required features: {{features}}',
                      features: capability.requiredFeatures.join(', '),
                    })}`
                    : ` · ${t('runtimeConfig.profiles.summaryNoRequiredFeatures', { defaultValue: 'no required features' })}`}
                  {capability.hasDefaults
                    ? ` · ${t('runtimeConfig.profiles.summaryPortableDefaults', { defaultValue: 'portable defaults included' })}`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {cloudGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-cloud-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.cloudConfigurationTitle', {
              defaultValue: 'Cloud execution stays Nimi-owned',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.cloudConfigurationGuidance', {
              defaultValue: 'Portable AIProfiles carry an exact implementation and provider-model catalog target, but never Connector, account, credential, or secret identity. Confirm Apply to write that target choice into the Nimi Desktop AIConfig. Runtime resolves only the current-account Connector bound by that exact catalog identity.',
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
              {t('runtimeConfig.profiles.openCloudConnectors', {
                defaultValue: 'Review Cloud Connectors',
              })}
            </Button>
          </div>
        </Surface>
      ) : null}

      {localGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-local-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.localSelectionTitle', {
              defaultValue: 'Local capability selection stays on this machine',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.localSelectionGuidance', {
              defaultValue: 'Local capability intent is written to the App AIConfig. Machine-side Local Capability Configuration resolution and selection are managed on the Local AI Configurations page. Until a selection is made, Runtime reports an informational selection-required state; this is not an error.',
            })}
          </p>
          <div>
            <Button
              onClick={() => {
                setActiveTab('runtime');
                runtimeConfigNavigation.focusAction({
                  page: 'localAiConfig',
                  action: 'open-configurations',
                  focus: 'runtime-config-action-focus.models-configurations',
                });
              }}
              size="sm"
              tone="secondary"
            >
              {t('runtimeConfig.profiles.openLocalConfigurations', {
                defaultValue: 'Open Local AI Configurations',
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
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{feedback.technicalDetail}</pre>
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
