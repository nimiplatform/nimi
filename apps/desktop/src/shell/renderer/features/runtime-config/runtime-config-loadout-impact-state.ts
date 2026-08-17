export type RuntimeConfigLoadoutPendingImpact = {
  readonly kind: 'select' | 'clear' | 'update' | 'delete';
  readonly title: string;
  readonly run: () => Promise<void>;
  readonly onError?: (message: string) => void;
};

export type RuntimeConfigLoadoutImpactState = {
  readonly request: (pending: RuntimeConfigLoadoutPendingImpact) => void;
  readonly current: () => RuntimeConfigLoadoutPendingImpact | null;
  readonly confirm: () => RuntimeConfigLoadoutPendingImpact | null;
  readonly cancel: () => void;
};

type RuntimeConfigLoadoutImpactSlot = {
  readonly pending: RuntimeConfigLoadoutPendingImpact;
};

export function createRuntimeConfigLoadoutImpactState(): RuntimeConfigLoadoutImpactState {
  let slot: RuntimeConfigLoadoutImpactSlot | null = null;
  return Object.freeze({
    request(next) {
      slot = Object.freeze({ pending: next });
    },
    current() {
      return slot?.pending ?? null;
    },
    confirm() {
      const confirmed = slot?.pending ?? null;
      slot = null;
      return confirmed;
    },
    cancel() {
      slot = null;
    },
  });
}
