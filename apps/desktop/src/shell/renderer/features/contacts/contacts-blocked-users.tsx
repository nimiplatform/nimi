import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { i18n } from '@renderer/i18n';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { OverlayShell } from '@renderer/components/overlay.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import type { ContactRecord } from './contacts-model.js';

function getBlockedContactPalette(contact: ContactRecord) {
  return getSemanticAgentPalette({
    description: contact.bio,
    worldName: contact.worldName,
    tags: contact.tags,
  });
}

export function BlockedUsersList({
  contacts,
  currentContactId,
  onSelect,
  onUnblock,
}: {
  contacts: ContactRecord[];
  currentContactId: string | null;
  onSelect: (contact: ContactRecord) => void;
  onUnblock: (contact: ContactRecord) => void;
}) {
  if (contacts.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-gray-400">
        {i18n.t('Contacts.noBlockedContacts', { defaultValue: 'No blocked contacts' })}
      </div>
    );
  }

  return (
    <>
      {contacts.map((contact) => (
        <BlockedContactRow
          key={contact.id}
          contact={contact}
          isSelected={currentContactId === contact.id}
          onSelect={() => onSelect(contact)}
          onUnblock={() => onUnblock(contact)}
        />
      ))}
    </>
  );
}

function BlockedContactRow({
  contact,
  isSelected,
  onSelect,
  onUnblock,
}: {
  contact: ContactRecord;
  isSelected: boolean;
  onSelect: () => void;
  onUnblock: () => void;
}) {
  const palette = getBlockedContactPalette(contact);

  return (
    <Surface
      role="button"
      tabIndex={0}
      tone={isSelected ? 'panel' : 'card'}
      elevation="base"
      interactive
      active={isSelected}
      className="mx-1 flex w-auto items-center gap-3 rounded-lg px-3 py-2.5 text-left text-gray-700"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <EntityAvatar
        imageUrl={contact.avatarUrl}
        name={contact.displayName}
        kind={contact.isAgent ? 'agent' : 'human'}
        sizeClassName="h-10 w-10"
        radiusClassName={contact.isAgent ? 'rounded-lg' : undefined}
        innerRadiusClassName={contact.isAgent ? 'rounded-md' : undefined}
        textClassName="text-sm font-medium"
      />
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[15px] text-gray-900">{contact.displayName}</div>
        {contact.isAgent && contact.worldName ? (
          <div className="truncate text-xs" style={{ color: palette.accent }}>
            {contact.worldName}
          </div>
        ) : null}
      </div>
      <Button
        tone="primary"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onUnblock();
        }}
      >
        {i18n.t('Contacts.restore', { defaultValue: 'Restore' })}
      </Button>
    </Surface>
  );
}

export function BlockConfirmDialog({
  contact,
  onConfirm,
  onCancel,
}: {
  contact: ContactRecord;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onCancel}
      dataTestId={E2E_IDS.contactsBlockConfirmDialog}
      title={<h3 className="text-lg font-semibold text-gray-900">{i18n.t('Contacts.blockContact', { defaultValue: 'Block Contact' })}</h3>}
      footer={(
        <div className="flex justify-end gap-3">
          <Button tone="ghost" onClick={onCancel}>
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button tone="secondary" onClick={onConfirm} className="bg-gray-700 text-white hover:bg-gray-800 hover:text-white">
            {i18n.t('Contacts.block', { defaultValue: 'Block' })}
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-gray-500">
          {i18n.t('Contacts.blockConfirmMessagePrefix', { defaultValue: 'Are you sure you want to block' })}{' '}
          <span className="font-medium text-gray-700">{contact.displayName}</span>
          ? {i18n.t('Contacts.blockConfirmMessageSuffix', { defaultValue: 'They will be moved to Blocks.' })}
      </p>
    </OverlayShell>
  );
}

export function UnblockConfirmDialog({
  contact,
  onConfirm,
  onCancel,
}: {
  contact: ContactRecord;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onCancel}
      dataTestId={E2E_IDS.contactsUnblockConfirmDialog}
      title={<h3 className="text-lg font-semibold text-gray-900">{i18n.t('Contacts.restoreContact', { defaultValue: 'Restore Contact' })}</h3>}
      footer={(
        <div className="flex justify-end gap-3">
          <Button tone="ghost" onClick={onCancel}>
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button tone="primary" onClick={onConfirm}>
            {i18n.t('Contacts.restore', { defaultValue: 'Restore' })}
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-gray-500">
          {i18n.t('Contacts.restoreConfirmMessagePrefix', { defaultValue: 'Restore' })}{' '}
          <span className="font-medium text-gray-700">{contact.displayName}</span>{' '}
          {i18n.t('Contacts.restoreConfirmMessageSuffix', { defaultValue: 'to their previous category?' })}
      </p>
    </OverlayShell>
  );
}
