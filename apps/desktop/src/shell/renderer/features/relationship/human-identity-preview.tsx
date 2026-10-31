import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';

/** A compact preview of identity already admitted to this surface. Full facts load on Profile. */
export function HumanIdentityPreview({ id, displayName, handle, avatarUrl, avatarMedia, disabled, onMessage, triggerTestId, openProfileTestId, avatarFallbackClassName }: {
  id: string; displayName: string | null; handle: string | null; avatarUrl: string | null;
  avatarMedia?: RealmModel<'MediaDeliveryDto'> | null; disabled?: boolean; onMessage?: () => void;
  triggerTestId?: string; openProfileTestId?: string; avatarFallbackClassName?: string;
}) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const [open, setOpen] = useState(false);
  const name = disabled ? t('Relationship.contacts.deletedUser') : displayName || handle || t('Common.unknown');
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} data-testid={triggerTestId} className="flex min-w-0 max-w-full items-center gap-3 rounded-lg text-left disabled:cursor-default" aria-label={t('Relationship.contacts.previewPerson', { name })}>
        <EntityAvatar name={name} imageUrl={disabled ? null : avatarUrl} media={disabled ? null : avatarMedia} kind="human" sizeClassName="h-10 w-10 shrink-0" fallbackClassName={avatarFallbackClassName} />
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{name}</span>
          {!disabled && handle ? <span className="block truncate text-xs text-[var(--nimi-text-secondary)]">@{handle.replace(/^@+/, '')}</span> : null}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="w-72 space-y-4 p-5">
      <div className="flex items-center gap-3"><EntityAvatar name={name} imageUrl={avatarUrl} media={avatarMedia} kind="human" sizeClassName="h-12 w-12 shrink-0" fallbackClassName={avatarFallbackClassName} />
        <div className="min-w-0"><p className="break-words font-semibold">{name}</p>{handle ? <p className="break-words text-sm text-[var(--nimi-text-secondary)]">@{handle.replace(/^@+/, '')}</p> : null}</div></div>
      <div className="flex gap-2">
        <Button size="sm" tone="secondary" data-testid={openProfileTestId} onClick={() => { setOpen(false); void navigation.push({ id: 'profile', profileId: id }); }}>{t('Relationship.contacts.fullProfile')}</Button>
        {onMessage ? <Button size="sm" tone="primary" onClick={() => { setOpen(false); onMessage(); }}>{t('Relationship.contacts.openChat')}</Button> : null}
      </div>
    </PopoverContent>
  </Popover>;
}
