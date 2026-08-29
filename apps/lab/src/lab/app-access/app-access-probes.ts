// App Access probe runners: the real end-to-end orchestration behind each card.
// Every runner talks to the injected client port — in production the exact
// Lab local-App SDK client, in tests a structural mock. Nothing is mocked,
// cached, or simulated here: each probe walks SDK → bridge → carrier → Runtime.
// Pure module (no React) so node:test can cover the orchestration.

import type {
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
  NimiLocalAppPersonaCharacter,
  NimiLocalAppPersonaCharacterProfileInput,
} from '@nimiplatform/sdk/app';

import {
  runLabConversationInterruptJourney,
  runLabConversationJourney,
  type LabConversationPort,
} from '../local-app-conversation-journey.js';
import {
  appAccessHumanFailureKey,
  type AppAccessProbeId,
} from './app-access-catalog.js';

export type AppAccessProbeOutcome =
  | { readonly ok: true; readonly headline: string; readonly facts: readonly string[] }
  | { readonly ok: false; readonly headlineKey: string; readonly reasonCode: string; readonly detail?: string };

export type AppAccessAgentReferencesRun = {
  readonly outcome: AppAccessProbeOutcome;
  readonly references: readonly NimiLocalAppAgentReference[];
};

// Narrow structural port mirroring the exact SDK local-App client surface the
// probes use (the same pattern as LabConversationPort). The panel passes
// getLabLocalAppClient(); auth/currentUser stay with the session facts in
// the panel and are intentionally not part of probe orchestration.
export type AppAccessClientPort = Pick<
  NimiLocalAppClient,
  'storage' | 'realm' | 'ai' | 'agents'
> & {
  readonly conversation: LabConversationPort;
};

export function boundedReasonCode(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = typeof record.reasonCode === 'string' ? record.reasonCode : 'operation-failed';
  return reason.slice(0, 160);
}

function boundedDetail(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : '';
  if (!message) return undefined;
  return message.slice(0, 240);
}

function fail(error: unknown): AppAccessProbeOutcome {
  const reasonCode = boundedReasonCode(error);
  return {
    ok: false,
    // Failure headlines are catalog i18n keys; the probe card resolves them
    // through t() at render time so locale switches re-translate them.
    headlineKey: appAccessHumanFailureKey(reasonCode),
    reasonCode,
    detail: boundedDetail(error),
  };
}

function pass(headline: string, facts: readonly string[]): AppAccessProbeOutcome {
  return { ok: true, headline, facts };
}

// Opaque identifiers (agent handles, trace ids, WorldCore ids) are shown only
// in truncated form; raw payloads, credentials, and full internal ids never
// reach the page.
export function truncateOpaque(value: string, head = 12): string {
  if (value.length <= head + 1) return value;
  return `${value.slice(0, head)}…`;
}

async function requireRejection(
  operation: () => Promise<unknown>,
  expectedReason?: string,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    const reason = boundedReasonCode(error);
    if (expectedReason && reason !== expectedReason) {
      throw Object.assign(new Error('unexpected-rejection'), { reasonCode: reason });
    }
    return reason;
  }
  throw Object.assign(new Error('unexpected-success'), { reasonCode: 'unexpected-success' });
}

function worldCoreInput(marker: string) {
  const now = new Date().toISOString();
  return {
    origin: { kind: 'manual' },
    visibility: 'private',
    lorebookDeclaration: {
      identityBaseSetting: `Nimi Lab App Access World ${marker}.`,
      rolePlacements: [],
      worldRules: [],
    },
    core: {
      identity: {
        name: `App Access World ${marker}`,
        summary: 'A WorldCore created through the exact non-Agent App Access owner.',
        worldType: 'lab-app-access',
      },
      presentation: { title: `App Access World ${marker}`, tagline: 'Created by the Lab App.' },
      ontology: { entityKinds: ['person'], relationshipTypes: ['knows'] },
      timeModel: {
        mode: 'wallClockAnchored', flowRatio: 1, isPaused: false,
        anchor: { realStartedAt: now, worldStartedAt: now, worldStartedAtDisplay: now },
        pausedWorldTime: null, calendar: null, displayFormat: null,
      },
      timeline: { events: [] },
      entities: [], relationships: [], systems: [], scenes: [],
      assets: { resourceRefs: [], intents: [] },
      authoring: { source: 'nimi.lab.app-access', notes: ['real App Access journey'] },
    },
  } as const;
}

export async function runStorageIsolationProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  const marker = Date.now().toString();
  const path = 'app-access/app-private-roundtrip.json';
  const value = { checkpoint: 'app-access', marker, nested: { isolated: true } } as const;
  try {
    const storageClient = client.storage;
    const written = await storageClient.writeJson(path, value);
    const read = await storageClient.readJson(path);
    if (JSON.stringify(read.value) !== JSON.stringify(value) || written.sizeBytes !== read.sizeBytes) {
      throw Object.assign(new Error('storage-roundtrip-mismatch'), { reasonCode: 'storage-roundtrip-mismatch' });
    }
    const removed = await storageClient.removeJson(path);
    if (!removed.removed) {
      throw Object.assign(new Error('storage-remove-failed'), { reasonCode: 'storage-remove-failed' });
    }
    await requireRejection(() => storageClient.readJson(path));
    return pass('App-private JSON roundtrip verified', [
      'write → read-back identical → removed',
      'read after removal rejected',
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runStorageBoundaryProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  const marker = Date.now().toString();
  const value = { checkpoint: 'app-access', marker } as const;
  try {
    const storageClient = client.storage;
    await requireRejection(
      () => storageClient.writeJson('../app-access-traversal.json', value),
      'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
    );
    const oversizedPath = 'app-access/oversized.json';
    await requireRejection(
      () => storageClient.writeJson(oversizedPath, { value: 'x'.repeat(270 * 1024) }),
    );
    await storageClient.removeJson(oversizedPath).catch(() => undefined);
    return pass('Storage boundary holds', [
      'path escape rejected',
      'oversized write rejected',
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runWorldListProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const worlds = await client.realm.worldCore.list({ take: 10 });
    return pass('Local WorldCores listed', [`${worlds.length} WorldCore(s) returned`]);
  } catch (error) {
    return fail(error);
  }
}

export async function runWorldCreateProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const marker = Date.now().toString();
    const worldCore = client.realm.worldCore;
    const created = await worldCore.create(worldCoreInput(marker));
    const listed = await worldCore.list({ take: 100, visibility: 'private' });
    const read = listed.find((world) => world.id === created.id);
    if (!read || read.contentHash !== created.contentHash || read.core.identity.name !== created.core.identity.name) {
      throw Object.assign(new Error('world-core-list-read-mismatch'), { reasonCode: 'world-core-list-read-mismatch' });
    }
    const agentDraft = { homeWorldId: created.id } as const;
    return pass('WorldCore created and read-back verified', [
      `world ${truncateOpaque(created.id)} · content hash matches`,
      `home-world handoff value ready (${truncateOpaque(agentDraft.homeWorldId)}) · Agent owner not invoked`,
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runPersonaOwnerListProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const page = await client.realm.personaCharacter.listOwned({ take: 50 });
    const selected = page.items[0];
    if (!selected) return pass('Owner PersonaCharacter list is empty', ['canonical empty list returned']);
    const detail = await client.realm.personaCharacter.getOwned(selected.id);
    if (detail.id !== selected.id || detail.contentHash !== selected.contentHash) {
      throw Object.assign(new Error('persona-owner-detail-mismatch'), { reasonCode: 'persona-owner-detail-mismatch' });
    }
    return pass('Owner PersonaCharacters listed and read', [
      `${page.items.length} owner PersonaCharacter(s) returned · next page ${page.nextAfterId ? 'available' : 'none'}`,
      `${truncateOpaque(detail.id)} · revision ${detail.contentRevision} · hash ${truncateOpaque(detail.contentHash)}`,
      'owner identity, credential material, and Realm endpoint exposure: none',
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runPersonaOwnerCreateReplaceConflictProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const worlds = await client.realm.worldCore.list({ take: 10, visibility: 'private' });
    const world = worlds[0];
    if (!world) throw Object.assign(new Error('persona-owner-world-required'), { reasonCode: 'persona-owner-world-required' });
    const marker = createLabPersonaMarker();
    const lorebookDeclaration = labPersonaLorebookDeclaration(marker);
    const created = await client.realm.personaCharacter.create({
      worldId: world.id,
      visibility: 'private',
      origin: { kind: 'manual' },
      lorebookDeclaration,
      profile: labPersonaProfile(marker),
    });
    const detail = await client.realm.personaCharacter.getOwned(created.id);
    if (detail.contentHash !== created.contentHash || detail.contentRevision !== created.contentRevision) {
      throw Object.assign(new Error('persona-owner-create-detail-mismatch'), { reasonCode: 'persona-owner-create-detail-mismatch' });
    }
    if (detail.visibility === 'system') {
      throw Object.assign(new Error('persona-owner-system-write-forbidden'), { reasonCode: 'contract-invalid' });
    }
    if (!detail.lorebookDeclaration) {
      throw Object.assign(new Error('persona-owner-lorebook-declaration-missing'), { reasonCode: 'contract-invalid' });
    }
    const replaced = await client.realm.personaCharacter.replace({
      personaCharacterId: detail.id,
      baseContentHash: detail.contentHash,
      worldId: detail.worldId,
      visibility: detail.visibility,
      origin: detail.origin,
      lorebookDeclaration: detail.lorebookDeclaration,
      profile: {
        ...client.realm.personaCharacter.toProfileInput(detail.profile),
        narrative: {
          ...detail.profile.narrative,
          summary: `${detail.profile.narrative.summary} · replaced ${new Date().toISOString()}`,
        },
      },
    });
    if (replaced.contentHash === detail.contentHash || replaced.contentRevision === detail.contentRevision) {
      throw Object.assign(new Error('persona-owner-replace-did-not-advance'), { reasonCode: 'persona-owner-replace-did-not-advance' });
    }
    if (replaced.visibility === 'system') {
      throw Object.assign(new Error('persona-owner-system-write-forbidden'), { reasonCode: 'contract-invalid' });
    }
    const replacedLorebookDeclaration = replaced.lorebookDeclaration;
    if (!replacedLorebookDeclaration) {
      throw Object.assign(new Error('persona-owner-lorebook-declaration-missing'), { reasonCode: 'contract-invalid' });
    }
    const writableVisibility = replaced.visibility;
    await requireRejection(
      () => client.realm.personaCharacter.replace({
        personaCharacterId: replaced.id,
        baseContentHash: detail.contentHash,
        worldId: replaced.worldId,
        visibility: writableVisibility,
        origin: replaced.origin,
        lorebookDeclaration: replacedLorebookDeclaration,
        profile: client.realm.personaCharacter.toProfileInput(replaced.profile),
      }),
      'content-conflict',
    );
    return pass('Persistent owner PersonaCharacter create/replace flow completed', [
      `handle ${marker.handle} · id ${truncateOpaque(replaced.id)}`,
      `revision ${detail.contentRevision} → ${replaced.contentRevision}`,
      `hash ${truncateOpaque(detail.contentHash)} → ${truncateOpaque(replaced.contentHash)}`,
      'stale baseContentHash rejected as content-conflict',
      'test Persona persists because delete is not admitted',
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runPersonaOwnerPersistenceProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const persisted = await findPersistentLabPersona(client);
    if (!persisted) throw Object.assign(new Error('persona-owner-persistent-test-not-found'), { reasonCode: 'not-found' });
    const detail = await client.realm.personaCharacter.getOwned(persisted.id);
    return pass('Persistent owner PersonaCharacter recovered', [
      `handle ${detail.profile.identity.handle ?? 'missing'} · id ${truncateOpaque(detail.id)}`,
      `revision ${detail.contentRevision} · hash ${truncateOpaque(detail.contentHash)}`,
      'reload or Desktop/Lab restart uses listOwned/getOwned; no local login or fixture path',
    ]);
  } catch (error) {
    return fail(error);
  }
}

async function findPersistentLabPersona(
  client: AppAccessClientPort,
): Promise<NimiLocalAppPersonaCharacter | undefined> {
  let afterId: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await client.realm.personaCharacter.listOwned({
      take: 500,
      ...(afterId === undefined ? {} : { afterId }),
    });
    const persisted = page.items.find((persona) => (
      persona.profile.authoring.source === 'nimi.lab.realm-app-access'
      && persona.profile.identity.handle?.startsWith('nimi-lab-') === true
    ));
    if (persisted) return persisted;
    if (!page.nextAfterId) return undefined;
    if (page.nextAfterId === afterId || seenCursors.has(page.nextAfterId)) {
      throw Object.assign(new Error('persona-owner-pagination-did-not-advance'), { reasonCode: 'contract-invalid' });
    }
    seenCursors.add(page.nextAfterId);
    afterId = page.nextAfterId;
  }
}

function labPersonaProfile(marker: { readonly ulid: string; readonly handle: string }): NimiLocalAppPersonaCharacterProfileInput {
  const displayName = `Nimi Lab Persistent Test ${marker.ulid}`;
  return {
    profileSchemaVersion: 'realm.character-profile-core/v1',
    identity: { name: displayName, summary: 'Persistent private PersonaCharacter created by the Nimi Lab Realm App Access reference.', handle: marker.handle },
    presentation: { displayName, shortBio: 'Nimi Lab persistent owner-capability acceptance data.' },
    narrative: { summary: 'Nimi Lab owner PersonaCharacter acceptance.', traits: ['persistent-test'] },
    interactionProfile: { interactionModes: [], greeting: 'Hello from the Nimi Lab owner capability reference.' },
    assets: { resourceRefs: [], intents: [] },
    authoring: { source: 'nimi.lab.realm-app-access', notes: [`persistent-test:${marker.ulid}`] },
  };
}

function labPersonaLorebookDeclaration(marker: { readonly ulid: string; readonly handle: string }) {
  return {
    identity: `Nimi Lab Persona ${marker.ulid}`,
    behavior: ['Remain the explicitly authored Nimi Lab App Access test persona.'],
    speaking: ['Use the authored greeting and interaction profile.'],
    immutableBoundaries: ['Do not replace the authored identity or owner boundary.'],
    relationshipPostures: [],
  } as const;
}

function createLabPersonaMarker(): { readonly ulid: string; readonly handle: string } {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = Date.now();
  let encodedTime = '';
  for (let index = 0; index < 10; index += 1) {
    encodedTime = alphabet[time % 32]! + encodedTime;
    time = Math.floor(time / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let encodedRandom = '';
  for (let index = 0; index < 16; index += 1) encodedRandom += alphabet[random[index]! % 32];
  const ulid = `${encodedTime}${encodedRandom}`;
  return { ulid, handle: `nimi-lab-${ulid.toLowerCase()}` };
}

export async function runTextGenerationProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const result = await client.ai.text.generateCandidate({
      messages: [{ role: 'user', text: 'Return one short sentence confirming the current App AI configuration.' }],
      temperature: 0,
      topP: 1,
      // The Runtime budget includes provider-owned reasoning tokens. Keep the
      // probe bounded while leaving enough room for one visible sentence.
      maxTokens: 256,
    });
    return pass('Configured text generation completed', [
      'owner-managed App AI configuration',
      `finish ${result.finishReason} · trace ${truncateOpaque(result.traceId)}`,
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runAgentReferencesProbe(client: AppAccessClientPort): Promise<AppAccessAgentReferencesRun> {
  try {
    const references = await client.agents.listReferences();
    return {
      references,
      outcome: references.length > 0
        ? pass('Active Agent references listed', [
          `${references.length} active Agent reference(s)`,
          references.map((reference) => reference.displayName).join(', '),
        ])
        : pass('No active Agent reference available', ['current account has no active Agent']),
    };
  } catch (error) {
    return { references: [], outcome: fail(error) };
  }
}

export async function runAgentConversationProbe(
  client: AppAccessClientPort,
  reference: NimiLocalAppAgentReference,
): Promise<AppAccessProbeOutcome> {
  try {
    const result = await runLabConversationJourney({
      conversation: client.conversation,
      agentHandle: reference.agentHandle,
      requestId: `lab-app-access-${crypto.randomUUID()}`,
      text: 'Reply with one short sentence confirming the typed Agent conversation path.',
    });
    return pass('Typed Agent conversation completed', [
      `${reference.displayName} · agent ${truncateOpaque(reference.agentHandle)}`,
      `terminal ${result.terminalType} · ${result.terminalReason}`,
      `reply “${truncateOpaque(result.assistantText.trim(), 96)}”`,
    ]);
  } catch (error) {
    return fail(error);
  }
}

export async function runAgentInterruptProbe(
  client: AppAccessClientPort,
  reference: NimiLocalAppAgentReference,
): Promise<AppAccessProbeOutcome> {
  try {
    const result = await runLabConversationInterruptJourney({
      conversation: client.conversation,
      agentHandle: reference.agentHandle,
      requestId: `lab-app-access-interrupt-${crypto.randomUUID()}`,
      text: 'Begin a detailed response that can be explicitly interrupted for the typed Agent conversation path.',
    });
    return pass('Agent turn interrupted as requested', [
      `${reference.displayName} · agent ${truncateOpaque(reference.agentHandle)}`,
      `terminal ${result.terminalType} · ${result.terminalReason}`,
    ]);
  } catch (error) {
    return fail(error);
  }
}

export type AppAccessProbeRunInput = {
  readonly client: AppAccessClientPort;
  readonly agentReference: NimiLocalAppAgentReference | null;
};

export async function runAppAccessProbe(
  id: AppAccessProbeId,
  input: AppAccessProbeRunInput,
): Promise<AppAccessProbeOutcome> {
  switch (id) {
    case 'storage-isolation': return runStorageIsolationProbe(input.client);
    case 'storage-boundary': return runStorageBoundaryProbe(input.client);
    case 'world-list': return runWorldListProbe(input.client);
    case 'world-create': return runWorldCreateProbe(input.client);
    case 'persona-owner-list': return runPersonaOwnerListProbe(input.client);
    case 'persona-owner-create-replace': return runPersonaOwnerCreateReplaceConflictProbe(input.client);
    case 'persona-owner-persistence': return runPersonaOwnerPersistenceProbe(input.client);
    case 'text-generation': return runTextGenerationProbe(input.client);
    case 'agent-references': {
      const run = await runAgentReferencesProbe(input.client);
      return run.outcome;
    }
    case 'agent-conversation':
      if (!input.agentReference) return fail(Object.assign(new Error('agent-reference-required'), { reasonCode: 'agent-reference-required' }));
      return runAgentConversationProbe(input.client, input.agentReference);
    case 'agent-interrupt':
      if (!input.agentReference) return fail(Object.assign(new Error('agent-reference-required'), { reasonCode: 'agent-reference-required' }));
      return runAgentInterruptProbe(input.client, input.agentReference);
  }
}
