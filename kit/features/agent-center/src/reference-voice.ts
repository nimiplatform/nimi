import { asNimiError, type NimiLocalAppClient } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentCenterReferenceVoiceProjection } from './types.js';

type Client = Pick<NimiLocalAppClient, 'agents' | 'ai' | 'aiConfig' | 'agentConfigure'>;
type Handle = Parameters<Client['agents']['getIntroduction']>[0]['agentHandle'];
type Presentation = Awaited<ReturnType<Client['agentConfigure']['presentation']['snapshot']>>;
type JobResult = Awaited<ReturnType<Client['ai']['scenarioJobs']['get']>>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function submissionId(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return `agent_voice_${Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')}`;
}
function terminal(job: JobResult['job']): boolean {
  return ['completed', 'failed', 'canceled', 'timeout'].includes(job.status);
}

/** Coordinates existing owner calls; it owns no voice, route, source, or durable job store. */
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-004
export function createAgentReferenceVoiceController(client: Client, handle: Handle) {
  let state: AgentCenterReferenceVoiceProjection = { phase: 'loading', sampleUrl: null, reason: null, reasonCode: null };
  const listeners = new Set<() => void>();
  let disposed = false;
  let epoch = 0;
  let pending: Promise<Presentation> | null = null;
  let jobId: string | null = null;
  let failedJobId: string | null = null;
  let canceled = false;
  const publish = (next: AgentCenterReferenceVoiceProjection) => {
    if (disposed) return;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const assertCurrent = (version: number) => {
    if (disposed || epoch !== version || canceled) throw new Error('Reference voice action canceled.');
  };
  const prepare = async () => {
    const [introduction, presentation, app, shared] = await Promise.all([
      client.agents.getIntroduction({ agentHandle: handle }),
      client.agentConfigure.presentation.snapshot({ agentHandle: handle }),
      client.aiConfig.get().catch(error => {
        if (asNimiError(error).reasonCode === 'AI_CONFIG_NOT_FOUND') return { config: null, revision: '0', effectiveSelections: [] };
        throw error;
      }), client.agentConfigure.sharedAIConfig.get(),
    ]);
    const sampleUrl = introduction.voiceSampleUrl;
    const existing = presentation.defaultVoiceReference || presentation.profile?.defaultVoiceReference;
    if (existing?.startsWith('voice_asset_id:')) {
      const options = await client.agentConfigure.sharedAIConfig.listOptions({ kind: 'voice-assets' });
      if (options.kind === 'voice-assets' && options.options.some(x => `voice_asset_id:${x.voiceAssetId}` === existing)) {
        return { presentation, sampleUrl, reason: null, existing: true as const };
      }
    }
    if (!sampleUrl) return { presentation, sampleUrl, reason: 'reference-missing' as const };
    const creation = app.effectiveSelections.find(x => x.capabilityContract === 'voice.create');
    const synthesis = shared.effectiveSelections.find(x => x.capabilityContract === 'audio.synthesize');
    if (creation?.state !== 'ready' || creation.resource?.oneofKind !== 'cloud') {
      return { presentation, sampleUrl, reason: 'creation-configuration-required' as const };
    }
    if (synthesis?.state !== 'ready' || synthesis.resource?.oneofKind !== 'cloud') {
      return { presentation, sampleUrl, reason: 'synthesis-configuration-required' as const };
    }
    const create = creation.resource.cloud;
    const speech = synthesis.resource.cloud;
    const audio = create.target.referenceAudioInput;
    if (!create.target.supportedFeatures.includes('input.audio') || !audio?.supportsUri || audio.textMode === 'required') {
      return { presentation, sampleUrl, reason: 'reference-input-unsupported' as const };
    }
    if (create.connector.connectorRef !== speech.connector.connectorRef
      || canonical(create.target.providerModelTarget) !== canonical(speech.target.providerModelTarget)) {
      return { presentation, sampleUrl, reason: 'configuration-incompatible' as const };
    }
    return { presentation, sampleUrl, reason: null,
      identity: canonical({ sampleUrl, connector: create.connector.connectorRef, target: create.target.providerModelTarget }) };
  };
  const refresh = async () => {
    if (disposed || pending) return;
    const version = ++epoch;
    try {
      const prepared = await prepare();
      if (disposed || version !== epoch || pending) return;
      publish({ phase: prepared.existing ? 'bound' : prepared.reason ? 'unavailable' : 'ready', sampleUrl: prepared.sampleUrl,
        reason: prepared.reason, reasonCode: null });
    } catch (error) {
      if (disposed || version !== epoch || pending) return;
      publish({ phase: 'unavailable', sampleUrl: null, reason: 'owner-unavailable', reasonCode: asNimiError(error).reasonCode });
    }
  };
  const start = (): Promise<Presentation> => {
    if (pending) return pending;
    if (disposed) return Promise.reject(new Error('Agent Center session is no longer active.'));
    canceled = false;
    const version = ++epoch;
    pending = (async () => {
      try {
        const prepared = await prepare();
        assertCurrent(version);
        if (prepared.existing) return prepared.presentation;
        if (prepared.reason || !prepared.identity || !prepared.sampleUrl) {
          publish({ phase: 'unavailable', sampleUrl: prepared.sampleUrl, reason: prepared.reason ?? 'owner-unavailable', reasonCode: null });
          throw new Error('Reference voice setup is required.');
        }
        const sourceIdentity = prepared.identity;
        const id = await submissionId(sourceIdentity + (failedJobId ? `\nretry:${failedJobId}` : ''));
        assertCurrent(version);
        publish({ phase: 'creating', sampleUrl: prepared.sampleUrl, reason: null, reasonCode: null });
        let result: JobResult | null = null;
        try { result = await client.ai.scenarioJobs.lookupSubmission(id); }
        catch (error) {
          if (asNimiError(error).reasonCode !== 'AI_MEDIA_JOB_NOT_FOUND') throw error;
        }
        if (result && (disposed || epoch !== version || canceled)) {
          await client.ai.scenarioJobs.cancel(result.job.jobId, 'Reference voice action canceled.');
        }
        assertCurrent(version);
        if (!result) {
          const submitted = await client.ai.scenarioJobs.submit({ type: 'voice-create', creationSource: 'reference-audio',
            referenceAudio: { type: 'uri', uri: prepared.sampleUrl }, referenceAudioMime: '', languageHints: [], preferredName: '', text: '' },
          { clientSubmissionId: id });
          jobId = submitted.job.jobId;
          if (disposed || epoch !== version || canceled) {
            await client.ai.scenarioJobs.cancel(jobId, 'Reference voice action canceled.');
            assertCurrent(version);
          }
          result = await client.ai.scenarioJobs.get(jobId);
        } else jobId = result.job.jobId;
        while (!terminal(result.job)) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          assertCurrent(version);
          result = await client.ai.scenarioJobs.get(jobId!);
        }
        assertCurrent(version);
        if (result.job.status !== 'completed' || !result.asset || !result.voiceReference || result.asset.status !== 'active') {
          failedJobId = result.job.jobId;
          publish({ phase: result.job.status === 'canceled' ? 'canceled' : 'failed', sampleUrl: prepared.sampleUrl,
            reason: 'creation-failed', reasonCode: result.job.reasonCode || null });
          throw new Error(result.job.reasonDetail || 'Voice creation did not complete.');
        }
        const current = await prepare();
        assertCurrent(version);
        if (current.reason || current.identity !== sourceIdentity
          || current.presentation.presentationRevision !== prepared.presentation.presentationRevision) {
          throw new Error('Voice source, configuration or presentation changed. The created voice remains in your voice library.');
        }
        publish({ phase: 'binding', sampleUrl: prepared.sampleUrl, reason: null, reasonCode: null });
        const reference = `voice_asset_id:${result.voiceReference.voiceAssetId}`;
        let projection: Presentation;
        try {
          projection = await client.agentConfigure.presentation.commit({ agentHandle: handle,
            expectedPresentationRevision: prepared.presentation.presentationRevision,
            intent: { defaultVoiceReference: reference }, importedAssets: [] });
        } catch (commitError) {
          try { projection = await client.agentConfigure.presentation.snapshot({ agentHandle: handle }); }
          catch {
            publish({ ...state, phase: 'failed', reason: 'binding-unconfirmed', reasonCode: asNimiError(commitError).reasonCode });
            throw commitError;
          }
          if (projection.presentationRevision === prepared.presentation.presentationRevision
            || (projection.defaultVoiceReference || projection.profile?.defaultVoiceReference) !== reference) {
            const reasonCode = asNimiError(commitError).reasonCode;
            if (reasonCode === 'AI_VOICE_ASSET_NOT_FOUND' || reasonCode === 'AI_VOICE_ASSET_EXPIRED') {
              // A retained successful Job keeps its original asset snapshot.
              // Only this confirmed owner rejection permits a fresh explicit action.
              failedJobId = result.job.jobId;
            }
            throw commitError;
          }
        }
        assertCurrent(version);
        publish({ phase: 'bound', sampleUrl: prepared.sampleUrl, reason: null, reasonCode: null });
        failedJobId = null;
        return projection;
      } catch (error) {
        if (!disposed && epoch === version && !['unavailable', 'failed', 'canceled'].includes(state.phase)) {
          publish({ ...state, phase: canceled ? 'canceled' : 'failed', reason: 'creation-failed', reasonCode: asNimiError(error).reasonCode });
        }
        throw error;
      } finally { pending = null; jobId = null; }
    })();
    return pending;
  };
  const cancel = async () => {
    if (state.phase === 'binding') return;
    canceled = true;
    publish({ ...state, phase: 'canceled', reason: null, reasonCode: null });
    if (jobId) await client.ai.scenarioJobs.cancel(jobId, 'Reference voice action canceled.');
  };
  return { getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, start, cancel,
    dispose() { disposed = true; epoch++; canceled = true; state = Object.freeze({ ...state, phase: 'unavailable', reason: 'owner-unavailable' }); listeners.clear(); if (jobId) void client.ai.scenarioJobs.cancel(jobId, 'Agent Center closed.').catch(() => undefined); } };
}
export type AgentReferenceVoiceController = ReturnType<typeof createAgentReferenceVoiceController>;
