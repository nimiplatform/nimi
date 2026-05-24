import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BackLink,
  IconButton,
  PageDetailLayout,
  type PageDetailLayoutWidth,
} from '@nimiplatform/kit/ui';

export type ProfileDetailShellProps = {
  title: ReactNode;
  width?: PageDetailLayoutWidth;
  actions?: ReactNode;
  subnav?: ReactNode;
  aiSummary?: ReactNode;
  backTo?: string;
  backLabel?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ProfileDetailShell({
  title,
  width = 'lg',
  actions,
  subnav,
  aiSummary,
  backTo = '/profile',
  backLabel,
  children,
  className,
}: ProfileDetailShellProps) {
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const label = backLabel ?? t('Profile.rich.common.backToProfile');
  const aiLabel = aiOpen
    ? t('Profile.rich.common.collapseAnalysis')
    : t('Profile.rich.common.aiAnalysis');
  const composedActions = aiSummary ? (
    <>
      <IconButton
        onClick={() => setAiOpen((open) => !open)}
        tone={aiOpen ? 'secondary' : 'primary'}
        size="sm"
        className="min-h-0 rounded-full"
        aria-label={aiLabel}
        title={aiLabel}
        icon={(
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10z" />
          </svg>
        )}
      />
      {actions}
    </>
  ) : actions;
  return (
    <PageDetailLayout
      width={width}
      title={title}
      back={
        <BackLink asChild>
          <Link to={backTo}>{label}</Link>
        </BackLink>
      }
      actions={composedActions}
      subnav={subnav}
      beforeContent={aiSummary && aiOpen ? aiSummary : undefined}
      className={className}
    >
      {children}
    </PageDetailLayout>
  );
}
