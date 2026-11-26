import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { nimiToast } from '@nimiplatform/kit/ui';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';

export const LEGACY_REUSABLE_INSTRUCTIONS_KEY = 'reusable-session-instructions.json';
export const INSTRUCTION_PRESETS_KEY = 'instruction-presets-v1.json';

export type InstructionPreset = { id: string; name: string; text: string };

function isNotFound(error: unknown): boolean {
  const code = extractNimiErrorFields(error).reasonCode;
  return code === 'APP_STORAGE_ENTRY_NOT_FOUND' || code === 'not-found';
}

async function readInstructionPresets(scope: NimiAppScope): Promise<InstructionPreset[]> {
  try {
    const { value } = await scope.client.storage.readJson(INSTRUCTION_PRESETS_KEY);
    if (!Array.isArray(value) || !value.every((item): item is InstructionPreset =>
      isJsonObject(item) && typeof item.id === 'string' && typeof item.name === 'string'
      && typeof item.text === 'string' && item.text.length <= 4000,
    )) throw new Error('Invalid instruction presets.');
    return value;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    const { value } = await scope.client.storage.readJson(LEGACY_REUSABLE_INSTRUCTIONS_KEY);
    return typeof value === 'string' && value.trim() && value.length <= 4000
      ? [{ id: 'legacy-default', name: 'Saved instructions', text: value }]
      : [];
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return [];
  }
}

async function writeInstructionPresets(
  scope: NimiAppScope,
  next: readonly InstructionPreset[],
): Promise<void> {
  scope.signal.throwIfAborted();
  await scope.client.storage.writeJson(INSTRUCTION_PRESETS_KEY, [...next]);
  // Keep legacy key mirrored with first preset for backward compatibility across versions.
  if (next.length > 0) {
    await scope.client.storage.writeJson(LEGACY_REUSABLE_INSTRUCTIONS_KEY, next[0].text).catch(() => {});
  } else {
    await scope.client.storage.removeJson(LEGACY_REUSABLE_INSTRUCTIONS_KEY).catch(() => {});
  }
  scope.signal.throwIfAborted();
}

type PresetEdit = (current: InstructionPreset[]) => InstructionPreset[];

function createInstructionPresets(scope: NimiAppScope) {
  let committed: InstructionPreset[] = [];
  let visible: InstructionPreset[] | null = null;
  let loading: Promise<void> | undefined;
  let lastWrite = Promise.resolve();
  const pending: PresetEdit[] = [];
  const listeners = new Set<() => void>();
  // Items keep their list position while a deletion can still be undone.
  const positions = new WeakMap<InstructionPreset, number>();
  let firstPosition = 0;

  function publish() {
    visible = pending.reduce((items, edit) => edit(items), committed);
    for (const listener of listeners) listener();
  }

  function update(edit: PresetEdit): Promise<void> {
    if (visible === null) throw new Error('Instruction presets have not loaded.');
    pending.push(edit);
    const result = lastWrite.then(async () => {
      try {
        const next = edit(committed);
        await writeInstructionPresets(scope, next);
        committed = next;
      } finally {
        // Later edits are still visible and will be written against the last successful list.
        pending.shift();
        publish();
      }
    });
    lastWrite = result.catch(() => {});
    publish();
    return result;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => visible,
    load(): Promise<void> {
      if (visible !== null) return Promise.resolve();
      loading ??= readInstructionPresets(scope).then(items => {
        scope.signal.throwIfAborted();
        items.forEach((item, index) => positions.set(item, index));
        committed = items;
        publish();
      }).finally(() => { loading = undefined; });
      return loading;
    },
    add(preset: InstructionPreset) {
      positions.set(preset, --firstPosition);
      return update(items => [preset, ...items]);
    },
    remove(preset: InstructionPreset) {
      const removed = visible?.find(item => item.id === preset.id);
      if (!removed) return null;
      const position = positions.get(removed)!;
      const saved = update(items => items.filter(item => item.id !== removed.id));
      const undo = () => update(items => {
        if (items.some(item => item.id === removed.id)) return items;
        const successor = items.findIndex(item => positions.get(item)! > position);
        const at = successor < 0 ? items.length : successor;
        return [...items.slice(0, at), removed, ...items.slice(at)];
      });
      return { saved, undo };
    },
  };
}

const stores = new WeakMap<NimiAppScope, ReturnType<typeof createInstructionPresets>>();

export function presetsForScope(scope: NimiAppScope) {
  let store = stores.get(scope);
  if (!store) {
    store = createInstructionPresets(scope);
    stores.set(scope, store);
  }
  return store;
}

export function deleteInstructionPresetOptimistically({
  preset,
  scope,
  onError,
  message,
  undoLabel,
  trackToastId,
  untrackToastId,
}: {
  preset: InstructionPreset;
  scope: NimiAppScope;
  onError: (message: string) => void;
  message: string;
  undoLabel: string;
  trackToastId?: (id: string) => void;
  untrackToastId?: (id: string) => void;
}): string | null {
  const deletion = presetsForScope(scope).remove(preset);
  if (!deletion) return null;

  let undone = false;
  const toastId = nimiToast.info(message, {
    durationMs: 6000,
    action: {
      label: undoLabel,
      onClick: () => {
        if (undone || scope.signal.aborted) return;
        undone = true;
        untrackToastId?.(toastId);
        void deletion.undo().catch((error) => {
          if (scope.signal.aborted) return;
          onError(error instanceof Error ? error.message : String(error));
        });
      },
    },
  });
  trackToastId?.(toastId);

  void deletion.saved.catch((error) => {
    untrackToastId?.(toastId);
    nimiToast.dismiss(toastId);
    if (undone || scope.signal.aborted) return;
    onError(error instanceof Error ? error.message : String(error));
  });

  return toastId;
}
