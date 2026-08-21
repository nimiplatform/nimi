import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  Button,
  Card,
  PageShell,
  Section,
} from './settings-layout-components.js';
import { ShieldIcon } from './settings-assets.js';

function FileTextIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function ArrowRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function LegalDocumentCard({
  description,
  icon,
  onOpen,
  title,
}: {
  description: string;
  icon: ReactNode;
  onOpen: () => void;
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{title}</p>
          <p className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">{description}</p>
        </div>
      </div>
      <Button
        variant="secondary"
        onClick={onOpen}
        icon={<ArrowRightIcon className="h-4 w-4" />}
        className="shrink-0"
      >
        {t('Settings.aboutLegalOpenDocument')}
      </Button>
    </Card>
  );
}

export function AboutLegalPage() {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  return (
    <PageShell
      title={t('Settings.aboutLegalTitle')}
      description={t('Settings.aboutLegalDescription')}
    >
      <Section title={t('Settings.sectionAboutLegal')}>
        <div className="grid gap-3">
          <LegalDocumentCard
            title={t('Legal.terms.title')}
            description={t('Settings.aboutLegalTermsDescription')}
            icon={<FileTextIcon className="h-5 w-5" />}
            onOpen={() => setActiveTab('terms-of-service')}
          />
          <LegalDocumentCard
            title={t('Legal.privacy.title')}
            description={t('Settings.aboutLegalPrivacyDescription')}
            icon={<ShieldIcon className="h-5 w-5" />}
            onOpen={() => setActiveTab('privacy-policy')}
          />
        </div>
      </Section>
    </PageShell>
  );
}
