import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BackLink,
  PageDetailLayout,
  type PageDetailLayoutWidth,
} from '@nimiplatform/nimi-kit/ui';

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
  const label = backLabel ?? t('Profile.rich.common.backToProfile');
  return (
    <PageDetailLayout
      width={width}
      title={title}
      back={
        <BackLink asChild>
          <Link to={backTo}>{label}</Link>
        </BackLink>
      }
      actions={actions}
      subnav={subnav}
      beforeContent={aiSummary}
      className={className}
    >
      {children}
    </PageDetailLayout>
  );
}
