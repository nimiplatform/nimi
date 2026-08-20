// App Access probe runners: the real end-to-end orchestration behind each card.
// Every runner talks to the injected client port — in production the exact
// Lab local-App SDK client, in tests a structural mock. Nothing is mocked,
// cached, or simulated here: each probe walks SDK → bridge → carrier → Runtime.
// Pure module (no React) so node:test can cover the orchestration.

import type { NimiLocalAppAgentReference, NimiLocalAppClient } from '@nimiplatform/sdk/app';

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

export async function runTextGenerationProbe(client: AppAccessClientPort): Promise<AppAccessProbeOutcome> {
  try {
    const result = await client.ai.text.generateCandidate({
      messages: [{ role: 'user', text: 'Return one short sentence confirming the current App AI configuration.' }],
      temperature: 0,
      topP: 1,
      maxTokens: 32,
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
