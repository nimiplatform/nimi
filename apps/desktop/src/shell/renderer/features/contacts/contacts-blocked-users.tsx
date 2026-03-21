import { i18n } from '@renderer/i18n';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
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
    <button
      type="button"
      onClick={onSelect}
      className={`mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 ${
        isSelected
          ? 'bg-mint-50 text-mint-700'
          : 'text-gray-700 hover:bg-mint-50/50'
      }`}
    >
      <EntityAvatar
        imageUrl={contact.avatarUrl}
        name={contact.displayName}
        kind={contact.isAgent ? 'agent' : 'human'}
        sizeClassName="h-10 w-10"
        radiusClassName={contact.isAgent ? 'rounded-[10px]' : undefined}
        innerRadiusClassName={contact.isAgent ? 'rounded-[8px]' : undefined}
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
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onUnblock();
        }}
        className="rounded-lg bg-[#4ECCA3] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3DBA92]"
      >
        {i18n.t('Contacts.restore', { defaultValue: 'Restore' })}
      </button>
    </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          {i18n.t('Contacts.blockContact', { defaultValue: 'Block Contact' })}
        </h3>
        <p className="mb-6 text-sm text-gray-500">
          {i18n.t('Contacts.blockConfirmMessagePrefix', { defaultValue: 'Are you sure you want to block' })}{' '}
          <span className="font-medium text-gray-700">{contact.displayName}</span>
          ? {i18n.t('Contacts.blockConfirmMessageSuffix', { defaultValue: 'They will be moved to Blocks.' })}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-gray-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            {i18n.t('Contacts.block', { defaultValue: 'Block' })}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          {i18n.t('Contacts.restoreContact', { defaultValue: 'Restore Contact' })}
        </h3>
        <p className="mb-6 text-sm text-gray-500">
          {i18n.t('Contacts.restoreConfirmMessagePrefix', { defaultValue: 'Restore' })}{' '}
          <span className="font-medium text-gray-700">{contact.displayName}</span>{' '}
          {i18n.t('Contacts.restoreConfirmMessageSuffix', { defaultValue: 'to their previous category?' })}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[#4ECCA3] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3DBA92]"
          >
            {i18n.t('Contacts.restore', { defaultValue: 'Restore' })}
          </button>
        </div>
      </div>
    </div>
  );
}
