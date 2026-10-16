import type { NimiDesktopPortableAIProfileCatalogRecord } from '@nimiplatform/sdk/runtime';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { RuntimeConfigProfileUseOwner } from './runtime-config-panel-types.js';

export type RuntimeProfileViewMode =
  | { readonly kind: 'recommended' | 'create' | 'export' }
  | {
    readonly kind: 'use'; readonly owner?: RuntimeConfigProfileUseOwner;
    readonly autoReview?: boolean; readonly saved?: boolean;
    readonly profile: Pick<NimiDesktopPortableAIProfileCatalogRecord, 'source' | 'artifactJson'>;
  };

export type RuntimeProfileViewDraft = {
  readonly mode: RuntimeProfileViewMode;
  readonly destination: string;
  readonly subset?: readonly string[];
  readonly busy: boolean;
  readonly autoReviewStarted: boolean;
  readonly error: string;
  readonly outcomes: readonly { readonly capabilityContract: string; readonly taskId?: string; readonly error?: string }[];
};

// Session-only form drafts. Navigation carries references, never profile contents
// or use authorization. Preparation itself remains owned by the setup task store.
const sessions = new WeakMap<HomeNavigation, ReturnType<typeof createProfileViewState>>();
export function getProfileViewState(navigation: HomeNavigation) {
  let state = sessions.get(navigation);
  if (!state) { state = createProfileViewState(); sessions.set(navigation, state); }
  return state;
}

export function createProfileViewState() {
  const views = new Map<string, RuntimeProfileViewDraft>();
  const listeners = new Set<() => void>();
  return {
    create(mode: RuntimeProfileViewMode): string {
      const id = crypto.randomUUID();
      views.set(id, { mode, destination: 'machine', busy: false, autoReviewStarted: false, error: '', outcomes: [] });
      return id;
    },
    get: (id: string | undefined) => id ? views.get(id) : undefined,
    update(id: string, change: (draft: RuntimeProfileViewDraft) => Partial<RuntimeProfileViewDraft>) {
      const current = views.get(id);
      if (!current) return;
      views.set(id, { ...current, ...change(current) });
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A completed request may open its result only if its originating entry was never left. */
export function trackProfileViewRequest(navigation: HomeNavigation) {
  const key = navigation.getSnapshot().current.key;
  let left = false;
  const unsubscribe = navigation.subscribe(() => { if (navigation.getSnapshot().current.key !== key) left = true; });
  return { canNavigate: () => !left && navigation.getSnapshot().current.key === key, dispose: unsubscribe };
}
