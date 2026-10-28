import { useTranslation } from 'react-i18next';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { ChevronRight } from 'lucide-react';
import type { PartnerDirectoryItem } from './partner-directory-model.js';
import { PartnerArtwork, usePartnerMediaVisibility, usePartnerSource } from './partner-media.js';

const P = 'runtimeConfig.partners';

export function PartnerDirectoryRow({ partner, accountId, scopeKey, enabled, selected, onSelect }: {
  partner: PartnerDirectoryItem; accountId: string; scopeKey: string; enabled: boolean;
  selected: boolean; onSelect(): void;
}) {
  const { t } = useTranslation();
  const { element, visible } = usePartnerMediaVisibility<HTMLButtonElement>(enabled);
  const source = usePartnerSource(partner, accountId, scopeKey, visible);
  const name = partner.displayName || t(`${P}.unnamed`);
  const active = partner.lifecycle === AgentLifecycleStatus.ACTIVE;
  const description = active ? source.data?.summary || source.data?.worldName
    : t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) });
  return <button ref={element} data-testid="partner-row" data-view-key={partner.localAgentRef}
    aria-current={selected ? 'true' : undefined} className="partner-directory-row" onClick={onSelect}>
    <span className="partner-directory-avatar"><PartnerArtwork source={source.data} avatarUrl={source.avatarUrl} name={name} variant="avatar" /></span>
    <span className="partner-directory-copy"><span className="partner-directory-name">{name}</span>
      {description ? <span className={`partner-directory-description${active ? '' : ' partner-directory-status'}`} title={description}>{description}</span> : null}
    </span>
    <ChevronRight className="partner-directory-chevron" size={14} aria-hidden="true" />
  </button>;
}
