import { useTranslation } from 'react-i18next';
import {
  PageShell,
  Section,
} from './settings-layout-components.js';
import { DeveloperModeToggle } from '../developer/developer-mode-toggle.js';

export function PerformancePage() {
  const { t } = useTranslation();

  return (
    <PageShell
      title={t('Performance.pageTitle')}
      description={t('Performance.pageDescription')}
    >
      <Section title={t('Performance.sectionDeveloper')}>
        {/* D-DEV-002: the discoverable Developer Mode toggle. This is the
            canonical in-app entry — Settings — for enabling / disabling
            Developer Mode and showing its current state. Developer Mode is
            never reachable only through launch params or env vars. */}
        <DeveloperModeToggle />
      </Section>
    </PageShell>
  );
}
