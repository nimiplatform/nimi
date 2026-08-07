import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

import { getTesterLocalAppClient } from '../shell/local-app-runtime-platform.js';
import {
  runTesterConversationInterruptJourney,
  runTesterConversationJourney,
} from './local-app-conversation-journey.js';

type Fact = {
  readonly state: 'ready' | 'unavailable' | 'not-observed';
  readonly detail: string;
};

type CurrentUserFact = Fact & {
  readonly handle?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
};

type CloudIntentDraft = {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
  readonly provider: string;
  readonly providerModelId: string;
};

type TesterHotContext = {
  readonly on: (event: 'vite:beforeUpdate', callback: () => void) => void;
  readonly off: (event: 'vite:beforeUpdate', callback: () => void) => void;
};

const testerHot = (import.meta as ImportMeta & { readonly hot?: TesterHotContext }).hot;
const notRun: Fact = { state: 'not-observed', detail: 'Not run' };

function boundedError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = typeof record.reasonCode === 'string' ? record.reasonCode : 'operation-failed';
  return reason.slice(0, 160);
}

async function requireRejection(
  operation: () => Promise<unknown>,
  expectedReason?: string,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    const reason = boundedError(error);
    if (expectedReason && reason !== expectedReason) {
      throw Object.assign(new Error('unexpected-rejection'), { reasonCode: reason });
    }
    return reason;
  }
  throw Object.assign(new Error('unexpected-success'), { reasonCode: 'unexpected-success' });
}

function localTextCapability() {
  return {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  } as const;
}

function exactDraftText(value: string): string {
  if (!value || value.trim() !== value || value.length > 256) {
    throw Object.assign(new Error('cloud-intent-field-invalid'), { reasonCode: 'cloud-intent-field-invalid' });
  }
  return value;
}

function cloudTextCapability(draft: CloudIntentDraft) {
  const stringValue = (value: string) => ({
    kind: { oneofKind: 'stringValue', stringValue: exactDraftText(value) },
  } as const);
  return {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: {
          implementationId: exactDraftText(draft.implementationId),
          driverId: exactDraftText(draft.driverId),
          driverDialect: exactDraftText(draft.driverDialect),
        },
        providerModelTarget: {
          fields: {
            provider: stringValue(draft.provider),
            providerModelId: stringValue(draft.providerModelId),
          },
        },
      },
    },
  } as const;
}

function hasBindingKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBindingKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    return ['binding', 'bindingid', 'connectorgrant', 'connectorgrantid', 'custody', 'custodymaterial', 'grantid'].includes(normalized)
      || hasBindingKey(entry);
  });
}

function worldCoreInput(marker: string) {
  const now = new Date().toISOString();
  return {
    origin: { kind: 'manual' },
    visibility: 'private',
    core: {
      identity: {
        name: `IMP4 App World ${marker}`,
        summary: 'A WorldCore created through the exact non-Agent App Access owner.',
        worldType: 'tester-reference',
      },
      presentation: { title: `IMP4 App World ${marker}`, tagline: 'Created by the Tester App.' },
      ontology: { entityKinds: ['person'], relationshipTypes: ['knows'] },
      timeModel: {
        mode: 'wallClockAnchored', flowRatio: 1, isPaused: false,
        anchor: { realStartedAt: now, worldStartedAt: now, worldStartedAtDisplay: now },
        pausedWorldTime: null, calendar: null, displayFormat: null,
      },
      timeline: { events: [] },
      entities: [], relationships: [], systems: [], scenes: [],
      assets: { resourceRefs: [], intents: [] },
      authoring: { source: 'nimi.tester.imp4', notes: ['real App Access journey'] },
    },
  } as const;
}

export function Imp4AppAccessPanel() {
  const [access, setAccess] = useState<Fact>({ state: 'not-observed', detail: 'Checking App Access…' });
  const [currentUser, setCurrentUser] = useState<CurrentUserFact>({ state: 'not-observed', detail: 'Not observed' });
  const [storage, setStorage] = useState<Fact>(notRun);
  const [realmList, setRealmList] = useState<Fact>(notRun);
  const [worldCreate, setWorldCreate] = useState<Fact>(notRun);
  const [homeWorld, setHomeWorld] = useState<Fact>(notRun);
  const [aiConfig, setAIConfig] = useState<Fact>(notRun);
  const [authorityRejection, setAuthorityRejection] = useState<Fact>(notRun);
  const [localText, setLocalText] = useState<Fact>(notRun);
  const [cloudSelection, setCloudSelection] = useState<Fact>(notRun);
  const [agentCatalog, setAgentCatalog] = useState<Fact>(notRun);
  const [agentReferences, setAgentReferences] = useState<readonly NimiLocalAppAgentReference[]>([]);
  const [selectedAgentHandle, setSelectedAgentHandle] = useState<string>('');
  const [agentConversation, setAgentConversation] = useState<Fact>(notRun);
  const [agentInterrupt, setAgentInterrupt] = useState<Fact>(notRun);
  const [cloudDraft, setCloudDraft] = useState<CloudIntentDraft>({
    implementationId: '', driverId: '', driverDialect: '', provider: '', providerModelId: '',
  });
  const [tooling, setTooling] = useState<Fact>({
    state: testerHot ? 'ready' : 'not-observed',
    detail: testerHot ? 'Vite HMR client active' : 'No official HMR client observed',
  });
  const runtimeLossLatched = useRef(false);

  const markRuntimeUnavailable = useCallback((reason: string) => {
    runtimeLossLatched.current = true;
    const unavailable = { state: 'unavailable', detail: reason } as const;
    setAccess(unavailable);
    setCurrentUser(unavailable);
    setStorage(unavailable);
    setRealmList(unavailable);
    setAuthorityRejection(unavailable);
  }, []);

  const refreshIdentity = useCallback(async () => {
    const testerLocalAppClient = getTesterLocalAppClient();
    try {
      const status = await testerLocalAppClient.auth.status();
      if (!status.sessionBound) {
        markRuntimeUnavailable(status.reasonCode);
      } else {
        runtimeLossLatched.current = false;
      }
      setAccess({
        state: status.sessionBound ? 'ready' : 'unavailable',
        detail: `${status.state} · ${status.reasonCode}`,
      });
    } catch (error) {
      markRuntimeUnavailable(boundedError(error));
    }
    try {
      const user = await testerLocalAppClient.currentUser.get();
      setCurrentUser({
        state: 'ready',
        detail: `${user.handle} · ${user.displayName} · avatar ${user.avatarUrl ?? 'none'}`,
        handle: user.handle, displayName: user.displayName, avatarUrl: user.avatarUrl,
      });
    } catch (error) {
      setCurrentUser({ state: 'unavailable', detail: boundedError(error) });
    }
  }, [markRuntimeUnavailable]);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const checkRuntime = async () => {
      if (disposed || checking || runtimeLossLatched.current) return;
      checking = true;
      try {
        const status = await getTesterLocalAppClient().auth.status();
        if (!status.sessionBound) markRuntimeUnavailable(status.reasonCode);
      } catch (error) {
        markRuntimeUnavailable(boundedError(error));
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void checkRuntime(), 100);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [markRuntimeUnavailable]);

  useEffect(() => {
    if (!testerHot) return undefined;
    const onUpdate = () => setTooling({ state: 'ready', detail: `HMR update observed · ${new Date().toISOString()}` });
    testerHot.on('vite:beforeUpdate', onUpdate);
    return () => testerHot.off('vite:beforeUpdate', onUpdate);
  }, []);

  const refreshAgentCatalog = useCallback(async () => {
    setAgentCatalog({ state: 'not-observed', detail: 'Loading current-account active Agents…' });
    try {
      const references = await getTesterLocalAppClient().agents.listReferences();
      setAgentReferences(references);
      setSelectedAgentHandle((current) => (
        references.some((reference) => reference.agentHandle === current)
          ? current
          : references[0]?.agentHandle ?? ''
      ));
      setAgentCatalog({
        state: references.length > 0 ? 'ready' : 'unavailable',
        detail: references.length > 0
          ? `${references.length} active Agent reference(s) · ${references.map((reference) => reference.displayName).join(', ')}`
          : 'No current-account active Agent is available',
      });
    } catch (error) {
      setAgentReferences([]);
      setSelectedAgentHandle('');
      setAgentCatalog({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runAgentConversation = useCallback(async () => {
    const reference = agentReferences.find((candidate) => candidate.agentHandle === selectedAgentHandle);
    if (!reference) {
      setAgentConversation({ state: 'unavailable', detail: 'agent-reference-required' });
      return;
    }
    setAgentConversation({ state: 'not-observed', detail: `Opening ${reference.displayName}…` });
    try {
      const result = await runTesterConversationJourney({
        conversation: getTesterLocalAppClient().conversation,
        agentHandle: reference.agentHandle,
        requestId: `tester-imp5-${crypto.randomUUID()}`,
        text: 'Reply with one short sentence confirming the IMP5 typed Agent conversation path.',
      });
      setAgentConversation({
        state: 'ready',
        detail: `${reference.displayName} · ${result.terminalType} · ${result.terminalReason} · ${result.assistantText}`,
      });
    } catch (error) {
      setAgentConversation({ state: 'unavailable', detail: boundedError(error) });
    }
  }, [agentReferences, selectedAgentHandle]);

  const runAgentInterrupt = useCallback(async () => {
    const reference = agentReferences.find((candidate) => candidate.agentHandle === selectedAgentHandle);
    if (!reference) {
      setAgentInterrupt({ state: 'unavailable', detail: 'agent-reference-required' });
      return;
    }
    setAgentInterrupt({ state: 'not-observed', detail: `Opening ${reference.displayName}…` });
    try {
      const result = await runTesterConversationInterruptJourney({
        conversation: getTesterLocalAppClient().conversation,
        agentHandle: reference.agentHandle,
        requestId: `tester-imp5-interrupt-${crypto.randomUUID()}`,
        text: 'Begin a detailed response that can be explicitly interrupted for the IMP5 typed Agent conversation path.',
      });
      setAgentInterrupt({
        state: 'ready',
        detail: `${reference.displayName} · ${result.terminalType} · ${result.terminalReason}`,
      });
    } catch (error) {
      setAgentInterrupt({ state: 'unavailable', detail: boundedError(error) });
    }
  }, [agentReferences, selectedAgentHandle]);

  const runStorageRoundtrip = useCallback(async () => {
    setStorage({ state: 'not-observed', detail: 'Running bounded App-private journey…' });
    const marker = Date.now().toString();
    const path = 'imp4/app-private-roundtrip.json';
    const value = { checkpoint: 'IMP4', marker, nested: { isolated: true } } as const;
    try {
      const storageClient = getTesterLocalAppClient().storage;
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
      await requireRejection(
        () => storageClient.writeJson('../imp4-traversal.json', value),
        'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
      );
      const oversizedPath = 'imp4/oversized.json';
      await requireRejection(
        () => storageClient.writeJson(oversizedPath, { value: 'x'.repeat(270 * 1024) }),
      );
      await storageClient.removeJson(oversizedPath).catch(() => undefined);
      setStorage({
        state: 'ready',
        detail: 'JSON roundtrip',
      });
    } catch (error) {
      setStorage({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runRealmList = useCallback(async () => {
    setRealmList({ state: 'not-observed', detail: 'Loading local Realm…' });
    try {
      const worlds = await getTesterLocalAppClient().realm.worldCore.list({ take: 10 });
      setRealmList({ state: 'ready', detail: `${worlds.length} WorldCore DTO(s)` });
    } catch (error) {
      setRealmList({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runLocalAIConfigAndText = useCallback(async () => {
    setAIConfig({ state: 'not-observed', detail: 'Whole-overwriting Local route…' });
    setLocalText({ state: 'not-observed', detail: 'Waiting for committed Local route…' });
    let configReady = false;
    try {
      const client = getTesterLocalAppClient();
      const saved = await client.aiConfig.overwrite([localTextCapability()]);
      const read = await client.aiConfig.get();
      const route = read.capabilities[0]?.route;
      if (saved.capabilities.length !== 1 || read.capabilities.length !== 1
        || route?.oneofKind !== 'local' || hasBindingKey(read)) {
        throw Object.assign(new Error('ai-config-readback-invalid'), { reasonCode: 'ai-config-readback-invalid' });
      }
      configReady = true;
      setAIConfig({ state: 'ready', detail: 'Portable App AIConfig whole overwrite + get · Local · no custody fields' });
      const result = await client.ai.text.generateCandidate({
        messages: [{ role: 'user', text: 'Return one short sentence confirming the IMP4 committed Local route.' }],
        temperature: 0,
        topP: 1,
        maxTokens: 32,
      });
      setLocalText({
        state: 'ready',
        detail: `Committed Local route · ${result.finishReason} · trace ${result.traceId}`,
      });
    } catch (error) {
      const detail = boundedError(error);
      if (!configReady) setAIConfig({ state: 'unavailable', detail });
      setLocalText({ state: 'unavailable', detail });
    }
  }, []);

  const runAuthorityRejection = useCallback(async () => {
    setAuthorityRejection({ state: 'not-observed', detail: 'Injecting forbidden owner and custody fields…' });
    try {
      const overwrite = getTesterLocalAppClient().aiConfig.overwrite;
      const capability = localTextCapability();
      const owner = await requireRejection(
        () => overwrite([{ ...capability, owner: { accountId: 'forbidden' } }] as never),
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
      );
      const custody = await requireRejection(
        () => overwrite([{
          ...capability,
          route: { oneofKind: 'local', local: { connectorGrantId: 'forbidden' } },
        }] as never),
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
      );
      setAuthorityRejection({ state: 'ready', detail: `owner ${owner} · custody ${custody}` });
    } catch (error) {
      setAuthorityRejection({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runCloudSelection = useCallback(async () => {
    setCloudSelection({ state: 'not-observed', detail: 'Saving grantless Cloud intent…' });
    try {
      const client = getTesterLocalAppClient();
      await client.aiConfig.overwrite([cloudTextCapability(cloudDraft)]);
      const read = await client.aiConfig.get();
      if (read.capabilities[0]?.route.oneofKind !== 'cloud' || hasBindingKey(read)) {
        throw Object.assign(new Error('cloud-readback-invalid'), { reasonCode: 'cloud-readback-invalid' });
      }
      const reason = await requireRejection(
        () => client.ai.text.generateCandidate({
          messages: [{ role: 'user', text: 'This grantless Cloud route must require a Nimi-owned binding selection.' }],
          temperature: 0,
          topP: 1,
          maxTokens: 8,
        }),
        'ai-connector-grant-selection-required',
      );
      setCloudSelection({ state: 'ready', detail: `Grantless Cloud intent persisted · ${reason}` });
    } catch (error) {
      setCloudSelection({ state: 'unavailable', detail: boundedError(error) });
    }
  }, [cloudDraft]);

  const runWorldCreate = useCallback(async () => {
    setWorldCreate({ state: 'not-observed', detail: 'Creating through Realm owner…' });
    setHomeWorld({ state: 'not-observed', detail: 'Waiting for generated WorldCore ID…' });
    try {
      const marker = Date.now().toString();
      const worldCore = getTesterLocalAppClient().realm.worldCore;
      const created = await worldCore.create(worldCoreInput(marker));
      const listed = await worldCore.list({ take: 100, visibility: 'private' });
      const read = listed.find((world) => world.id === created.id);
      if (!read || read.contentHash !== created.contentHash || read.core.identity.name !== created.core.identity.name) {
        throw Object.assign(new Error('world-core-list-read-mismatch'), { reasonCode: 'world-core-list-read-mismatch' });
      }
      const agentDraft = { homeWorldId: created.id } as const;
      setWorldCreate({ state: 'ready', detail: `Created + list/read verified · ${created.id}` });
      setHomeWorld({
        state: agentDraft.homeWorldId === created.id ? 'ready' : 'unavailable',
        detail: `Agent homeWorldId handoff · ${agentDraft.homeWorldId} · Agent owner not invoked in IMP4`,
      });
    } catch (error) {
      const detail = boundedError(error);
      setWorldCreate({ state: 'unavailable', detail });
      setHomeWorld({ state: 'unavailable', detail });
    }
  }, []);

  const updateCloudDraft = (field: keyof CloudIntentDraft, value: string) => {
    setCloudDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <section aria-labelledby="imp4-app-access-title" data-testid="imp4-app-access-panel" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle, #2f3542)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 id="imp4-app-access-title" style={{ margin: 0, fontSize: 16 }}>IMP4/IMP5 App Access</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.72 }}>Bounded non-Agent owners · active Agent references · typed text-only Conversation</p>
        </div>
        <button type="button" data-testid="imp4-refresh-access" onClick={() => void refreshIdentity()}>Refresh access</button>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, margin: '14px 0' }}>
        <FactRow testId="imp4-fact-app-running" label="App running" fact={{ state: 'ready', detail: `Renderer ${new Date(performance.timeOrigin).toISOString()}` }} />
        <FactRow testId="imp4-fact-nimi-access" label="Nimi access" fact={access} />
        <FactRow testId="imp4-fact-tooling" label="Official tooling" fact={tooling} />
        <FactRow testId="imp4-current-user" label="Current User" fact={currentUser} />
        <FactRow testId="imp4-ai-config" label="App AIConfig" fact={aiConfig} />
        <FactRow testId="imp4-local-text" label="Unary Local text" fact={localText} />
        <FactRow testId="imp4-world-create" label="WorldCore create/read" fact={worldCreate} />
        <FactRow testId="imp4-agent-home-world" label="Agent homeWorldId handoff" fact={homeWorld} />
        <FactRow testId="imp4-cloud-selection" label="Grantless Cloud posture" fact={cloudSelection} />
      </dl>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <Action label="Run storage isolation" testId="imp4-run-storage" fact={storage} run={runStorageRoundtrip} />
        <Action label="List local WorldCores" testId="imp4-run-realm-list" fact={realmList} run={runRealmList} />
        <Action label="Overwrite Local + generate" testId="imp4-run-local-ai" fact={localText} run={runLocalAIConfigAndText} />
        <Action label="Prove owner/custody rejection" testId="imp4-run-authority-rejection" fact={authorityRejection} run={runAuthorityRejection} />
        <Action label="Create + verify WorldCore" testId="imp4-run-world-create" fact={worldCreate} run={runWorldCreate} />
      </div>

      <fieldset style={{ margin: '0 0 14px', padding: 12, border: '1px solid var(--border-subtle, #2f3542)', borderRadius: 8 }}>
        <legend>IMP5 Agent reference + typed Conversation</legend>
        <div data-testid="imp5-agent-catalog" data-state={agentCatalog.state} style={{ marginBottom: 8 }}>
          {agentCatalog.state} · {agentCatalog.detail}
        </div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          Current active Agent
          <select
            data-testid="imp5-agent-select"
            value={selectedAgentHandle}
            onChange={(event) => setSelectedAgentHandle(event.currentTarget.value)}
            style={{ display: 'block', minWidth: 280, marginTop: 4 }}
          >
            {agentReferences.length === 0 ? <option value="">No active Agent</option> : null}
            {agentReferences.map((reference) => (
              <option key={reference.agentHandle} value={reference.agentHandle}>{reference.displayName}</option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Action label="List active Agent references" testId="imp5-run-agent-list" fact={agentCatalog} run={refreshAgentCatalog} />
          <Action label="Run typed Agent conversation" testId="imp5-run-conversation" fact={agentConversation} run={runAgentConversation} />
          <Action label="Run typed Agent interrupt" testId="imp5-run-agent-interrupt" fact={agentInterrupt} run={runAgentInterrupt} />
        </div>
      </fieldset>

      <fieldset style={{ margin: '0 0 14px', padding: 12, border: '1px solid var(--border-subtle, #2f3542)', borderRadius: 8 }}>
        <legend>Grantless Cloud intent (supply catalog-derived values; Tester has no provider/model defaults)</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {([
            ['implementationId', 'Implementation ID'], ['driverId', 'Driver ID'], ['driverDialect', 'Driver dialect'],
            ['provider', 'Provider'], ['providerModelId', 'Provider model ID'],
          ] as const).map(([field, label]) => (
            <label key={field} style={{ fontSize: 12 }}>
              {label}
              <input
                data-testid={`imp4-cloud-${field}`}
                value={cloudDraft[field]}
                onChange={(event) => updateCloudDraft(field, event.currentTarget.value)}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Action label="Save Cloud + prove selection-required" testId="imp4-run-cloud-selection" fact={cloudSelection} run={runCloudSelection} />
        </div>
      </fieldset>
    </section>
  );
}

function FactRow({ testId, label, fact }: { readonly testId: string; readonly label: string; readonly fact: Fact }) {
  return (
    <div data-testid={testId} data-state={fact.state} style={{ padding: 10, border: '1px solid var(--border-subtle, #2f3542)', borderRadius: 8 }}>
      <dt style={{ fontSize: 12, opacity: 0.7 }}>{label}</dt>
      <dd style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>{fact.state} · {fact.detail}</dd>
    </div>
  );
}

function Action({ label, testId, fact, run }: {
  readonly label: string;
  readonly testId: string;
  readonly fact: Fact;
  readonly run: () => Promise<void>;
}) {
  return (
    <div style={{ minWidth: 220, flex: '1 1 220px' }}>
      <button type="button" data-testid={testId} onClick={() => void run()}>{label}</button>
      <output data-testid={`${testId}-result`} data-state={fact.state} style={{ display: 'block', marginTop: 6, fontSize: 12, overflowWrap: 'anywhere' }}>
        {fact.state} · {fact.detail}
      </output>
    </div>
  );
}
