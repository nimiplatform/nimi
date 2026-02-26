import type { LifecycleState } from '../contracts/types';
import { ReasonCode } from '@nimiplatform/sdk/types';

type LifecycleEntry = {
  state: LifecycleState;
  updatedAt: string;
  history: Array<{ from: LifecycleState; to: LifecycleState; at: string }>;
};

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  DISCOVERED: ['VERIFIED', 'INSTALLED', 'UNINSTALLED'],
  VERIFIED: ['INSTALLED', 'UNINSTALLED'],
  INSTALLED: ['ENABLED', 'DISABLED', 'UNINSTALLED', 'UPDATING'],
  ENABLED: ['DISABLED', 'UNINSTALLED', 'UPDATING'],
  DISABLED: ['ENABLED', 'UNINSTALLED', 'UPDATING'],
  UNINSTALLED: ['DISCOVERED'],
  UPDATING: ['INSTALLED', 'ROLLBACK_DISABLED'],
  ROLLBACK_DISABLED: ['ENABLED', 'DISABLED', 'UNINSTALLED'],
};

export class LifecycleManager {
  private readonly entries = new Map<string, LifecycleEntry>();

  set(modId: string, version: string, state: LifecycleState): void {
    const k = this.key(modId, version);
    const existing = this.entries.get(k);
    const now = new Date().toISOString();

    if (existing) {
      const historyItem = { from: existing.state, to: state, at: now };
      existing.history.push(historyItem);
      existing.state = state;
      existing.updatedAt = now;
    } else {
      this.entries.set(k, {
        state,
        updatedAt: now,
        history: [],
      });
    }
  }

  get(modId: string, version: string): LifecycleState | undefined {
    return this.entries.get(this.key(modId, version))?.state;
  }

  validateTransition(
    modId: string,
    version: string,
    targetState: LifecycleState,
  ): { valid: boolean; reasonCode: string } {
    const current = this.get(modId, version);
    if (!current) {
      if (targetState === 'DISCOVERED' || targetState === 'INSTALLED') {
        return { valid: true, reasonCode: ReasonCode.TRANSITION_INITIAL };
      }
      return { valid: false, reasonCode: ReasonCode.LIFECYCLE_NOT_FOUND };
    }

    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(targetState)) {
      return {
        valid: false,
        reasonCode: `TRANSITION_INVALID:${current}->${targetState}`,
      };
    }
    return { valid: true, reasonCode: ReasonCode.TRANSITION_VALID };
  }

  getHistory(
    modId: string,
    version: string,
  ): Array<{ from: LifecycleState; to: LifecycleState; at: string }> {
    return this.entries.get(this.key(modId, version))?.history || [];
  }

  remove(modId: string, version: string): void {
    this.entries.delete(this.key(modId, version));
  }

  listAll(): Array<{
    modId: string;
    version: string;
    state: LifecycleState;
    updatedAt: string;
  }> {
    const result: Array<{
      modId: string;
      version: string;
      state: LifecycleState;
      updatedAt: string;
    }> = [];
    for (const [k, entry] of this.entries) {
      const [modId, version] = this.parseKey(k);
      result.push({ modId, version, state: entry.state, updatedAt: entry.updatedAt });
    }
    return result;
  }

  private key(modId: string, version: string): string {
    return `${modId}@${version}`;
  }

  private parseKey(k: string): [string, string] {
    const atIndex = k.lastIndexOf('@');
    if (atIndex === -1) {
      return [k, ''];
    }
    return [k.slice(0, atIndex), k.slice(atIndex + 1)];
  }
}
