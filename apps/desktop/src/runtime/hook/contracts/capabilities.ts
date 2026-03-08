import type { HookSourceType, TurnHookPoint } from './types.js';

export type HookCapabilityKey = string;

export const DEFAULT_TURN_HOOK_POINTS = [
  'pre-policy',
  'pre-model',
  'post-state',
  'pre-commit',
] as const satisfies TurnHookPoint[];

export const DEFAULT_UI_SLOTS = [
  'auth.login.form.footer',
  'chat.sidebar.header',
  'chat.chat.list.item.trailing',
  'chat.turn.input.toolbar',
  'settings.panel.section',
  'ui-extension.app.sidebar.mods',
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
  'runtime.local.artifacts.list',
  'runtime.profile.read.agent',
] as const;

const DEFAULT_ACTION_ALLOWLIST = [
  'action.discover.*',
  'action.dry-run.*',
  'action.verify.*',
  'action.commit.*',
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

export const DEFAULT_SOURCE_ALLOWLIST: Record<HookSourceType, string[]> = {
  // `builtin` is retained as a permission-source taxonomy key.
  // Default desktop mods are loaded via manifest+sideload pipeline.
  core: ['*'],
  builtin: [
    'event.publish.*',
    'event.subscribe.*',
    'data.query.*',
    'data.register.*',
    'turn.register.*',
    'ui.register.*',
    'inter-mod.request.*',
    'inter-mod.provide.*',
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
    'turn.register.pre-model',
    'turn.register.post-state',
    'ui.register.*',
    'inter-mod.request.*',
    ...DEFAULT_RUNTIME_ALLOWLIST,
    ...DEFAULT_ACTION_ALLOWLIST,
    'audit.read.self',
    'meta.read.self',
  ],
  sideload: [
    'event.publish.*',
    'data.query.*',
    'ui.register.*',
    'inter-mod.request.*',
    ...DEFAULT_RUNTIME_ALLOWLIST,
    ...DEFAULT_ACTION_ALLOWLIST,
    'audit.read.self',
    'meta.read.self',
  ],
  codegen: [...DEFAULT_CODEGEN_ALLOWLIST],
};

export function eventPublishCapability(topic: string): HookCapabilityKey {
  return `event.publish.${String(topic || '').trim()}`;
}

export function eventSubscribeCapability(topic: string): HookCapabilityKey {
  return `event.subscribe.${String(topic || '').trim()}`;
}

export function dataQueryCapability(name: string): HookCapabilityKey {
  return `data.query.${String(name || '').trim()}`;
}

export function dataRegisterCapability(name: string): HookCapabilityKey {
  return `data.register.${String(name || '').trim()}`;
}

export function turnRegisterCapability(point: string): HookCapabilityKey {
  return `turn.register.${String(point || '').trim()}`;
}

export function uiRegisterCapability(slot: string): HookCapabilityKey {
  return `ui.register.${String(slot || '').trim()}`;
}

export function interModRequestCapability(channel: string): HookCapabilityKey {
  return `inter-mod.request.${String(channel || '').trim()}`;
}

export function interModProvideCapability(channel: string): HookCapabilityKey {
  return `inter-mod.provide.${String(channel || '').trim()}`;
}

export function normalizeCapabilityKey(value: string): HookCapabilityKey {
  return String(value || '').trim();
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
    const escaped = normalizedPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const wildcardRegex = new RegExp(`^${escaped}$`);
    return wildcardRegex.test(normalizedCapability);
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
