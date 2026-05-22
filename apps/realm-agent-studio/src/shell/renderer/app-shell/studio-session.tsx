import { createContext, useContext } from 'react';
import type { StudioAuthUser } from './studio-platform.js';

export type StudioAuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated' | 'error';

export type StudioSessionState = {
  status: StudioAuthStatus;
  user: StudioAuthUser | null;
  realmBaseUrl: string;
  error: string | null;
  refresh: () => Promise<void>;
};

export const StudioSessionContext = createContext<StudioSessionState | null>(null);

export function useStudioSession(): StudioSessionState {
  const value = useContext(StudioSessionContext);
  if (!value) {
    throw new Error('StudioSessionContext is not available');
  }
  return value;
}
