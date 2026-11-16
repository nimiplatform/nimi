import { useTranslation } from 'react-i18next';
import { IconButton } from '@nimiplatform/kit/ui';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { ChevronRight, Globe, MessageCircle } from 'lucide-react';
import type { PartnerDirectoryItem } from './partner-directory-model.js';
import { PartnerArtwork, usePartnerMediaVisibility, usePartnerSource } from './partner-media.js';

const P = 'runtimeConfig.partners';

export function PartnerDirectoryRow({ partner, accountId, scopeKey, enabled, selected, unreadCount = 0, onSelect, onMessage }: {
  partner: PartnerDirectoryItem; accountId: string; scopeKey: string; enabled: boolean;
  selected: boolean; unreadCount?: number; onSelect(): void; onMessage?(): void;
}) {
  const { t } = useTranslation();
  const { element, visible } = usePartnerMediaVisibility<HTMLButtonElement>(enabled);
  const source = usePartnerSource(partner, accountId, scopeKey, visible);
  const name = partner.displayName || t(`${P}.unnamed`);
  const active = partner.lifecycle === AgentLifecycleStatus.ACTIVE;
  const worldName = active ? source.data?.worldName : undefined;
  const summary = active ? source.data?.summary : undefined;
  const statusText = !active
    ? t(`${P}.lifecycle.${partner.lifecycle}`, { defaultValue: t(`${P}.lifecycle.0`) })
    : undefined;
  return <div className="partner-directory-item" data-selected={selected ? 'true' : undefined}>
    <button type="button" ref={element} data-testid="partner-row" data-view-key={partner.localAgentRef}
      aria-current={selected ? 'true' : undefined} className="partner-directory-row" onClick={onSelect}>
      <span className="partner-directory-avatar">
        <PartnerArtwork source={source.data} avatarUrl={source.avatarUrl} name={name} variant="avatar" />
      </span>
      <span className="partner-directory-copy">
        <span className="partner-directory-title-line">
          <span className="partner-directory-name">{name}</span>
          {unreadCount > 0 ? <span className="partner-directory-unread">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
        </span>
        {worldName ? <span className="partner-directory-world" title={worldName}><Globe size={11} aria-hidden="true" /><span>{worldName}</span></span> : null}
        {summary ? <span className="partner-directory-description" title={summary}>{summary}</span> : null}
        {statusText ? <span className="partner-directory-description partner-directory-status" title={statusText}>{statusText}</span> : null}
      </span>
      {!onMessage || !active ? <ChevronRight className="partner-directory-chevron" size={14} aria-hidden="true" /> : null}
    </button>
    {onMessage && active ? <span className="partner-directory-quick-action">
      <IconButton size="sm" tone="ghost" icon={<MessageCircle size={15} />}
        aria-label={t('Chat.contactsOpenConversation')} title={t('Chat.contactsOpenConversation')}
        onClick={onMessage} />
    </span> : null}
  </div>;
}
