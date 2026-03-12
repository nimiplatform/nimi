import type {
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiVerifiedModelDescriptor,
} from '@runtime/local-ai-runtime';
import { formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import { parseTimestamp, type ProgressSessionState } from './runtime-config-model-center-utils';

export const ARTIFACT_KIND_OPTIONS = [
  'vae',
  'llm',
  'clip',
  'controlnet',
  'lora',
  'auxiliary',
] as const satisfies readonly LocalAiArtifactKind[];

export function formatArtifactKindLabel(value: LocalAiArtifactKind): string {
  switch (value) {
    case 'vae':
      return 'VAE';
    case 'llm':
      return 'LLM';
    case 'clip':
      return 'CLIP';
    case 'controlnet':
      return 'ControlNet';
    case 'lora':
      return 'LoRA';
    case 'auxiliary':
      return 'Auxiliary';
    default:
      return value;
  }
}

const GENERIC_MODEL_TAGS = new Set([
  'verified',
  'recommended',
  'chat',
  'image',
  'video',
  'tts',
  'stt',
  'embedding',
  'localai',
  'nexa',
]);

function normalizeDescriptorToken(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function collectModelFamilyHints(model: LocalAiVerifiedModelDescriptor): string[] {
  const hints = new Set<string>();
  for (const tag of model.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function hasDescriptorTag(
  tags: string[] | undefined | null,
  target: string,
): boolean {
  const normalizedTarget = normalizeDescriptorToken(target);
  if (!normalizedTarget) {
    return false;
  }
  return (tags || []).some((tag) => normalizeDescriptorToken(tag) === normalizedTarget);
}

export function isRecommendedDescriptor(tags: string[] | undefined | null): boolean {
  return hasDescriptorTag(tags, 'recommended');
}

function compareDescriptorTitles(
  leftTitle: string,
  leftId: string,
  rightTitle: string,
  rightId: string,
): number {
  const byTitle = leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' });
  if (byTitle !== 0) {
    return byTitle;
  }
  return leftId.localeCompare(rightId, undefined, { sensitivity: 'base' });
}

export function sortVerifiedModelsForDisplay(
  models: LocalAiVerifiedModelDescriptor[],
): LocalAiVerifiedModelDescriptor[] {
  return [...models].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

const ARTIFACT_KIND_RANK: Record<LocalAiArtifactKind, number> = {
  vae: 0,
  llm: 1,
  clip: 2,
  controlnet: 3,
  lora: 4,
  auxiliary: 5,
};

export function sortVerifiedArtifactsForDisplay(
  artifacts: LocalAiVerifiedArtifactDescriptor[],
): LocalAiVerifiedArtifactDescriptor[] {
  return [...artifacts].sort((left, right) => {
    const leftRecommended = isRecommendedDescriptor(left.tags);
    const rightRecommended = isRecommendedDescriptor(right.tags);
    if (leftRecommended !== rightRecommended) {
      return leftRecommended ? -1 : 1;
    }
    const leftKindRank = ARTIFACT_KIND_RANK[left.kind] ?? Number.MAX_SAFE_INTEGER;
    const rightKindRank = ARTIFACT_KIND_RANK[right.kind] ?? Number.MAX_SAFE_INTEGER;
    if (leftKindRank !== rightKindRank) {
      return leftKindRank - rightKindRank;
    }
    return compareDescriptorTitles(left.title, left.templateId, right.title, right.templateId);
  });
}

function collectArtifactFamilyHints(artifact: LocalAiVerifiedArtifactDescriptor): string[] {
  const hints = new Set<string>();
  const family = normalizeDescriptorToken(typeof artifact.metadata?.family === 'string' ? artifact.metadata.family : '');
  if (family) {
    hints.add(family);
  }
  for (const tag of artifact.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

export function filterInstalledArtifacts(
  artifacts: LocalAiArtifactRecord[],
  kindFilter: 'all' | LocalAiArtifactKind,
  query: string,
): LocalAiArtifactRecord[] {
  return artifacts.filter((artifact) => {
    const matchesKind = kindFilter === 'all' || artifact.kind === kindFilter;
    if (!matchesKind) return false;
    if (!query) return true;
    return (
      artifact.artifactId.toLowerCase().includes(query)
      || artifact.localArtifactId.toLowerCase().includes(query)
      || artifact.engine.toLowerCase().includes(query)
      || artifact.kind.toLowerCase().includes(query)
      || artifact.source.repo.toLowerCase().includes(query)
    );
  });
}

export function relatedArtifactsForModel(
  model: LocalAiVerifiedModelDescriptor,
  artifacts: LocalAiVerifiedArtifactDescriptor[],
): LocalAiVerifiedArtifactDescriptor[] {
  const capabilities = new Set((model.capabilities || []).map((value) => normalizeDescriptorToken(value)));
  if (!capabilities.has('image')) {
    return [];
  }
  const modelFamilies = new Set(collectModelFamilyHints(model));
  if (modelFamilies.size === 0) {
    return [];
  }
  return artifacts.filter((artifact) => {
    const artifactFamilies = collectArtifactFamilyHints(artifact);
    return artifactFamilies.some((family) => modelFamilies.has(family));
  });
}

export type ArtifactTaskState = 'running' | 'completed' | 'failed';

export type ArtifactTaskEntry = {
  templateId: string;
  artifactId: string;
  title: string;
  kind: LocalAiArtifactKind;
  taskKind: 'verified-install';
  state: ArtifactTaskState;
  detail?: string;
  updatedAtMs: number;
};

export function isArtifactTaskTerminal(state: ArtifactTaskState): boolean {
  return state === 'completed' || state === 'failed';
}

export function artifactTaskStatusLabel(state: ArtifactTaskState): string {
  if (state === 'running') return 'Installing';
  if (state === 'completed') return 'Installed';
  return 'Failed';
}

export function formatLastCheckedAgo(lastCheckedAt: string | null): string {
  if (!lastCheckedAt) {
    return i18n.t('runtimeConfig.local.notCheckedYet', { defaultValue: 'Not checked yet' });
  }
  const ts = parseTimestamp(lastCheckedAt);
  if (!ts) {
    return i18n.t('runtimeConfig.local.lastCheckedRaw', {
      value: lastCheckedAt,
      defaultValue: 'Last checked: {{value}}',
    });
  }
  return i18n.t('runtimeConfig.local.checkedAgo', {
    value: formatRelativeLocaleTime(new Date(ts)),
    defaultValue: 'Checked {{value}}',
  });
}

export function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function HeartPulseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}

export function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

export function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function FolderOpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-mint-500' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function ModelIcon({ engine }: { engine: string }) {
  const colors: Record<string, string> = {
    localai: 'from-emerald-400 to-teal-500',
    ollama: 'from-amber-400 to-orange-500',
    llamacpp: 'from-blue-400 to-indigo-500',
    vllm: 'from-purple-400 to-pink-500',
    default: 'from-gray-400 to-gray-500',
  };
  const color = colors[engine.toLowerCase()] || colors.default;

  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white text-[10px] font-bold shadow-sm`}>
      {engine.slice(0, 2).toUpperCase()}
    </div>
  );
}

const downloadSessionSnapshotCache: Record<string, ProgressSessionState> = {};

export function getCachedProgressSessions(): Record<string, ProgressSessionState> {
  return { ...downloadSessionSnapshotCache };
}

export function cacheProgressSessions(
  sessions: Record<string, ProgressSessionState>,
): Record<string, ProgressSessionState> {
  for (const sessionId of Object.keys(downloadSessionSnapshotCache)) {
    if (!(sessionId in sessions)) {
      delete downloadSessionSnapshotCache[sessionId];
    }
  }
  Object.assign(downloadSessionSnapshotCache, sessions);
  return sessions;
}
