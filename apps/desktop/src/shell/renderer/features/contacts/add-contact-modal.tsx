import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ContactSearchCandidate } from './contacts-model';

type AddContactModalProps = {
  open: boolean;
  selfUserId: string | null;
  agentLimit: {
    used: number;
    limit: number;
    canAdd: boolean;
    reason: string | null;
  } | null;
  onClose: () => void;
  onSearch: (identifier: string) => Promise<ContactSearchCandidate>;
  onAdd: (candidate: ContactSearchCandidate, message?: string) => Promise<void>;
};

function toErrorMessage(
  error: unknown,
  fallback: string,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next === 'HANDLE_PREFIX_UNSUPPORTED') {
      return translate('AddContact.legacyPrefixUnsupported', {
        defaultValue: 'Use a handle or ID without @ or ~.',
      });
    }
    if (next) {
      return next;
    }
  }
  return fallback;
}

export function AddContactModal(props: AddContactModalProps) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<ContactSearchCandidate | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<ContactSearchCandidate | null>(null);
  const [message, setMessage] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      return;
    }
    setIdentifier('');
    setSearching(false);
    setAdding(false);
    setCandidate(null);
    setSelectedCandidate(null);
    setMessage('');
    setSearchError(null);
    setActionError(null);
  }, [props.open]);

  // Reset selection when new search is performed
  useEffect(() => {
    if (candidate) {
      setSelectedCandidate(null);
      setMessage('');
    }
  }, [candidate?.id]);

  const normalizedSelfUserId = String(props.selfUserId || '').trim();
  const isCurrentUser = useMemo(() => {
    if (!candidate || !normalizedSelfUserId) {
      return false;
    }
    return candidate.id === normalizedSelfUserId;
  }, [candidate, normalizedSelfUserId]);

  const canAddAgentByLimit = useMemo(() => {
    if (!candidate?.isAgent) {
      return true;
    }
    return props.agentLimit?.canAdd === true;
  }, [candidate?.isAgent, props.agentLimit?.canAdd]);

  const canAddContact = Boolean(
    selectedCandidate
      && !selectedCandidate.isFriend
      && !isCurrentUser
      && canAddAgentByLimit
      && !adding
      && !searching,
  );

  const isCandidateSelectable = Boolean(
    candidate
      && !candidate.isFriend
      && !isCurrentUser
      && canAddAgentByLimit,
  );

  const handleSearch = async () => {
    const nextIdentifier = identifier.trim();
    if (!nextIdentifier) {
      setSearchError(t('AddContact.inputRequired'));
      setCandidate(null);
      setSelectedCandidate(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setActionError(null);
    setSelectedCandidate(null);
    setMessage('');
    try {
      const nextCandidate = await props.onSearch(nextIdentifier);
      setCandidate(nextCandidate);
    } catch (error) {
      setCandidate(null);
      setSelectedCandidate(null);
      setSearchError(toErrorMessage(error, t('AddContact.searchFailed', { defaultValue: 'Failed to find this user.' }), t));
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCandidate = () => {
    if (!isCandidateSelectable || !candidate) {
      return;
    }
    setSelectedCandidate(candidate);
    setActionError(null);
  };

  const handleAddContact = async () => {
    if (!selectedCandidate || !canAddContact) {
      return;
    }
    setAdding(true);
    setActionError(null);
    try {
      await props.onAdd(selectedCandidate, message.trim() || undefined);
      props.onClose();
    } catch (error) {
      setActionError(toErrorMessage(error, t('AddContact.addFailed', { defaultValue: 'Failed to add this contact.' }), t));
    } finally {
      setAdding(false);
    }
  };

  if (!props.open) {
    return null;
  }

  const isSelected = selectedCandidate?.id === candidate?.id;
  const candidatePalette = getSemanticAgentPalette({
    description: candidate?.displayName,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={props.onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">
            {t('Contacts.addContactTitle', { defaultValue: 'Add Contact' })}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            disabled={adding || searching}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label={t('Contacts.closeAddContactModal', { defaultValue: 'Close add contact modal' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Search Input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleSearch();
                  }
                }}
                placeholder={t('Contacts.addContactSearchPlaceholder', {
                  defaultValue: 'Search by handle or ID',
                })}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-8 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-300 focus:ring-2 focus:ring-mint-100"
              />
              {identifier && (
                <button
                  type="button"
                  onClick={() => setIdentifier('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { void handleSearch(); }}
              disabled={searching || !identifier.trim()}
              className="h-11 rounded-xl bg-mint-500 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
              {searching ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="60" strokeDashoffset="20" />
                  </svg>
                  {t('Contacts.searching', { defaultValue: 'Searching' })}
                </span>
              ) : (
                t('Contacts.search', { defaultValue: 'Search' })
              )}
            </button>
          </div>
          {/* Agent Limit Info */}
          {candidate?.isAgent && props.agentLimit ? (
            <div className="rounded-xl bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v14a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M12 8v4" />
                  <path d="M12 16v.01" />
                </svg>
                <p className="text-sm text-gray-600">
                  {t('Contacts.agentCapacityLabel', { defaultValue: 'Agent Capacity:' })}{' '}
                  <span className="font-semibold text-gray-900">{props.agentLimit.used}</span> / {props.agentLimit.limit}
                </p>
              </div>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div 
                  className="h-full rounded-full bg-mint-500 transition-all duration-300"
                  style={{ width: `${Math.min((props.agentLimit.used / props.agentLimit.limit) * 100, 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* Search Error */}
          {searchError ? (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {searchError}
            </div>
          ) : null}

          {/* Search Result Card - Clickable */}
          {candidate ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleSelectCandidate}
                disabled={!isCandidateSelectable}
                className={`w-full rounded-2xl border bg-white p-5 text-left transition-all duration-200 ${
                  isSelected
                    ? 'border-mint-400 bg-mint-50/30 shadow-md ring-2 ring-mint-400'
                    : isCandidateSelectable
                      ? 'border-gray-200 shadow-sm hover:border-mint-300 hover:shadow-md hover:ring-1 hover:ring-mint-200'
                      : 'border-gray-200 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-4">
                <EntityAvatar
                  imageUrl={candidate.avatarUrl}
                  name={candidate.displayName}
                  kind={candidate.isAgent ? 'agent' : 'human'}
                  sizeClassName="h-14 w-14"
                  radiusClassName={candidate.isAgent ? 'rounded-[10px]' : undefined}
                  innerRadiusClassName={candidate.isAgent ? 'rounded-[8px]' : undefined}
                  textClassName="text-sm font-semibold"
                  className={!candidate.isAgent && isSelected ? 'ring-2 ring-mint-300' : undefined}
                  fallbackClassName={!candidate.isAgent ? (isSelected ? 'bg-mint-200 text-mint-800' : 'bg-mint-100 text-mint-700 ring-2 ring-gray-100') : undefined}
                />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-bold text-gray-900">{candidate.displayName}</p>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        candidate.isAgent 
                          ? ''
                          : 'bg-blue-50 text-blue-600'
                      }`}
                      style={candidate.isAgent ? { backgroundColor: candidatePalette.badgeBg, color: candidatePalette.badgeText } : undefined}>
                        {candidate.isAgent
                          ? t('Contacts.agent', { defaultValue: 'Agent' })
                          : t('Contacts.human', { defaultValue: 'Human' })}
                      </span>
                    </div>
                    {candidate.handle ? (
                      <p className="truncate text-xs text-gray-500">{candidate.handle}</p>
                    ) : null}
                  </div>
                  
                  {/* Selection Indicator */}
                  {isSelected && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-500 text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Status Messages */}
                {candidate.isFriend ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {t('Contacts.alreadyInContacts', { defaultValue: 'Already in your contacts.' })}
                  </div>
                ) : null}
                {isCurrentUser ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {t('Contacts.cannotAddSelf', { defaultValue: 'You cannot add yourself.' })}
                  </div>
                ) : null}
                {candidate.isAgent && !canAddAgentByLimit ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {props.agentLimit?.reason || t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' })}
                  </div>
                ) : null}
              </button>

              {/* Message Input - Only shown when selected */}
              {isSelected && (
                <div className="animate-fade-in">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('Contacts.addContactMessagePlaceholder', {
                      defaultValue: "Hi! I'd like to add you as a friend...",
                    })}
                    rows={3}
                    maxLength={200}
                    className="w-full resize-none rounded-2xl border-2 border-mint-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-mint-50/30"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <span className="text-xs text-gray-400">{message.length}/200</span>
                  </div>
                </div>
              )}

              {/* Action Error */}
              {actionError ? (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {actionError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-5">
          <button
            type="button"
            onClick={props.onClose}
            disabled={adding}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={() => { void handleAddContact(); }}
            disabled={!canAddContact}
            className="rounded-xl bg-mint-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
          >
            {adding ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="60" strokeDashoffset="20" />
                </svg>
                Sending...
              </span>
            ) : (
              'Add Contact'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
