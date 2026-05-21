/**
 * Superseded orphan surface (`D-DEV-003`).
 *
 * The previously orphaned `DeveloperPage` (mod / developer source directory
 * management, auto-reload, mod diagnostics) had no reachable route. `D-DEV-003`
 * requires that content to be wired into the `Developer Tools` surface and
 * reachable only behind admitted Developer Mode. The implementation now lives
 * at `features/developer/developer-mod-sources-section.tsx` as the
 * `mod-sources` sub-area of `Developer Tools`.
 *
 * `DeveloperPage` is retained here only as the named alias of that section so
 * the surface is referenced by exactly one implementation — there is no
 * duplicated orphan body. It is NOT mounted anywhere outside `Developer Tools`.
 */

export { DeveloperModSourcesSection as DeveloperPage } from '@renderer/features/developer/developer-mod-sources-section.js';
