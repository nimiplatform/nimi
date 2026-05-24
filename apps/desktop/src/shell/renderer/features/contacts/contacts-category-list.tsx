import React, { useMemo, type ReactNode } from 'react';
import {
  SidebarItem,
  SidebarSection,
} from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { i18n } from '@renderer/i18n';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ContactRecord, ContactRequestRecord, TabFilter } from './contacts-model.js';
import { BlockedUsersList } from './contacts-blocked-users.js';

// ---------- Filter chip taxonomy ----------

export type ContactsChipFilter = 'all' | 'humans' | 'agents';

type ChipDescriptor = {
  value: ContactsChipFilter;
  label: string;
  icon: ReactNode | null;
};

function getChipDescriptors(t: (key: string, opts?: { defaultValue: string }) => string): ChipDescriptor[] {
  return [
    { value: 'all', label: t('Contacts.chipAll', { defaultValue: 'All' }), icon: null },
    {
      value: 'humans',
      label: t('Contacts.chipHumans', { defaultValue: 'Humans' }),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
      ),
    },
    {
      value: 'agents',
      label: t('Contacts.chipAgents', { defaultValue: 'Agents' }),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="7" width="18" height="13" rx="3" />
          <path d="M9 7V4h6v3" />
          <circle cx="9" cy="13" r="1" />
          <circle cx="15" cy="13" r="1" />
        </svg>
      ),
    },
  ];
}

// ---------- Highlight matched text in search results ----------

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);

  while (index !== -1) {
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    parts.push(<span key={index} className="text-mint-600 font-medium">{text.slice(index, index + query.length)}</span>);
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

function getContactPalette(contact: ContactRecord) {
  return getSemanticAgentPalette({
    description: contact.bio,
    worldName: contact.worldName,
    tags: contact.tags,
  });
}

function describeRole(contact: ContactRecord, t: (key: string, opts?: { defaultValue: string }) => string): string {
  // D-CONTACTS-002: an owner-created befriended RealmAgent appears as an
  // ordinary AgentFriend with no product distinction — no "My Agent" sub-label.
  const kind = contact.isAgent
    ? t('Contacts.roleAgent', { defaultValue: 'Agent' })
    : t('Contacts.roleHuman', { defaultValue: 'Human' });
  const detail = contact.worldName || contact.handle || '';
  return detail ? `${kind} · ${detail}` : kind;
}

// ---------- Filter chip group ----------

export function ContactsFilterChips({
  value,
  onChange,
}: {
  value: ContactsChipFilter;
  onChange: (next: ContactsChipFilter) => void;
}) {
  const { t } = useTranslation();
  const chips = useMemo(() => getChipDescriptors(t), [t]);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 pb-2"
      role="radiogroup"
      aria-label={t('Contacts.filterChipsLabel', { defaultValue: 'Filter contacts' })}
    >
      {chips.map((chip) => {
        const selected = chip.value === value;
        return (
          <button
            key={chip.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(chip.value)}
            className={
              selected
                ? 'inline-flex items-center gap-1.5 rounded-[var(--nimi-radius-md)] border border-[color-mix(in_srgb,var(--nimi-status-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,white)] px-3 py-1.5 text-[13px] font-medium text-[var(--nimi-status-success)] transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]'
                : 'inline-flex items-center gap-1.5 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-[13px] font-medium text-[color:var(--nimi-text-secondary)] transition-colors hover:border-[color-mix(in_srgb,var(--nimi-text-muted)_40%,transparent)] hover:text-[color:var(--nimi-text-primary)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]'
            }
          >
            {chip.icon ? <span className="inline-flex shrink-0 items-center">{chip.icon}</span> : null}
            <span>{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Request notice (replaces requests accordion) ----------

export function ContactsRequestsBanner({
  count,
  onSelect,
}: {
  count: number;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <div className="px-2 pb-1">
      <SidebarItem
        kind="category-row"
        onClick={onSelect}
        className="mx-1"
        icon={(
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M19 8v6M16 11h6" />
            </svg>
          </span>
        )}
        label={t('Contacts.tabRequests', { defaultValue: 'Friend requests' })}
        description={t('Contacts.requestsHint', { defaultValue: 'Pending invitations to review' })}
        trailing={(
          <span className="inline-flex min-w-[20px] items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] px-1.5 text-[11px] font-medium text-[var(--nimi-status-success)]">
            {count}
          </span>
        )}
      />
    </div>
  );
}

// ---------- Empty state ----------

function ContactsEmptyState({ label }: { label: string }) {
  return (
    <div className="mx-3 my-2 rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] px-4 py-6 text-center text-sm text-[color:var(--nimi-text-muted)]">
      {label}
    </div>
  );
}

// ---------- Search results panel ----------

export function ContactsSearchResults({
  searchText,
  allFriends,
  isUserBlocked,
  selectedContactId,
  onSelectContact,
}: {
  searchText: string;
  allFriends: ContactRecord[];
  isUserBlocked: (id: string) => boolean;
  selectedContactId: string | null;
  onSelectContact: (contact: ContactRecord, categoryId: TabFilter) => void;
}) {
  const { t } = useTranslation();
  const query = searchText.trim().toLowerCase();
  const allContacts = allFriends.filter(c => !isUserBlocked(c.id));

  const directMatches = allContacts.filter(c =>
    c.displayName.toLowerCase().includes(query) || c.handle.toLowerCase().includes(query)
  );

  const humans = directMatches.filter(c => !c.isAgent);
  const agents = directMatches.filter(c => c.isAgent);

  const matchedWorldIds = new Set<string>();
  const matchedWorldNames = new Map<string, string>();
  directMatches.forEach(c => {
    if (c.worldId) {
      matchedWorldIds.add(c.worldId);
      if (c.worldName) matchedWorldNames.set(c.worldId, c.worldName);
    }
  });

  const directMatchIds = new Set(directMatches.map(c => c.id));
  const worldRelatedContacts = allContacts.filter(c =>
    c.worldId && matchedWorldIds.has(c.worldId) && !directMatchIds.has(c.id)
  );

  const worldGroups = new Map<string, ContactRecord[]>();
  worldRelatedContacts.forEach(c => {
    if (c.worldId) {
      if (!worldGroups.has(c.worldId)) {
        worldGroups.set(c.worldId, []);
      }
      worldGroups.get(c.worldId)!.push(c);
    }
  });

  const baseGroups: Array<{id: TabFilter; title: string; items: ContactRecord[]; worldId?: string}> = [
    { id: 'humans', title: t('Contacts.tabHumans'), items: humans },
    { id: 'agents', title: t('Contacts.tabAgents'), items: agents },
  ];
  const worldGroupList: Array<{id: TabFilter; title: string; items: ContactRecord[]; worldId?: string}> = worldGroups.size > 0
    ? Array.from(worldGroups.entries()).map(([worldId, items]) => ({
        id: 'world' as TabFilter,
        title: matchedWorldNames.get(worldId) || t('Common.world') || 'World',
        items,
        worldId,
      }))
    : [];
  const groups = [...baseGroups, ...worldGroupList].filter(g => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <ContactsEmptyState label={t('Contacts.noContactsFound', { defaultValue: 'No contacts found' })} />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <SidebarSection
          key={`${group.id}-${group.title}`}
          label={(
            <span className="inline-flex items-center gap-2">
              <span>{group.title}</span>
              <span className="text-[color:var(--nimi-text-muted)] normal-case tracking-normal">{group.items.length}</span>
            </span>
          )}
        >
          <div className="space-y-0.5">
            {group.items.map((contact) => (
              <ContactListItem
                key={contact.id}
                contact={contact}
                isSelected={selectedContactId === contact.id}
                secondaryText={group.id === 'world' ? contact.handle : undefined}
                query={query}
                onClick={() => onSelectContact(contact, group.id === 'world' ? (contact.isAgent ? 'agents' : 'humans') : group.id)}
              />
            ))}
          </div>
        </SidebarSection>
      ))}
    </div>
  );
}

// ---------- Main list (chip-driven flat layout) ----------

function categoryForContact(contact: ContactRecord): TabFilter {
  // D-CONTACTS-002: exactly two relationship categories — `humans` / `agents`.
  return contact.isAgent ? 'agents' : 'humans';
}

function sortContactsAlphabetically(contacts: ContactRecord[]): ContactRecord[] {
  return [...contacts].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function ContactsChipList({
  filter,
  allFriends,
  blockedContacts,
  currentContactId,
  onSelectContact,
  onUnblock,
}: {
  filter: ContactsChipFilter;
  allFriends: ContactRecord[];
  blockedContacts: ContactRecord[];
  currentContactId: string | null;
  onSelectContact: (contact: ContactRecord, categoryId: TabFilter) => void;
  onUnblock: (contact: ContactRecord) => void;
}) {
  const { t } = useTranslation();
  const blockedIds = useMemo(() => new Set(blockedContacts.map((c) => c.id)), [blockedContacts]);
  const candidates = useMemo(
    () => allFriends.filter((c) => !blockedIds.has(c.id)),
    [allFriends, blockedIds],
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case 'humans':
        return candidates.filter((c) => !c.isAgent);
      case 'agents':
        return candidates.filter((c) => c.isAgent);
      case 'all':
      default:
        return candidates;
    }
  }, [candidates, filter]);

  const sorted = useMemo(() => sortContactsAlphabetically(filtered), [filtered]);

  const renderRow = (contact: ContactRecord): ReactNode => (
    <ContactListItem
      key={contact.id}
      contact={contact}
      isSelected={currentContactId === contact.id}
      onClick={() => onSelectContact(contact, categoryForContact(contact))}
    />
  );

  const hasNothing = filtered.length === 0 && blockedContacts.length === 0;

  return (
    <div className="space-y-3">
      {sorted.length > 0 ? (
        <SidebarSection
          label={(
            <span className="normal-case tracking-normal text-[color:var(--nimi-text-muted)]">
              {t('Contacts.sectionAllContacts', { defaultValue: 'All Contacts' })}
            </span>
          )}
        >
          <div className="space-y-0.5">{sorted.map(renderRow)}</div>
        </SidebarSection>
      ) : null}

      {hasNothing ? (
        <ContactsEmptyState label={t('Contacts.noContacts', { defaultValue: 'No contacts' })} />
      ) : null}

      {blockedContacts.length > 0 ? (
        <SidebarSection
          label={(
            <span className="normal-case tracking-normal text-[color:var(--nimi-text-muted)]">
              {t('Contacts.tabBlocked', { defaultValue: 'Blocked' })}
            </span>
          )}
        >
          <BlockedUsersList
            contacts={blockedContacts}
            currentContactId={currentContactId}
            onSelect={(contact) => onSelectContact(contact, 'blocks')}
            onUnblock={onUnblock}
          />
        </SidebarSection>
      ) : null}
    </div>
  );
}

// ---------- Row presentation ----------

function ContactListItem({
  contact,
  isSelected,
  query,
  secondaryText,
  onClick,
}: {
  contact: ContactRecord;
  isSelected: boolean;
  query?: string;
  secondaryText?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const palette = getContactPalette(contact);
  const subText = secondaryText || describeRole(contact, t);
  const subStyle = contact.isAgent && !secondaryText ? { color: palette.accent } : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={
        isSelected
          ? 'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,white)] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]'
          : 'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-[var(--nimi-radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--nimi-sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]'
      }
    >
      <span className="inline-flex shrink-0">
        <EntityAvatar
          imageUrl={contact.avatarUrl}
          name={contact.displayName}
          kind={contact.isAgent ? 'agent' : 'human'}
          sizeClassName="h-11 w-11"
          radiusClassName={contact.isAgent ? 'rounded-[12px]' : undefined}
          innerRadiusClassName={contact.isAgent ? 'rounded-[10px]' : undefined}
          textClassName="text-sm font-medium"
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-[color:var(--nimi-text-primary)]">
            {query ? <HighlightText text={contact.displayName} query={query} /> : contact.displayName}
          </span>
          {contact.isAgent ? (
            <span
              className="inline-flex shrink-0 items-center rounded-[var(--nimi-radius-md)] border border-[color-mix(in_srgb,var(--nimi-text-muted)_25%,transparent)] bg-[color-mix(in_srgb,var(--nimi-text-muted)_8%,transparent)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[color:var(--nimi-text-secondary)]"
              aria-label={t('Contacts.aiBadge', { defaultValue: 'AI agent' })}
            >
              AI
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-[12px] text-[color:var(--nimi-text-muted)]" style={subStyle}>
          {subText}
        </span>
      </span>
    </button>
  );
}

// ---------- Friend requests inline list (used inside detail pane) ----------

export function ContactsRequestsInline({
  requests,
  acceptedRequests,
  rejectedRequests,
  onAcceptRequest,
  onRejectRequest,
}: {
  requests: ContactRequestRecord[];
  acceptedRequests: Set<string>;
  rejectedRequests: Set<string>;
  onAcceptRequest: (request: ContactRequestRecord) => void;
  onRejectRequest: (request: ContactRequestRecord) => void;
}) {
  const pending = requests.filter(
    (r) => r.direction === 'received' && !acceptedRequests.has(r.userId) && !rejectedRequests.has(r.userId),
  );
  if (pending.length === 0) return null;
  return (
    <div className="space-y-1 px-2 py-1">
      {pending.map((request) => (
        <div
          key={`${request.direction}:${request.userId}`}
          className="mx-1 flex items-center gap-3 rounded-[var(--nimi-radius-md)] px-3 py-2 text-[color:var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-sidebar-item-hover)]"
        >
          <EntityAvatar
            imageUrl={request.avatarUrl}
            name={request.displayName}
            kind={request.isAgent ? 'agent' : 'human'}
            sizeClassName="h-10 w-10"
            radiusClassName={request.isAgent ? 'rounded-[10px]' : undefined}
            innerRadiusClassName={request.isAgent ? 'rounded-[8px]' : undefined}
            textClassName="text-sm font-medium"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[color:var(--nimi-text-primary)]">{request.displayName}</div>
            <div className="truncate text-xs text-[color:var(--nimi-text-muted)]">
              {request.bio || i18n.t('Contacts.requestFallbackBio', { defaultValue: 'Wants to add you as a friend' })}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAcceptRequest(request);
              }}
              className="rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-status-success)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90"
            >
              {i18n.t('Contacts.accept', { defaultValue: 'Accept' })}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRejectRequest(request);
              }}
              className="rounded-[var(--nimi-radius-sm)] bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] px-2.5 py-1 text-xs font-medium text-[color:var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-muted)_24%,transparent)]"
            >
              {i18n.t('Contacts.reject', { defaultValue: 'Reject' })}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
