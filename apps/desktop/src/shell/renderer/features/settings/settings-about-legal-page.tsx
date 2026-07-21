import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  Button,
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';

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

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
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
    <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
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
    </div>
  );
}

export function AboutLegalPage() {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  return (
    <PageShell
      title={t('Settings.aboutLegalTitle')}
      description={t('Settings.aboutLegalDescription')}
      contentClassName="max-w-3xl"
    >
      <section>
        <SectionTitle>
          {t('Settings.sectionAboutLegal')}
        </SectionTitle>
        <div className="mt-3 grid gap-3">
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
      </section>
    </PageShell>
  );
}
