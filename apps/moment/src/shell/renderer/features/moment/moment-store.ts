import { create } from 'zustand';
import type { MomentPlayState, MomentSeed, MomentSession } from './types.js';

type MomentStore = {
  seed: MomentSeed;
  session: MomentSession | null;
  pending: boolean;
  error: string | null;
  setSeed(seed: Partial<MomentSeed>): void;
  clearSeed(): void;
  setSession(session: MomentSession | null): void;
  appendTurn(session: MomentSession): void;
  setPending(pending: boolean): void;
  setError(error: string | null): void;
};

const DEFAULT_SEED: MomentSeed = {
  mode: 'image',
  phrase: '',
  imageDataUrl: '',
  imageName: '',
};

const MOMENT_ACTIVE_SESSION_STORAGE_KEY = 'moment.active-session.v1';
const MOMENT_RECENT_SESSION_STORAGE_KEY = 'moment.recent-sessions.v1';

function derivePlayState(beatIndex: number, sealed: boolean): MomentPlayState {
  if (sealed || beatIndex >= 4) {
    return 'sealed';
  }
  if (beatIndex >= 2) {
    return 'sealing';
  }
  return 'open';
}

function normalizeStoredSession(session: MomentSession): MomentSession {
  const beatIndex = typeof session.beatIndex === 'number' ? session.beatIndex : session.turns.length;
  const relationState = session.relationState || session.turns.at(-1)?.relationState || session.opening.relationState;
  const sealed = Boolean(session.sealed || beatIndex >= 4);
  const playState = session.playState || derivePlayState(beatIndex, sealed);

  return {
    ...session,
    beatIndex,
    relationState,
    playState,
    sealed,
    ...(sealed && !session.sealedAt ? { sealedAt: session.turns.length > 0 ? new Date().toISOString() : session.createdAt } : {}),
  };
}

function readStoredSession(): MomentSession | null {
  try {
    const raw = localStorage.getItem(MOMENT_ACTIVE_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeStoredSession(JSON.parse(raw) as MomentSession);
  } catch {
    return null;
  }
}

function persistSession(session: MomentSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(MOMENT_ACTIVE_SESSION_STORAGE_KEY);
      return;
    }

      const normalized = normalizeStoredSession(session);
      localStorage.setItem(MOMENT_ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(normalized));

      const recentRaw = localStorage.getItem(MOMENT_RECENT_SESSION_STORAGE_KEY);
      const recent = recentRaw ? JSON.parse(recentRaw) as MomentSession[] : [];
      const nextRecent = [
        normalized,
        ...recent.filter((entry) => entry.sessionId !== normalized.sessionId),
      ].slice(0, 8);
      localStorage.setItem(MOMENT_RECENT_SESSION_STORAGE_KEY, JSON.stringify(nextRecent));
  } catch {
    // no-op
  }
}

export const useMomentStore = create<MomentStore>((set) => ({
  seed: DEFAULT_SEED,
  session: readStoredSession(),
  pending: false,
  error: null,

  setSeed(seed) {
    set((state) => ({
      seed: {
        ...state.seed,
        ...seed,
      },
      error: null,
    }));
  },

  clearSeed() {
    set({
      seed: DEFAULT_SEED,
      error: null,
    });
  },

  setSession(session) {
    persistSession(session);
    set({ session: session ? normalizeStoredSession(session) : null, error: null });
  },

  appendTurn(session) {
    persistSession(session);
    set({ session: normalizeStoredSession(session), error: null });
  },

  setPending(pending) {
    set({ pending });
  },

  setError(error) {
    set({ error });
  },
}));
