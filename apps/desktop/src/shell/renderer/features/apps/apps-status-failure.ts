// Apps `status()`-failure → canonical card-state mapping (T4-W5).
//
// W5 hard-cuts the historical 12th `status_unavailable` card state. D-HOME-005
// and P-NAPP-008 are explicit: the Apps surface
// "must not collapse distinct failure states into a single 'Unavailable'
// card", and `P-NAPP-008` MUST NOT hide multiple fail-closed reasons behind a
// single `unavailable` text. A 12th catch-all bucket is exactly that
// collapse — so it is removed entirely.
//
// After the cut, a per-app `client.status()` RPC failure resolves to one of
// the 11 canonical product card states, derived from the typed failure
// (Fork E, option E3 with E1 as the default bucket):
//
//   - A typed `NimiError` carries a `reasonCode`; known runtime/host codes map
//     to `unsupported_on_this_device` (host/runtime evidence cannot support
//     the app) or `blocked_by_policy` (a policy/permission denial).
//   - Every other `status()` failure — a non-canonical or incomplete status
//     projection, a stale registry projection, an opaque transport error —
//     means the installed package/data/runtime evidence the panel can read is
//     inconsistent. That is exactly the D-HOME-005 `repair_required` rule
//     ("Installed package/data/runtime evidence is inconsistent or
//     corrupted"). `repair_required` is therefore the default bucket: it keeps
//     the row visible, gives the user a Repair action, and carries the exact
//     failure detail — it never collapses distinct reasons into one label.
//
// This module owns no parallel truth: it is a pure function over the typed
// error a `status()` rejection already carries.

import { isNimiErrorLike } from '@nimiplatform/sdk/types';
import type { CanonicalAppCardState } from './apps-card-state.js';

/**
 * The canonical card state a `status()` failure resolves to, plus the
 * single-line detail string carrying the exact typed failure. The card state
 * is always one of the 11 canonical product states — there is no 12th value.
 */
export interface AppStatusFailureResolution {
  readonly cardState: CanonicalAppCardState;
  readonly detail: string;
}

/**
 * Typed `NimiError.reasonCode` values that mean the host/runtime cannot
 * support the app at all. These resolve to `unsupported_on_this_device`
 * per D-HOME-005.
 */
const UNSUPPORTED_REASON_CODES: ReadonlySet<string> = new Set([
  'COMPAT_RUNTIME_TOO_OLD',
  'COMPAT_RUNTIME_TOO_NEW',
  'COMPAT_NO_MIN_VERSION',
  'SDK_RUNTIME_VERSION_INCOMPATIBLE',
  'SDK_RUNTIME_METHOD_UNAVAILABLE',
  'RUNTIME_ROUTE_CAPABILITY_MISSING',
  'PROTOCOL_VERSION_MISMATCH',
]);

/**
 * Typed `NimiError.reasonCode` values that mean a policy / permission decision
 * is blocking the app. These resolve to `blocked_by_policy` per D-HOME-005.
 */
const BLOCKED_REASON_CODES: ReadonlySet<string> = new Set([
  'APP_AUTHORIZATION_DENIED',
  'APP_SCOPE_FORBIDDEN',
  'APP_SCOPE_REVOKED',
  'PRINCIPAL_UNAUTHORIZED',
  'RUNTIME_GRPC_PERMISSION_DENIED',
  'AUTH_DENIED',
]);

/**
 * Resolve a per-app `client.status()` rejection to a canonical card state.
 *
 * The default — used for any non-canonical / incomplete status projection, a
 * stale registry projection, or an opaque transport failure — is
 * `repair_required`: a typed, recoverable, action-bearing card. There is no
 * collapsed "Unavailable" bucket and the row is never dropped.
 */
export function resolveAppStatusFailure(error: unknown): AppStatusFailureResolution {
  const detail = `status failed: ${describeStatusFailure(error)}`;
  const reasonCode = extractReasonCode(error);
  if (reasonCode && UNSUPPORTED_REASON_CODES.has(reasonCode)) {
    return { cardState: 'unsupported_on_this_device', detail };
  }
  if (reasonCode && BLOCKED_REASON_CODES.has(reasonCode)) {
    return { cardState: 'blocked_by_policy', detail };
  }
  // E1 default bucket: an inconsistent/unreadable status projection is a
  // repair condition, not a generic dead-end.
  return { cardState: 'repair_required', detail };
}

/**
 * Extract a typed `NimiError.reasonCode` from a `status()` rejection. The SDK
 * `NimiAppClient` wraps a transport failure in a `NimiAppClientError` whose
 * `cause` is the underlying error — so a runtime-originated `NimiError` is
 * checked both on the thrown value and on its `cause` chain.
 */
function extractReasonCode(error: unknown): string | undefined {
  if (isNimiErrorLike(error)) {
    return error.reasonCode;
  }
  const cause = (error as { readonly cause?: unknown } | null | undefined)?.cause;
  if (cause !== undefined && cause !== error && isNimiErrorLike(cause)) {
    return cause.reasonCode;
  }
  return undefined;
}

/**
 * Render a single-line human detail for a `status()` rejection. A typed
 * `NimiError` contributes its `reasonCode`; otherwise the error message (and
 * its `cause` message) are surfaced verbatim so distinct failures stay
 * distinguishable.
 */
function describeStatusFailure(error: unknown): string {
  if (isNimiErrorLike(error)) {
    const detailsCause = (error as { readonly details?: { readonly cause?: unknown } }).details?.cause;
    const causeDetail = typeof detailsCause === 'string' && detailsCause.trim()
      ? `: ${detailsCause.trim()}`
      : '';
    return `${error.message}${causeDetail} (reasonCode=${error.reasonCode})`;
  }
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  const cause = (error as { readonly cause?: unknown }).cause;
  if (isNimiErrorLike(cause)) {
    return `${error.message}: ${cause.message} (reasonCode=${cause.reasonCode})`;
  }
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}
