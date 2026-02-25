import type { CredentialRef, ProfileRotationState } from './types';

export class RotationManager {
  private readonly states = new Map<string, ProfileRotationState>();

  private ensure(refId: string) {
    const existing = this.states.get(refId);
    if (existing) {
      return existing;
    }

    const created: ProfileRotationState = {
      refId,
      errorCount: 0,
    };

    this.states.set(refId, created);
    return created;
  }

  markUsed(refId: string) {
    const state = this.ensure(refId);
    state.lastUsedAt = Date.now();
    state.cooldownUntil = undefined;
  }

  markError(refId: string, retryAfterMs?: number) {
    const state = this.ensure(refId);
    state.errorCount += 1;
    const backoff = retryAfterMs ?? Math.min(3600_000, 60_000 * Math.pow(2, Math.max(0, state.errorCount - 1)));
    state.cooldownUntil = Date.now() + backoff;
  }

  markRecovered(refId: string) {
    const state = this.ensure(refId);
    state.errorCount = 0;
    state.cooldownUntil = undefined;
  }

  isCoolingDown(refId: string) {
    const state = this.states.get(refId);
    if (!state?.cooldownUntil) {
      return false;
    }

    return state.cooldownUntil > Date.now();
  }

  selectAvailable(refs: CredentialRef[]) {
    const now = Date.now();
    return refs
      .filter((ref) => {
        const state = this.states.get(ref.refId);
        return !state?.cooldownUntil || state.cooldownUntil <= now;
      })
      .sort((a, b) => {
        const aUsed = this.states.get(a.refId)?.lastUsedAt ?? 0;
        const bUsed = this.states.get(b.refId)?.lastUsedAt ?? 0;
        return aUsed - bUsed;
      });
  }

  getState(refId: string) {
    return this.states.get(refId);
  }
}
