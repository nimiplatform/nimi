import { createDesktopCallbackRedirectUri as createSharedDesktopCallbackRedirectUri } from './oauth-helpers.js';

/**
 * Generates a fresh `http://127.0.0.1:<random-non-dynamic-port>/oauth/callback`
 * URI for the desktop loopback listener. Avoiding the OS dynamic-port range
 * prevents Windows networking reservations from invalidating the listener.
 * Used by `performDesktopWebAuth` to bind the
 * Tauri OAuth listener and to seed `BeginLogin.redirect_uri` so the realm
 * OAuth authority knows where to 302-redirect after issuing the code.
 *
 * This is the only desktop callback helper that survives the Wave C hard-cut.
 * The legacy web-relay helpers (`submitDesktopCallbackResult`,
 * `hasDesktopCallbackRequestInLocation`,
 * `resolveDesktopCallbackRequestFromLocation`,
 * `buildDesktopCallbackReturnUrl`, `buildDesktopWebAuthLaunchUrl`,
 * `createDesktopCallbackState`, `validateDesktopCallbackState`,
 * `normalizeWebAuthLaunchPath`, `resolveDesktopWebAuthLaunchBaseUrl`) were
 * deleted because the direct-to-loopback architecture (R-OAUTH-* /
 * K-ACCSVC-008) routes the user agent through the realm OAuth authorize
 * endpoint, never through a web relay carrying `desktop_callback` URL params.
 */
export function createDesktopCallbackRedirectUri(): string {
  return createSharedDesktopCallbackRedirectUri();
}
