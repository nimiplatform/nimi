import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from './settings-layout-components.js';
import { DeveloperModeToggle } from '../developer/developer-mode-toggle.js';
import { LocalDevelopmentRegistrations } from '../local-development/local-development-registrations.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r084

export function DeveloperPage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => bindings.app.projection.developerModeEnabled(),
  );

  return (
    <PageShell
      title={t('Developer.pageTitle')}
      description={t('Developer.pageDescription')}
    >
      <DeveloperModeToggle onEnabledChange={setDeveloperModeEnabled} />
      {developerModeEnabled ? <LocalDevelopmentRegistrations /> : null}
    </PageShell>
  );
}
