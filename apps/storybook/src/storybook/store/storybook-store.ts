// App-internal, project-scoped persistence. Everything here stays local to the
// app (localStorage, with an in-memory fallback). It never writes to Runtime
// memory, Realm world state, or shared Nimi ecosystem memory. Provider/model
// routing and platform identity are owned elsewhere (SDK), never duplicated here.

import { type StorybookProject, type StorybookTruthPackage } from '../engine/truth.js';
import { type ProjectMemory, createProjectMemory } from '../engine/memory.js';
import { type StoryRun, type RunTranscript, type BranchSnapshot } from '../engine/run.js';
import { type NarrativeRunEnvelope } from '../engine/narrative.js';
import { type PromotionCandidate } from '../engine/promotion.js';
import { type RegenerationRequest } from '../engine/editor.js';
import { type PreparedStorybookPackage } from '../engine/prepared-package.js';

const ROOT_KEY = 'nimiapp-storybook:app-internal-store:v1';

export type StoredProjectRecord = {
  project: StorybookProject;
  truthPackage: StorybookTruthPackage;
  memory: ProjectMemory;
  /** Persisted scoped regeneration requests with their lifecycle status (wave-12). */
  regenerationRequests?: RegenerationRequest[];
};

export type ImportedPackageSource = 'official' | 'local-import';

export type ImportedPackageRecord = {
  id: string;
  label: string;
  source: ImportedPackageSource;
  /** UI entry label only — not an extra package source category. */
  entryLabel: 'recent' | 'recommended' | 'friend-provided' | 'creator-provided';
  package: PreparedStorybookPackage;
  importedAt: string;
  /** Set when a creator's Studio project produced this package — links run promotions back to the project (wave-11). */
  sourceProjectId?: string;
};

export type RunRecord = {
  packageId: string;
  run: StoryRun;
  transcript: RunTranscript;
  snapshots: BranchSnapshot[];
  /** App-local guarded narrative spine + turn records for this run (wave-8). */
  narrative?: NarrativeRunEnvelope;
  /** Promotion candidates derived from real guarded turns in this run (wave-11). */
  promotionCandidates?: PromotionCandidate[];
  /** Candidate ids already resolved by Studio review (so they don't reappear). */
  resolvedCandidateIds?: string[];
};

type StoreShape = {
  projects: Record<string, StoredProjectRecord>;
  importedPackages: Record<string, ImportedPackageRecord>;
  runs: Record<string, RunRecord>;
};

let memoryStore: StoreShape = emptyStore();

function emptyStore(): StoreShape {
  return { projects: {}, importedPackages: {}, runs: {} };
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function read(): StoreShape {
  const storage = getStorage();
  if (!storage) return memoryStore;
  const raw = storage.getItem(ROOT_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      projects: parsed.projects ?? {},
      importedPackages: parsed.importedPackages ?? {},
      runs: parsed.runs ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function write(store: StoreShape): void {
  const storage = getStorage();
  if (!storage) {
    memoryStore = store;
    return;
  }
  storage.setItem(ROOT_KEY, JSON.stringify(store));
}

// --- projects ---

export function listProjects(): StoredProjectRecord[] {
  return Object.values(read().projects).sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

export function getProject(projectId: string): StoredProjectRecord | null {
  return read().projects[projectId] ?? null;
}

export function saveProject(record: StoredProjectRecord): void {
  const store = read();
  store.projects[record.project.id] = record;
  write(store);
}

export function ensureProjectMemory(projectId: string): ProjectMemory {
  const record = getProject(projectId);
  return record?.memory ?? createProjectMemory(projectId);
}

export function deleteProject(projectId: string): void {
  const store = read();
  delete store.projects[projectId];
  write(store);
}

// --- imported / official prepared packages ---

export function listImportedPackages(): ImportedPackageRecord[] {
  return Object.values(read().importedPackages).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export function getImportedPackage(id: string): ImportedPackageRecord | null {
  return read().importedPackages[id] ?? null;
}

export function saveImportedPackage(record: ImportedPackageRecord): void {
  const store = read();
  store.importedPackages[record.id] = record;
  write(store);
}

// --- runs ---

export function listRuns(packageId?: string): RunRecord[] {
  const runs = Object.values(read().runs);
  const scoped = packageId ? runs.filter((r) => r.packageId === packageId) : runs;
  return scoped.sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt));
}

export function getRun(runId: string): RunRecord | null {
  return read().runs[runId] ?? null;
}

export function saveRun(record: RunRecord): void {
  const store = read();
  store.runs[record.run.id] = record;
  write(store);
}
