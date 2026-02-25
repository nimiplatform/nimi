import type { StoreState } from '../store-types';

const BLOCKED_CONTACTS_STORAGE_KEY = 'nimi.contacts.blocked';

export function loadBlockedContactsFromStorage(): Array<Record<string, unknown>> {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(BLOCKED_CONTACTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore parsing errors
  }
  return [];
}

export function persistBlockedContactsToStorage(blocked: Array<Record<string, unknown>>): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(BLOCKED_CONTACTS_STORAGE_KEY, JSON.stringify(blocked));
  } catch {
    // ignore storage errors
  }
}

export function createInitialStoreState(): StoreState {
  return {
    auth: {
      isAuthenticated: false,
      user: null,
      token: null,
    },
    session: {
      currentSession: null,
      currentAgent: null,
      route: null,
    },
    chats: {
      items: [],
      cursor: null,
      hasMore: false,
      isLoading: false,
    },
    contacts: {
      friends: [],
      agents: [],
      groups: [],
      pendingReceived: [],
      pendingSent: [],
      blocked: loadBlockedContactsFromStorage(),
      isLoading: false,
    },
    messages: new Map(),
    explore: {
      items: [],
      cursor: null,
      hasMore: false,
      isLoading: false,
      currentTag: null,
    },
    settings: {
      apiUrl: '',
      userSettings: null,
    },
    ui: {
      currentPage: 'chat',
      sidebarCollapsed: false,
      devPanelOpen: false,
    },
  };
}
