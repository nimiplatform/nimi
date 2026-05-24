import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPersistedDraft,
  createEmptyDraft,
  draftIsSubmittable,
  loadPersistedDraft,
  persistDraft,
  persistedDraftHasContent,
} from '../src/shell/renderer/features/world/create-agent/realm-agent-creation-draft';
import { mapCharacterCardToDraft } from '../src/shell/renderer/features/world/create-agent/character-card-draft-mapper';
import type { TavernCardV2 } from '@nimiplatform/kit/core/character-card';

// Minimal in-memory localStorage so the persistence helpers exercise their
// real code path under `tsx --test` (which has no DOM storage).
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

test('createEmptyDraft seeds the owning world and a passive/published draft', () => {
  const draft = createEmptyDraft('world-1');
  assert.equal(draft.worldId, 'world-1');
  assert.equal(draft.mode, 'manual_quick_create');
  assert.equal(draft.fields.wakeStrategy, 'PASSIVE');
  assert.equal(draft.fields.visibility, 'PUBLISHED');
  assert.deepEqual(draft.warnings, []);
});

test('draftIsSubmittable requires handle and concept', () => {
  const draft = createEmptyDraft('world-1');
  assert.equal(draftIsSubmittable(draft), false);
  draft.fields.handle = 'archivist';
  assert.equal(draftIsSubmittable(draft), false);
  draft.fields.concept = 'A keeper of star maps.';
  assert.equal(draftIsSubmittable(draft), true);
});

test('persistDraft / loadPersistedDraft round-trips a draft for recoverability', () => {
  installMemoryLocalStorage();
  clearPersistedDraft('world-2');
  const draft = createEmptyDraft('world-2', 'ai_assisted_generation');
  draft.fields.handle = 'cartographer';
  draft.fields.concept = 'Collects forgotten star maps.';
  draft.fields.secondaryTraits = ['WISE'];
  persistDraft(draft);

  const recovered = loadPersistedDraft('world-2');
  assert.ok(recovered);
  assert.equal(recovered.fields.handle, 'cartographer');
  assert.equal(recovered.mode, 'ai_assisted_generation');
  assert.deepEqual(recovered.fields.secondaryTraits, ['WISE']);
  assert.equal(persistedDraftHasContent(recovered), true);

  clearPersistedDraft('world-2');
  assert.equal(loadPersistedDraft('world-2'), null);
});

test('persistedDraftHasContent is false for an untouched draft', () => {
  assert.equal(persistedDraftHasContent(createEmptyDraft('world-3')), false);
  assert.equal(persistedDraftHasContent(null), false);
});

function buildCard(): TavernCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Ari the Archivist',
      description: 'A time-traveling archivist.',
      personality: 'Precise and warm.',
      scenario: 'The archive-city floats over a broken sea.',
      first_mes: 'Welcome back to the stacks.',
      mes_example: 'Ari adjusts her glasses.',
      creator_notes: '',
      system_prompt: 'Stay in character.',
      post_history_instructions: '',
      alternate_greetings: ['The archive doors are open.'],
      character_book: undefined,
      tags: ['floating-city'],
      creator: 'nimi',
      character_version: '1.0',
      extensions: {},
    },
  };
}

test('mapCharacterCardToDraft fills creation fields and derives a handle', () => {
  const draft = mapCharacterCardToDraft('world-4', buildCard(), 'ari.json', []);
  assert.equal(draft.mode, 'character_card_import');
  assert.equal(draft.fields.displayName, 'Ari the Archivist');
  assert.equal(draft.fields.handle, 'ari_the_archivist');
  assert.equal(draft.fields.scenario, 'The archive-city floats over a broken sea.');
  assert.equal(draft.fields.greeting, 'Welcome back to the stacks.');
  assert.equal(draft.sourceLabel, 'ari.json');
});

test('mapCharacterCardToDraft surfaces unsupported card fields as warnings, never silently writes them', () => {
  const draft = mapCharacterCardToDraft('world-4', buildCard(), 'ari.json', ['data.creator_notes is empty']);
  const messages = draft.warnings.map((warning) => warning.message);
  // system_prompt / mes_example / tags / alternate_greetings have no
  // lightweight-creation home — each must be reported, not dropped silently.
  assert.ok(messages.some((message) => message.includes('alternate greeting')));
  assert.ok(messages.some((message) => message.includes('mes_example')));
  assert.ok(messages.some((message) => message.includes('system_prompt')));
  assert.ok(messages.some((message) => message.includes('tags')));
  // Parser-level warnings are carried through too.
  assert.ok(messages.some((message) => message.includes('creator_notes')));
});
