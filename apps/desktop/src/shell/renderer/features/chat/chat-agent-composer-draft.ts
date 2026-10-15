import type { AppStoreState } from '../../app-shell/providers/store-types';

/** A draft belongs to one account and one partner; without either there is none. */
export function agentComposerDraftKey(accountId: string, agentHandle: string): string | null {
  const account = accountId.trim();
  const handle = agentHandle.trim();
  return account && handle ? `${account}\u0000${handle}` : null;
}

type AgentComposerDraftStore = {
  getState: () => Pick<AppStoreState, 'agentComposerDrafts' | 'setAgentComposerDraft'>;
};

/**
 * A ref-shaped view of one partner's draft. Reads and writes always address
 * the account and partner it was created for, so a late write from a turn
 * started with partner A never lands in partner B's composer.
 */
export function createAgentComposerDraftRef(
  store: AgentComposerDraftStore,
  accountId: string,
  agentHandle: string,
): { current: string; readonly revision: number } {
  const key = agentComposerDraftKey(accountId, agentHandle);
  let revision = 0;
  return {
    get revision() { return revision; },
    get current() {
      return key ? store.getState().agentComposerDrafts[key] ?? '' : '';
    },
    set current(text: string) {
      if (key) {
        if ((store.getState().agentComposerDrafts[key] ?? '') !== text) revision++;
        store.getState().setAgentComposerDraft(accountId, agentHandle, text);
      }
    },
  };
}
