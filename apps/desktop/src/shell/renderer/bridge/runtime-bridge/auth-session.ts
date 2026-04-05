import {
  parseSharedDesktopAuthSession,
  type SharedDesktopAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { invokeChecked } from './invoke';

function parseOptionalSharedDesktopAuthSession(value: unknown): SharedDesktopAuthSession | null {
  if (value == null) {
    return null;
  }
  return parseSharedDesktopAuthSession(value);
}

export async function loadAuthSession(): Promise<SharedDesktopAuthSession | null> {
  return invokeChecked('auth_session_load', {}, parseOptionalSharedDesktopAuthSession);
}

export async function saveAuthSession(session: SharedDesktopAuthSession): Promise<void> {
  await invokeChecked('auth_session_save', { payload: session }, () => undefined);
}

export async function clearAuthSession(): Promise<void> {
  await invokeChecked('auth_session_clear', {}, () => undefined);
}
