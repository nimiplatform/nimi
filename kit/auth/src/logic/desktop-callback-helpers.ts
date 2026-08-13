import { createDesktopCallbackRedirectUri as createSharedDesktopCallbackRedirectUri } from './oauth-helpers.js';

/**
 * Generates a fresh `http://127.0.0.1:<random-non-dynamic-port>/oauth/callback`
 * URI for the desktop loopback listener. Avoiding the OS dynamic-port range
 * prevents Windows networking reservations from invalidating the listener.
 * Used by `performDesktopBrowserAuth` to bind the
 * Tauri OAuth listener and to seed `BeginLogin.redirect_uri` so the realm
 * OAuth authority knows where to 302-redirect after issuing the code.
 *
 * The direct-to-loopback contract routes the user agent through the Realm
 * OAuth authorize endpoint and never through a Web bearer relay.
 */
export function createDesktopCallbackRedirectUri(): string {
  return createSharedDesktopCallbackRedirectUri();
}
