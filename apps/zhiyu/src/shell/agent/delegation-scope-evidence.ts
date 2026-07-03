import type { ZhiyuDelegationScopeEvidence } from '../app/evidence';
import {
  DELEGATION_READ_SCOPE,
  DELEGATION_WRITE_SCOPE,
  type DelegationControlSurfaceSnapshot,
} from './delegation-ux-types';

export const REQUIRED_DELEGATION_SCOPES = [DELEGATION_READ_SCOPE, DELEGATION_WRITE_SCOPE] as const;

export function scopeEvidenceFromSnapshot(snapshot: DelegationControlSurfaceSnapshot): ZhiyuDelegationScopeEvidence {
  const requiredScopes = uniqueScopes(snapshot.requiredScopes, REQUIRED_DELEGATION_SCOPES);
  const grantedScopes = uniqueScopes(snapshot.grantedScopes, []);
  const admittedScopes = uniqueScopes(snapshot.admittedScopes, []);
  const requiredSet = new Set(requiredScopes);
  const grantedSet = new Set(grantedScopes);
  const admittedSet = new Set(admittedScopes);
  const hasGrantEvidence = grantedScopes.length > 0 || admittedScopes.length > 0;
  const allRequiredGranted = requiredScopes.every((scope) => grantedSet.has(scope) || admittedSet.has(scope));
  const evidenceState: ZhiyuDelegationScopeEvidence['evidenceState'] = !hasGrantEvidence
    ? 'required-only'
    : allRequiredGranted && requiredSet.size > 0
      ? 'granted'
      : 'partial';
  return {
    requiredScopes,
    grantedScopes,
    admittedScopes,
    evidenceState,
    reasonCode: evidenceState === 'granted'
      ? 'runtime-delegation-scope-grant-projected'
      : evidenceState === 'partial'
        ? 'runtime-delegation-scope-grant-partial'
        : 'runtime-delegation-scope-grant-not-projected',
  };
}

export function requiredOnlyScopeEvidence(): ZhiyuDelegationScopeEvidence {
  return {
    requiredScopes: [...REQUIRED_DELEGATION_SCOPES],
    grantedScopes: [],
    admittedScopes: [],
    evidenceState: 'required-only',
    reasonCode: 'runtime-delegation-scope-grant-not-projected',
  };
}

function uniqueScopes(values: readonly unknown[] | undefined, fallback: readonly string[]): readonly string[] {
  const source = values && values.length > 0 ? values : fallback;
  return [...new Set(source.map(scopeString).filter(Boolean))];
}

function scopeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
