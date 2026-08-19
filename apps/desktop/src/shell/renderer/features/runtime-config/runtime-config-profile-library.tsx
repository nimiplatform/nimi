import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiDesktopPortableAIProfileCatalogRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { downloadRuntimeConfigProfileArtifact } from './runtime-config-profile-presentation.js';

type ProfileLibraryPageProps = {
  /** Bumped when the catalog changes so the list refetches. */
  readonly refreshNonce: number;
  /** Opens the import wizard on the given saved artifact. */
  readonly onApply: (sourceText: string) => void;
};

export function ProfileLibraryPage(props: ProfileLibraryPageProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const profileCatalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const [savedProfiles, setSavedProfiles] = useState<readonly NimiDesktopPortableAIProfileCatalogRecord[]>([]);

  useEffect(() => {
    let active = true;
    void profileCatalog.list().then((profiles) => {
      if (active) setSavedProfiles(profiles);
    }).catch(() => {
      // The library remains available for fresh imports if the catalog cannot be listed.
    });
    return () => { active = false; };
  }, [profileCatalog, props.refreshNonce]);

  const sortedProfiles = useMemo(
    () => [...savedProfiles].sort((left, right) => (
      profileRecordTimestamp(right) - profileRecordTimestamp(left)
    )),
    [savedProfiles],
  );

  return (
    <RuntimePageShell>
      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-catalog">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.profiles.savedProfilesTitle', { defaultValue: 'Saved AI setup files' })}</h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.savedProfilesDescription', { defaultValue: 'Opening a saved file only prepares a preview. Nothing is downloaded or changed until you confirm.' })}</p>
        </div>
        {sortedProfiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] p-4 text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-profile-library-empty">
            <div className="font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.libraryEmptyTitle', { defaultValue: 'No profiles yet' })}
            </div>
            <div className="mt-1">
              {t('runtimeConfig.profiles.libraryEmptyBody', { defaultValue: 'Import a profile file from someone else, or create one from your current model setup.' })}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {sortedProfiles.map((profile) => (
              <ProfileLibraryCard
                key={profile.source.profileId}
                profile={profile}
                onApply={() => props.onApply(profile.artifactJson)}
                onExport={() => downloadRuntimeConfigProfileArtifact(
                  profile.artifactJson,
                  `${profile.source.profileId}.ai-profile.json`,
                )}
              />
            ))}
          </div>
        )}
      </Surface>
    </RuntimePageShell>
  );
}

function ProfileLibraryCard(props: {
  readonly profile: NimiDesktopPortableAIProfileCatalogRecord;
  readonly onApply: () => void;
  readonly onExport: () => void;
}) {
  const { t } = useTranslation();
  const { profile } = props;
  const capabilityLabels = Object.keys(profile.source.capabilities)
    .sort()
    .map((contract) => displayRuntimeConfigCapabilityLabel(contract, t));
  const updatedAt = formatProfileRecordTimestamp(profile);

  return (
    <div className="rounded-xl border border-[var(--nimi-border-subtle)] p-4" data-testid="runtime-profile-library-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{profile.source.title}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {capabilityLabels.map((label) => (
              <span key={label} className="rounded-full border border-[var(--nimi-border-subtle)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                {label}
              </span>
            ))}
          </div>
          {updatedAt ? (
            <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.profiles.savedProfileUpdated', { defaultValue: 'Updated {{date}}', date: updatedAt })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-none gap-2">
          <Button size="sm" tone="primary" onClick={props.onApply}>
            {t('runtimeConfig.profiles.savedProfileApply', { defaultValue: 'Apply' })}
          </Button>
          <Button size="sm" tone="secondary" onClick={props.onExport}>
            {t('runtimeConfig.profiles.savedProfileExport', { defaultValue: 'Export' })}
          </Button>
        </div>
      </div>
      <details className="mt-2 text-xs text-[var(--nimi-text-muted)]">
        <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
        <div className="mt-1 font-mono break-all">{profile.source.profileId}</div>
      </details>
    </div>
  );
}

function profileRecordTimestamp(profile: NimiDesktopPortableAIProfileCatalogRecord): number {
  const seconds = profile.record.updatedAt?.seconds ?? profile.record.importedAt?.seconds;
  return seconds === undefined ? 0 : Number(seconds) * 1000;
}

function formatProfileRecordTimestamp(profile: NimiDesktopPortableAIProfileCatalogRecord): string | null {
  const millis = profileRecordTimestamp(profile);
  if (millis <= 0) return null;
  return new Date(millis).toLocaleDateString();
}
