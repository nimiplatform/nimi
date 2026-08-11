// ---------------------------------------------------------------------------
// Capability types
// ---------------------------------------------------------------------------

export type CapabilityKey = string;
export type CapabilitySourceType = 'builtin' | 'injected' | 'sideload' | 'core' | 'codegen';

// ---------------------------------------------------------------------------
// Normalization and matching
// ---------------------------------------------------------------------------

export function normalizeCapabilityKey(value: string): CapabilityKey {
  return String(value || '').trim();
}

function matchesWildcardPattern(pattern: string, capabilityKey: string): boolean {
  const parts = pattern.split('*');
  let cursor = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }
    const foundAt = capabilityKey.indexOf(part, cursor);
    if (foundAt < 0) {
      return false;
    }
    if (index === 0 && !pattern.startsWith('*') && foundAt !== 0) {
      return false;
    }
    cursor = foundAt + part.length;
  }

  const lastPart = parts.length > 0 ? parts[parts.length - 1] || '' : '';
  if (!pattern.endsWith('*') && lastPart) {
    return capabilityKey.endsWith(lastPart);
  }
  return pattern.endsWith('*') || cursor === capabilityKey.length;
}

export function capabilityMatches(pattern: string, capabilityKey: string): boolean {
  const normalizedPattern = normalizeCapabilityKey(pattern);
  const normalizedCapability = normalizeCapabilityKey(capabilityKey);
  if (!normalizedPattern || !normalizedCapability) {
    return false;
  }
  if (normalizedPattern === '*') {
    return true;
  }
  if (normalizedPattern === normalizedCapability) {
    return true;
  }
  if (normalizedPattern.includes('*')) {
    return matchesWildcardPattern(normalizedPattern, normalizedCapability);
  }
  return false;
}

export function anyCapabilityMatches(patterns: string[], capabilityKey: string): boolean {
  return patterns.some((pattern) => capabilityMatches(pattern, capabilityKey));
}

export function expandCapabilitiesFromDeclarations(
  declarations: string[],
): string[] {
  const expanded = new Set<string>();

  for (const declaration of declarations || []) {
    const normalized = normalizeCapabilityKey(declaration);
    if (!normalized) {
      continue;
    }
    expanded.add(normalized);
  }

  return Array.from(expanded);
}

// ---------------------------------------------------------------------------
// Capability builders
// ---------------------------------------------------------------------------

export function eventPublishCapability(topic: string): CapabilityKey {
  return `event.publish.${String(topic || '').trim()}`;
}

export function eventSubscribeCapability(topic: string): CapabilityKey {
  return `event.subscribe.${String(topic || '').trim()}`;
}

export function dataQueryCapability(name: string): CapabilityKey {
  return `data.query.${String(name || '').trim()}`;
}

export function dataRegisterCapability(name: string): CapabilityKey {
  return `data.register.${String(name || '').trim()}`;
}

export function storageFilesReadCapability(): CapabilityKey {
  return 'storage.files.read';
}

export function storageFilesWriteCapability(): CapabilityKey {
  return 'storage.files.write';
}

export function storageFilesDeleteCapability(): CapabilityKey {
  return 'storage.files.delete';
}

export function storageFilesListCapability(): CapabilityKey {
  return 'storage.files.list';
}

export function storageSqliteQueryCapability(): CapabilityKey {
  return 'storage.sqlite.query';
}

export function storageSqliteExecuteCapability(): CapabilityKey {
  return 'storage.sqlite.execute';
}

export function storageSqliteTransactionCapability(): CapabilityKey {
  return 'storage.sqlite.transaction';
}

export function uiRegisterCapability(slot: string): CapabilityKey {
  return `ui.register.${String(slot || '').trim()}`;
}

// ---------------------------------------------------------------------------
// Permission catalog constants
// ---------------------------------------------------------------------------

export const DEFAULT_UI_SLOTS = [
  'auth.login.form.footer',
  'chat.sidebar.header',
  'chat.chat.list.item.trailing',
  'chat.turn.input.toolbar',
  'settings.panel.section',
  'ui-extension.app.content.routes',
  'ui-extension.runtime.devtools.panel',
] as const;

const DEFAULT_RUNTIME_ALLOWLIST = [
  'runtime.ai.text.generate',
  'runtime.ai.text.stream',
  'runtime.ai.embedding.generate',
  'runtime.media.image.generate',
  'runtime.media.image.stream',
  'runtime.media.video.generate',
  'runtime.media.video.stream',
  'runtime.media.tts.synthesize',
  'runtime.media.tts.stream',
  'runtime.media.tts.list.voices',
  'runtime.media.stt.transcribe',
  'runtime.media.jobs.submit',
  'runtime.media.jobs.get',
  'runtime.media.jobs.cancel',
  'runtime.media.jobs.subscribe',
  'runtime.media.jobs.get.artifacts',
  'runtime.voice.get.asset',
  'runtime.voice.list.assets',
  'runtime.voice.delete.asset',
  'runtime.voice.list.preset.voices',
  'runtime.route.list.options',
  'runtime.route.resolve',
  'runtime.route.check.health',
  'runtime.local.assets.list',
  'runtime.local.profiles.list',
  'runtime.local.profiles.install.request',
  'runtime.local.profiles.apply.status',
  'runtime.profile.read.agent',
] as const;

const DEFAULT_ACTION_ALLOWLIST = [
  'action.discover.*',
  'action.dry-run.*',
  'action.verify.*',
  'action.commit.*',
] as const;

const DEFAULT_STORAGE_ALLOWLIST = [
  'storage.files.read',
  'storage.files.write',
  'storage.files.delete',
  'storage.files.list',
  'storage.sqlite.query',
  'storage.sqlite.execute',
  'storage.sqlite.transaction',
] as const;

const DEFAULT_CODEGEN_ALLOWLIST = [
  'runtime.ai.text.generate',
  'runtime.ai.text.stream',
  'ui.register.ui-extension.app.*',
  'data.register.data-api.user-*.*.*',
  'data.query.data-api.user-*.*.*',
  'audit.read.self',
  'meta.read.self',
] as const;

export const DEFAULT_SOURCE_ALLOWLIST: Record<CapabilitySourceType, string[]> = {
  core: ['*'],
  builtin: [
    'event.publish.*',
    'event.subscribe.*',
    'data.query.*',
    'data.register.*',
    'ui.register.*',
    ...DEFAULT_STORAGE_ALLOWLIST,
    ...DEFAULT_RUNTIME_ALLOWLIST,
    ...DEFAULT_ACTION_ALLOWLIST,
    'audit.read.self',
    'meta.read.self',
    'meta.read.all',
  ],
  injected: [
    'event.publish.*',
    'event.subscribe.*',
    'data.query.*',
    'data.register.*',
    'ui.register.*',
    ...DEFAULT_STORAGE_ALLOWLIST,
    ...DEFAULT_RUNTIME_ALLOWLIST,
    ...DEFAULT_ACTION_ALLOWLIST,
    'audit.read.self',
    'meta.read.self',
  ],
  sideload: [
    'event.publish.*',
    'data.query.*',
    'ui.register.*',
    ...DEFAULT_STORAGE_ALLOWLIST,
    ...DEFAULT_RUNTIME_ALLOWLIST,
    ...DEFAULT_ACTION_ALLOWLIST,
    'audit.read.self',
    'meta.read.self',
  ],
  codegen: [...DEFAULT_CODEGEN_ALLOWLIST],
};
