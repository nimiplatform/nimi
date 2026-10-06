import { describe, expect, it, vi } from 'vitest';
import { createNimiError, type NimiLocalAppClient, type NimiLocalAppAgentHandle } from '@nimiplatform/kit/core/sdk-contract';
import { createAgentReferenceVoiceController } from '../src/reference-voice.js';

function fixture() {
  let presentation: any = { presentationRevision: '1', defaultVoiceReference: '', profile: null };
  const target = { providerModelTarget: { model: 'selected-model' }, supportedFeatures: ['input.audio'], referenceAudioInput: { supportsUri: true, supportsBytes: true, textMode: 'unsupported', mimeTypes: ['audio/wav'] } };
  const selection = (capabilityContract: string) => ({ capabilityContract, state: 'ready', resource: { oneofKind: 'cloud', cloud: { connector: { connectorRef: 'owned-connector' }, target } } });
  const app: any = { config: null, revision: '1', effectiveSelections: [selection('voice.create')] };
  const shared: any = { config: null, revision: '2', effectiveSelections: [selection('audio.synthesize')] };
  const result: any = { job: { jobId: 'job-1', status: 'completed', reasonCode: '', reasonDetail: '' }, asset: { voiceAssetId: 'owned-voice', status: 'active' }, voiceReference: { kind: 'voice_asset_id', voiceAssetId: 'owned-voice' } };
  const missing = () => createNimiError({ reasonCode: 'AI_MEDIA_JOB_NOT_FOUND', message: 'not found', source: 'runtime', actionHint: 'submit' });
  const client: any = {
    agents: { getIntroduction: vi.fn(async () => ({ voiceSampleUrl: 'https://assets.example.test/current-greeting.wav' })) },
    aiConfig: { get: vi.fn(async () => app) },
    agentConfigure: {
      sharedAIConfig: { get: vi.fn(async () => shared), listOptions: vi.fn(async () => ({ kind: 'voice-assets', options: [{ voiceAssetId: 'owned-voice' }] })) },
      presentation: { snapshot: vi.fn(async () => presentation), commit: vi.fn(async (input) => {
        presentation = { ...presentation, presentationRevision: '2', defaultVoiceReference: input.intent.defaultVoiceReference }; return presentation;
      }) },
    },
    ai: { scenarioJobs: { lookupSubmission: vi.fn(async () => { throw missing(); }), submit: vi.fn(async () => ({ job: { jobId: 'job-1', status: 'running' } })), get: vi.fn(async () => result), cancel: vi.fn(async () => ({})) } },
  };
  const controller = createAgentReferenceVoiceController(client as NimiLocalAppClient, 'opaque-agent' as NimiLocalAppAgentHandle);
  return { client, controller, result, app, shared, setPresentation: (value: any) => { presentation = value; } };
}

describe('Agent reference voice owner journey', () => {
  it('does not create on refresh and uses the current greeting as the reference', async () => {
    const f = fixture(); await f.controller.refresh(); expect(f.controller.getSnapshot().phase).toBe('ready'); expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
    await f.controller.start(); expect(f.client.ai.scenarioJobs.submit.mock.calls[0][0]).toMatchObject({ creationSource: 'reference-audio', referenceAudio: { type: 'uri', uri: 'https://assets.example.test/current-greeting.wav' } });
    expect(f.client.agentConfigure.presentation.commit).toHaveBeenCalledWith(expect.objectContaining({ expectedPresentationRevision: '1', intent: { defaultVoiceReference: 'voice_asset_id:owned-voice' } }));
  });
  it('deduplicates concurrent clicks and reuses an already bound owner voice', async () => {
    const f = fixture(); const a = f.controller.start(); const b = f.controller.start(); expect(a).toBe(b); await a;
    await f.controller.refresh(); await f.controller.start(); expect(f.client.ai.scenarioJobs.submit).toHaveBeenCalledTimes(1); expect(f.client.agentConfigure.presentation.commit).toHaveBeenCalledTimes(1);
  });
  it('keeps an already bound voice even when no source sample is available', async () => {
    const f = fixture(); f.setPresentation({ presentationRevision: '2', defaultVoiceReference: 'voice_asset_id:owned-voice', profile: null });
    f.client.agents.getIntroduction.mockResolvedValue({ voiceSampleUrl: null }); await f.controller.refresh();
    expect(f.controller.getSnapshot().phase).toBe('bound'); await f.controller.start(); expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
  });
  it('uses a retained successful job without another paid create', async () => {
    const f = fixture(); f.client.ai.scenarioJobs.lookupSubmission.mockResolvedValue(f.result); await f.controller.start(); expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().phase).toBe('bound');
  });
  it.each(['AI_VOICE_ASSET_NOT_FOUND', 'AI_VOICE_ASSET_EXPIRED'])(
    'creates again only on the next explicit action after a retained asset is rejected as %s',
    async (reasonCode) => {
      const f = fixture();
      f.setPresentation({ presentationRevision: '1', defaultVoiceReference: 'voice_asset_id:owned-voice', profile: null });
      f.client.agentConfigure.sharedAIConfig.listOptions.mockResolvedValue({ kind: 'voice-assets', options: [] });
      let retainedSubmissionId: string | undefined;
      f.client.ai.scenarioJobs.lookupSubmission.mockImplementation(async (id: string) => {
        retainedSubmissionId ??= id;
        if (id === retainedSubmissionId) return f.result;
        throw createNimiError({ reasonCode: 'AI_MEDIA_JOB_NOT_FOUND', message: 'not found', source: 'runtime', actionHint: 'submit' });
      });
      f.client.agentConfigure.presentation.commit.mockRejectedValueOnce(createNimiError({ reasonCode, message: 'asset is no longer usable', source: 'runtime', actionHint: 'create_voice' }));
      f.client.ai.scenarioJobs.submit.mockResolvedValue({ job: { jobId: 'job-2', status: 'running' } });
      f.client.ai.scenarioJobs.get.mockResolvedValue({
        ...f.result, job: { ...f.result.job, jobId: 'job-2' },
        asset: { ...f.result.asset, voiceAssetId: 'new-voice' },
        voiceReference: { ...f.result.voiceReference, voiceAssetId: 'new-voice' },
      });

      await expect(f.controller.start()).rejects.toMatchObject({ reasonCode });
      await f.controller.refresh();
      expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
      await f.controller.start();

      expect(f.client.ai.scenarioJobs.submit).toHaveBeenCalledTimes(1);
      const retryId = f.client.ai.scenarioJobs.submit.mock.calls[0][1].clientSubmissionId;
      expect(retryId).not.toBe(retainedSubmissionId);
      expect(f.client.ai.scenarioJobs.lookupSubmission.mock.calls[1][0]).toBe(retryId);
      expect(f.client.agentConfigure.presentation.commit).toHaveBeenLastCalledWith(expect.objectContaining({
        expectedPresentationRevision: '1', intent: { defaultVoiceReference: 'voice_asset_id:new-voice' },
      }));
      expect(f.controller.getSnapshot().phase).toBe('bound');
    },
  );
  it.each([
    { reasonCode: null, readbackFails: false },
    { reasonCode: null, readbackFails: true },
    { reasonCode: 'AI_VOICE_ASSET_NOT_FOUND', readbackFails: true },
    { reasonCode: 'AI_VOICE_ASSET_EXPIRED', readbackFails: true },
  ])('retains the job after an unconfirmed bind ($reasonCode, readback failure: $readbackFails)', async ({ reasonCode, readbackFails }) => {
    const f = fixture();
    f.client.ai.scenarioJobs.lookupSubmission.mockResolvedValue(f.result);
    const error = reasonCode
      ? createNimiError({ reasonCode, message: 'asset rejected', source: 'runtime', actionHint: 'refresh' })
      : new Error('connection lost');
    f.client.agentConfigure.presentation.commit.mockRejectedValueOnce(error);
    if (readbackFails) {
      const presentation = { presentationRevision: '1', defaultVoiceReference: '', profile: null };
      f.client.agentConfigure.presentation.snapshot
        .mockResolvedValueOnce(presentation)
        .mockResolvedValueOnce(presentation)
        .mockRejectedValueOnce(new Error('readback unavailable'));
    }

    await expect(f.controller.start()).rejects.toBe(error);
    if (readbackFails) expect(f.controller.getSnapshot().reason).toBe('binding-unconfirmed');
    await f.controller.start();

    expect(f.client.ai.scenarioJobs.lookupSubmission.mock.calls[1][0]).toBe(f.client.ai.scenarioJobs.lookupSubmission.mock.calls[0][0]);
    expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().phase).toBe('bound');
  });
  it('does not submit after an unknown lookup failure', async () => {
    const f = fixture(); f.client.ai.scenarioJobs.lookupSubmission.mockRejectedValue(new Error('connection lost')); await expect(f.controller.start()).rejects.toThrow(); expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
  });
  it('requires compatible configured targets without changing either config', async () => {
    const f = fixture(); f.shared.effectiveSelections[0].resource = { oneofKind: 'local', local: {} }; await f.controller.refresh(); expect(f.controller.getSnapshot().reason).toBe('synthesis-configuration-required'); await expect(f.controller.start()).rejects.toThrow(); expect(f.client.ai.scenarioJobs.submit).not.toHaveBeenCalled();
    f.app.effectiveSelections = []; await f.controller.refresh(); expect(f.controller.getSnapshot().reason).toBe('creation-configuration-required');
  });
  it('does not use a different model or connector target', async () => {
    const f = fixture(); f.shared.effectiveSelections[0].resource.cloud = { connector: { connectorRef: 'another' }, target: { providerModelTarget: { model: 'selected-model' } } }; await f.controller.refresh(); expect(f.controller.getSnapshot().reason).toBe('configuration-incompatible');
  });
  it('does not bind a failed creation or overwrite a concurrent presentation edit', async () => {
    const f = fixture(); f.result.job.status = 'failed'; f.result.asset = null; f.result.voiceReference = null; await expect(f.controller.start()).rejects.toThrow(); expect(f.client.agentConfigure.presentation.commit).not.toHaveBeenCalled();
    const g = fixture(); g.client.ai.scenarioJobs.get.mockImplementation(async () => { g.setPresentation({ presentationRevision: '3', defaultVoiceReference: 'preset_voice_id:user-choice', profile: null }); return g.result; });
    await expect(g.controller.start()).rejects.toThrow('changed'); expect(g.client.agentConfigure.presentation.commit).not.toHaveBeenCalled();
  });
  it('fences cancellation during a late lookup and does not bind', async () => {
    const f = fixture(); let resolveLookup!: (v: any) => void; f.client.ai.scenarioJobs.lookupSubmission.mockImplementation(() => new Promise(resolve => { resolveLookup = resolve; }));
    const running = f.controller.start(); await vi.waitFor(() => expect(resolveLookup).toBeTypeOf('function')); await f.controller.cancel(); resolveLookup(f.result); await expect(running).rejects.toThrow('canceled'); expect(f.client.ai.scenarioJobs.cancel).toHaveBeenCalled(); expect(f.client.agentConfigure.presentation.commit).not.toHaveBeenCalled();
  });
  it('reconciles a committed bind whose response was lost', async () => {
    const f = fixture(); f.client.agentConfigure.presentation.commit.mockImplementation(async () => { f.setPresentation({ presentationRevision: '2', defaultVoiceReference: 'voice_asset_id:owned-voice', profile: null }); throw new Error('response lost'); });
    await f.controller.start(); expect(f.controller.getSnapshot().phase).toBe('bound'); expect(f.client.ai.scenarioJobs.submit).toHaveBeenCalledTimes(1);
  });
});
