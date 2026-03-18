import { create } from 'zustand';

export type ReadinessStatus = 'checking' | 'ready' | 'degraded' | 'unavailable';

export interface SongBrief {
  title: string;
  genre: string;
  mood: string;
  tempo: string;
  description: string;
}

export interface SongTake {
  takeId: string;
  parentTakeId?: string;
  origin: 'prompt' | 'extend' | 'remix' | 'reference';
  title: string;
  jobId: string;
  artifactId?: string;
  promptSnapshot: string;
  lyricsSnapshot?: string;
  createdAt: number;
  favorite?: boolean;
}

export interface GenerationJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'canceled';
  progress?: string;
  error?: string;
}

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export type AuthUser = {
  id: string;
  displayName: string;
};

export interface AppState {
  authStatus: AuthStatus;
  authUser: AuthUser | null;
  authToken: string;
  authRefreshToken: string;

  runtimeStatus: ReadinessStatus;
  runtimeError: string | null;
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  musicConnectorAvailable: boolean;
  textConnectorAvailable: boolean;
  selectedTextConnectorId?: string;
  selectedTextModelId?: string;
  selectedMusicConnectorId?: string;
  selectedMusicModelId?: string;
  musicIterationSupported: boolean;
  readinessIssues: string[];

  projectId: string | null;
  brief: SongBrief | null;
  lyrics: string;
  selectedTakeId: string | null;

  takes: SongTake[];
  activeJobs: Map<string, GenerationJob>;
  audioBuffers: Map<string, ArrayBuffer>;
  compareTakeIds: [string | null, string | null];

  trimStart: number | null;
  trimEnd: number | null;

  draftPost: { title: string; description: string; tags: string[] } | null;
  provenanceConfirmed: boolean;
  publishStatus: 'idle' | 'uploading' | 'creating' | 'done' | 'error';
  publishError: string | null;
  publishedPostId: string | null;

  setAuthSession: (user: AuthUser, token: string, refreshToken: string) => void;
  clearAuthSession: () => void;

  setRuntimeStatus: (status: ReadinessStatus, error?: string) => void;
  setRealmConnection: (configured: boolean, authenticated: boolean) => void;
  setReadiness: (input: {
    textConnectorId?: string;
    textModelId?: string;
    musicConnectorId?: string;
    musicModelId?: string;
    musicIterationSupported: boolean;
    issues: string[];
  }) => void;
  setBrief: (brief: SongBrief | null) => void;
  setLyrics: (lyrics: string) => void;
  addTake: (take: SongTake) => void;
  selectTake: (takeId: string | null) => void;
  toggleFavorite: (takeId: string) => void;
  renameTake: (takeId: string, title: string) => void;
  discardTake: (takeId: string) => void;
  setCompareTakeSlot: (slot: 0 | 1, takeId: string | null) => void;
  clearCompareTakeIds: () => void;
  setJobStatus: (jobId: string, job: GenerationJob) => void;
  removeJob: (jobId: string) => void;
  setAudioBuffer: (takeId: string, buffer: ArrayBuffer) => void;
  setTrimStart: (seconds: number) => void;
  setTrimEnd: (seconds: number) => void;
  clearTrim: () => void;
  setDraftPost: (draft: AppState['draftPost']) => void;
  setProvenanceConfirmed: (confirmed: boolean) => void;
  setPublishStatus: (status: AppState['publishStatus'], error?: string) => void;
  setPublishedPostId: (postId: string | null) => void;
  startProject: () => void;
  resetProject: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  authStatus: 'bootstrapping',
  authUser: null,
  authToken: '',
  authRefreshToken: '',

  runtimeStatus: 'checking',
  runtimeError: null,
  realmConfigured: false,
  realmAuthenticated: false,
  musicConnectorAvailable: false,
  textConnectorAvailable: false,
  selectedTextConnectorId: undefined,
  selectedTextModelId: undefined,
  selectedMusicConnectorId: undefined,
  selectedMusicModelId: undefined,
  musicIterationSupported: false,
  readinessIssues: [],

  projectId: null,
  brief: null,
  lyrics: '',
  selectedTakeId: null,

  takes: [],
  activeJobs: new Map(),
  audioBuffers: new Map(),
  compareTakeIds: [null, null],
  trimStart: null,
  trimEnd: null,

  draftPost: null,
  provenanceConfirmed: false,
  publishStatus: 'idle',
  publishError: null,
  publishedPostId: null,

  setAuthSession: (user, token, refreshToken) =>
    set({ authStatus: 'authenticated', authUser: user, authToken: token, authRefreshToken: refreshToken }),

  clearAuthSession: () =>
    set({ authStatus: 'unauthenticated', authUser: null, authToken: '', authRefreshToken: '' }),

  setRuntimeStatus: (status, error) =>
    set({ runtimeStatus: status, runtimeError: error ?? null }),

  setRealmConnection: (configured, authenticated) =>
    set({ realmConfigured: configured, realmAuthenticated: authenticated }),

  setReadiness: (input) =>
    set({
      textConnectorAvailable: Boolean(input.textConnectorId && input.textModelId),
      musicConnectorAvailable: Boolean(input.musicConnectorId && input.musicModelId),
      selectedTextConnectorId: input.textConnectorId,
      selectedTextModelId: input.textModelId,
      selectedMusicConnectorId: input.musicConnectorId,
      selectedMusicModelId: input.musicModelId,
      musicIterationSupported: input.musicIterationSupported,
      readinessIssues: input.issues,
    }),

  setBrief: (brief) => set({ brief }),

  setLyrics: (lyrics) => set({ lyrics }),

  addTake: (take) =>
    set((state) => ({
      takes: [...state.takes, take],
      selectedTakeId: take.takeId,
      publishStatus: 'idle',
      publishError: null,
      publishedPostId: null,
    })),

  selectTake: (takeId) => set({
    selectedTakeId: takeId,
    publishStatus: 'idle',
    publishError: null,
    publishedPostId: null,
  }),

  toggleFavorite: (takeId) =>
    set((state) => ({
      takes: state.takes.map((take) =>
        take.takeId === takeId ? { ...take, favorite: !take.favorite } : take),
    })),

  renameTake: (takeId, title) =>
    set((state) => ({
      takes: state.takes.map((take) =>
        take.takeId === takeId ? { ...take, title } : take),
    })),

  discardTake: (takeId) =>
    set((state) => {
      const nextTakes = state.takes.filter((take) => take.takeId !== takeId);
      const nextAudioBuffers = new Map(state.audioBuffers);
      nextAudioBuffers.delete(takeId);
      const nextCompare: [string | null, string | null] = [
        state.compareTakeIds[0] === takeId ? null : state.compareTakeIds[0],
        state.compareTakeIds[1] === takeId ? null : state.compareTakeIds[1],
      ];
      return {
        takes: nextTakes,
        audioBuffers: nextAudioBuffers,
        selectedTakeId: state.selectedTakeId === takeId ? (nextTakes[0]?.takeId ?? null) : state.selectedTakeId,
        compareTakeIds: nextCompare,
        publishStatus: state.selectedTakeId === takeId ? 'idle' : state.publishStatus,
        publishError: state.selectedTakeId === takeId ? null : state.publishError,
        publishedPostId: state.selectedTakeId === takeId ? null : state.publishedPostId,
      };
    }),

  setCompareTakeSlot: (slot, takeId) =>
    set((state) => {
      const next: [string | null, string | null] = [...state.compareTakeIds];
      next[slot] = takeId;
      return { compareTakeIds: next };
    }),

  clearCompareTakeIds: () => set({ compareTakeIds: [null, null] }),

  setJobStatus: (jobId, job) =>
    set((state) => {
      const next = new Map(state.activeJobs);
      next.set(jobId, job);
      return { activeJobs: next };
    }),

  removeJob: (jobId) =>
    set((state) => {
      const next = new Map(state.activeJobs);
      next.delete(jobId);
      return { activeJobs: next };
    }),

  setAudioBuffer: (takeId, buffer) =>
    set((state) => {
      const next = new Map(state.audioBuffers);
      next.set(takeId, buffer);
      return { audioBuffers: next };
    }),

  setTrimStart: (seconds) => set({ trimStart: seconds }),

  setTrimEnd: (seconds) => set({ trimEnd: seconds }),

  clearTrim: () => set({ trimStart: null, trimEnd: null }),

  setDraftPost: (draft) => set({ draftPost: draft }),

  setProvenanceConfirmed: (confirmed) => set({ provenanceConfirmed: confirmed }),

  setPublishStatus: (status, error) =>
    set({ publishStatus: status, publishError: status === 'error' ? (error ?? 'Unknown error') : null }),

  setPublishedPostId: (postId) => set({ publishedPostId: postId }),

  startProject: () =>
    set({ projectId: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),

  resetProject: () =>
    set({
      projectId: null,
      brief: null,
      lyrics: '',
      selectedTakeId: null,
      takes: [],
      activeJobs: new Map(),
      audioBuffers: new Map(),
      compareTakeIds: [null, null],
      trimStart: null,
      trimEnd: null,
      draftPost: null,
      provenanceConfirmed: false,
      publishStatus: 'idle',
      publishError: null,
      publishedPostId: null,
    }),
}));
