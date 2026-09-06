import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PillTabs } from '@nimiplatform/kit/ui';
import { RUNTIME_PAGE_WIDTH_CLASS, RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell.js';
import { AIProfileAuthoringPage } from './runtime-config-page-profile-authoring.js';
import { ProfileLibraryPage } from './runtime-config-profile-library.js';
import { ProfileExportPanel } from './runtime-config-profile-export-panel.js';
import { ProfileImportWizard } from './runtime-config-profile-import-wizard.js';
import { ProfileRecommendationsPage } from './runtime-config-profile-recommendations.js';

type ProfileSection = 'recommended' | 'library' | 'generate' | 'manual';

type ProfileWizardRequest = {
  readonly nonce: number;
  readonly sourceText: string | null;
};

export function ProfileCatalogPage(props: { readonly onOpenLoadouts: (capabilityContract?: string) => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<ProfileSection>('recommended');
  const [wizardRequest, setWizardRequest] = useState<ProfileWizardRequest | null>(null);
  const [libraryRefreshNonce, setLibraryRefreshNonce] = useState(0);

  const openWizard = (sourceText: string | null) => {
    setWizardRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, sourceText }));
  };

  return (
    <>
      <div className={`mx-auto w-full ${RUNTIME_PAGE_WIDTH_CLASS} px-4 pb-4`}>
        <RuntimePageHeader
          title={t('runtimeConfig.sidebar.profiles')}
          actions={section === 'library' ? (
            <Button size="sm" tone="primary" onClick={() => openWizard(null)}>
              {t('runtimeConfig.profiles.importAction', { defaultValue: 'Import a profile' })}
            </Button>
          ) : undefined}
        />
        <div className="pt-3" data-testid="runtime-profiles-subnavigation">
          <PillTabs
            size="sm"
            ariaLabel={t('runtimeConfig.sidebar.profiles', { defaultValue: 'Profiles' })}
            value={section}
            onValueChange={(value) => setSection(value as ProfileSection)}
            items={[
              { value: 'recommended', label: t('runtimeConfig.profiles.recommendedTab', { defaultValue: 'Recommended' }) },
              { value: 'library', label: t('runtimeConfig.profiles.myProfilesTab', { defaultValue: 'My Profiles' }) },
              { value: 'generate', label: t('runtimeConfig.profiles.generateFromCurrentTab', { defaultValue: 'From current model setup' }) },
              { value: 'manual', label: t('runtimeConfig.profiles.authoringManualTab', { defaultValue: 'Author manually' }) },
            ]}
          />
        </div>
      </div>
      {section === 'recommended' ? (
        <ProfileRecommendationsPage onOpenLoadouts={props.onOpenLoadouts} />
      ) : section === 'generate' ? (
        <RuntimePageShell>
          <ProfileExportPanel />
        </RuntimePageShell>
      ) : section === 'manual' ? (
        <AIProfileAuthoringPage />
      ) : (
        <ProfileLibraryPage
          refreshNonce={libraryRefreshNonce}
          onApply={(sourceText) => openWizard(sourceText)}
        />
      )}
      {wizardRequest ? (
        <ProfileImportWizard
          key={wizardRequest.nonce}
          initialSourceText={wizardRequest.sourceText}
          onClose={() => setWizardRequest(null)}
          onCatalogChanged={() => setLibraryRefreshNonce((current) => current + 1)}
        />
      ) : null}
    </>
  );
}
