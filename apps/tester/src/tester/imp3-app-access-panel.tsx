import { useCallback, useEffect, useState } from 'react';

import { getTesterLocalAppClient } from '../shell/local-app-runtime-platform.js';

type Fact = {
  readonly state: 'ready' | 'unavailable' | 'not-observed';
  readonly detail: string;
};

type CurrentUserFact = Fact & {
  readonly handle?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string | null;
};

type TesterHotContext = {
  readonly on: (event: 'vite:beforeUpdate', callback: () => void) => void;
  readonly off: (event: 'vite:beforeUpdate', callback: () => void) => void;
};

const testerHot = (import.meta as ImportMeta & { readonly hot?: TesterHotContext }).hot;

function boundedError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = typeof record.reasonCode === 'string' ? record.reasonCode : 'operation-failed';
  return reason.slice(0, 160);
}

export function Imp3AppAccessPanel() {
  const [access, setAccess] = useState<Fact>({ state: 'not-observed', detail: 'Checking App Access…' });
  const [currentUser, setCurrentUser] = useState<CurrentUserFact>({ state: 'not-observed', detail: 'Not observed' });
  const [storage, setStorage] = useState<Fact>({ state: 'not-observed', detail: 'Not run' });
  const [realmList, setRealmList] = useState<Fact>({ state: 'not-observed', detail: 'Not run' });
  const [denial, setDenial] = useState<Fact>({ state: 'not-observed', detail: 'Not run' });
  const [createPosture, setCreatePosture] = useState<Fact>({ state: 'not-observed', detail: 'Not run' });
  const [tooling, setTooling] = useState<Fact>({
    state: testerHot ? 'ready' : 'not-observed',
    detail: testerHot ? 'Vite HMR client active' : 'No official HMR client observed',
  });

  const refreshIdentity = useCallback(async () => {
    const testerLocalAppClient = getTesterLocalAppClient();
    try {
      const status = await testerLocalAppClient.auth.status();
      setAccess({
        state: status.sessionBound ? 'ready' : 'unavailable',
        detail: `${status.state} · ${status.reasonCode}`,
      });
    } catch (error) {
      setAccess({ state: 'unavailable', detail: boundedError(error) });
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
  }, []);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    if (!testerHot) return undefined;
    const onUpdate = () => setTooling({ state: 'ready', detail: `HMR update observed · ${new Date().toISOString()}` });
    testerHot.on('vite:beforeUpdate', onUpdate);
    return () => testerHot.off('vite:beforeUpdate', onUpdate);
  }, []);

  const runStorageRoundtrip = useCallback(async () => {
    setStorage({ state: 'not-observed', detail: 'Running…' });
    const value = { checkpoint: 'IMP3', marker: Date.now().toString(), nested: { ready: true } } as const;
    try {
      const testerLocalAppClient = getTesterLocalAppClient();
      const written = await testerLocalAppClient.storage.writeJson('imp3/roundtrip.json', value);
      const read = await testerLocalAppClient.storage.readJson('imp3/roundtrip.json');
      if (JSON.stringify(read.value) !== JSON.stringify(value) || written.sizeBytes !== read.sizeBytes) {
        throw new Error('storage-roundtrip-mismatch');
      }
      setStorage({ state: 'ready', detail: `JSON roundtrip · ${read.sizeBytes} bytes · ${value.marker}` });
    } catch (error) {
      setStorage({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runRealmList = useCallback(async () => {
    setRealmList({ state: 'not-observed', detail: 'Loading local Realm…' });
    try {
      const worlds = await getTesterLocalAppClient().realm.worldCore.list({ take: 10 });
      const first = worlds[0] as { readonly id?: unknown; readonly core?: { readonly identity?: { readonly name?: unknown } } } | undefined;
      const label = typeof first?.core?.identity?.name === 'string'
        ? first.core.identity.name
        : typeof first?.id === 'string' ? first.id : 'empty';
      setRealmList({ state: 'ready', detail: `${worlds.length} WorldCore DTO(s) · ${label}` });
    } catch (error) {
      setRealmList({ state: 'unavailable', detail: boundedError(error) });
    }
  }, []);

  const runLocalDenial = useCallback(async () => {
    setDenial({ state: 'not-observed', detail: 'Requesting undeclared runtime.consume…' });
    try {
      await getTesterLocalAppClient().ai.text.generateCandidate({
        messages: [{ role: 'user', text: 'This request must be denied before owner dispatch.' }],
        temperature: 0,
        topP: 1,
        maxTokens: 1,
      });
      setDenial({ state: 'unavailable', detail: 'Unexpected success' });
    } catch (error) {
      const reason = boundedError(error);
      setDenial({ state: reason === 'local-app-access-denied' ? 'ready' : 'unavailable', detail: reason });
    }
  }, []);

  const runCreatePosture = useCallback(async () => {
    setCreatePosture({ state: 'not-observed', detail: 'Checking unavailable owner…' });
    try {
      await getTesterLocalAppClient().realm.worldCore.create({
        core: {}, origin: { kind: 'manual' },
      } as never);
      setCreatePosture({ state: 'unavailable', detail: 'Unexpected success' });
    } catch (error) {
      const reason = boundedError(error);
      setCreatePosture({ state: reason === 'local-app-owner-unavailable' ? 'ready' : 'unavailable', detail: reason });
    }
  }, []);

  return (
    <section aria-labelledby="imp3-app-access-title" data-testid="imp3-app-access-panel" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle, #2f3542)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 id="imp3-app-access-title" style={{ margin: 0, fontSize: 16 }}>IMP3 App Access</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.72 }}>Current-user source-owned Runtime · Base storage · local Realm · fail-closed denial</p>
        </div>
        <button type="button" data-testid="imp3-refresh-access" onClick={() => void refreshIdentity()}>Refresh access</button>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, margin: '14px 0' }}>
        <FactRow testId="imp3-fact-app-running" label="App running" fact={{ state: 'ready', detail: `Renderer ${new Date(performance.timeOrigin).toISOString()}` }} />
        <FactRow testId="imp3-fact-nimi-access" label="Nimi access" fact={access} />
        <FactRow testId="imp3-fact-tooling" label="Official tooling" fact={tooling} />
      </dl>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: '0 0 14px' }}>
        <FactRow testId="imp3-current-user" label="Current User" fact={currentUser} />
        <FactRow testId="imp3-session-posture" label="Session posture" fact={access} />
      </dl>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Action label="Run Base JSON roundtrip" testId="imp3-run-storage" fact={storage} run={runStorageRoundtrip} />
        <Action label="List local WorldCores" testId="imp3-run-realm-list" fact={realmList} run={runRealmList} />
        <Action label="Prove local denial" testId="imp3-run-local-denial" fact={denial} run={runLocalDenial} />
        <Action label="Prove create unavailable" testId="imp3-run-create-unavailable" fact={createPosture} run={runCreatePosture} />
      </div>
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
