import { createContext, useContext, type PropsWithChildren } from 'react';

import type { AccountProfileLibraryResource } from './runtime-config-profile-library.js';

const AccountProfileLibraryContext = createContext<AccountProfileLibraryResource | null>(null);

export function AccountProfileLibraryProvider({
  children,
  resource,
}: PropsWithChildren<{ readonly resource: AccountProfileLibraryResource }>) {
  return (
    <AccountProfileLibraryContext.Provider value={resource}>
      {children}
    </AccountProfileLibraryContext.Provider>
  );
}

export function useAccountProfileLibrary(): AccountProfileLibraryResource {
  const resource = useContext(AccountProfileLibraryContext);
  if (!resource) {
    throw new Error('DESKTOP_ACCOUNT_PROFILE_LIBRARY_CONTEXT_MISSING');
  }
  return resource;
}
