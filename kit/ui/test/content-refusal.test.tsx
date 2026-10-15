import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { NimiContentRefusalNotice } from '../src/app-chrome/content-refusal.js';
import { NimiAppChrome } from '../src/app-chrome/chrome.js';
import { TooltipProvider } from '../src/components/tooltip.js';
import { createNimiLocalAppStandardShellSurface } from '../../shell/renderer/src/bridge/local-app.js';
import { NIMI_STANDARD_SHELL_COMMANDS, NIMI_STANDARD_SHELL_UI_COMMANDS } from '../../shell/capabilities/src/index.js';
import { createNimiContentRefusalObserver, dismissNimiContentRefusalNotice, getNimiContentRefusalNotice, getNimiContentRefusalPresentationEpoch, nextNimiContentRefusalCorrelation, reportNimiContentRefusal, retireNimiContentRefusalPresentation, subscribeNimiContentRefusalNotice } from '../../shell/renderer/src/bridge/content-refusal.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; retireNimiContentRefusalPresentation(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const report = (metadata: unknown = {}) => reportNimiContentRefusal({ correlation: nextNimiContentRefusalCorrelation(), presentationEpoch: getNimiContentRefusalPresentationEpoch(), reasonCode: 'AI_CONTENT_FILTER_BLOCKED', metadata });

const submittedJob = { jobId: 'job-1', scenarioType: 'image-generate', status: 'submitted', progressPercent: 0,
  progressCurrentStep: 0, progressTotalSteps: 1, reasonCode: 'unspecified', reasonDetail: '', artifacts: [],
  traceId: 'trace', createdAt: null, updatedAt: null, transcriptionText: '' };
function installStreamHost(job: Record<string, unknown> = submittedJob) {
  let streamId = 0, generation = 0;
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  vi.stubGlobal('__NIMI_ELECTRON_TEST__', {
    invoke: async (command: string, input: { payload?: Record<string, unknown> }) => {
      if (command === NIMI_STANDARD_SHELL_UI_COMMANDS.chromeBind) return { generation: String(++generation), menuPlacement: 'window', windowDrag: false, geometry: { left: 0, right: 0, height: 32 }, zoomFactor: 1, fullscreen: false, nativeCommands: [], shortcuts: [] };
      if (command === NIMI_STANDARD_SHELL_UI_COMMANDS.chromeStateSet) return { updated: true };
      if (command === NIMI_STANDARD_SHELL_UI_COMMANDS.chromeUnbind) return { released: true };
      if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit']) return { job };
      if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobGet']) return { job, asset: null, voiceReference: null };
      if (input.payload?.action === 'cancel') return { subscriptionId: input.payload.subscriptionId, closed: true };
      const id = `stream-${++streamId}`; return { subscriptionId: id, eventName: id };
    },
    listen: (name: string, handler: (event: { payload: unknown }) => void) => { handlers.set(name, handler); return () => handlers.delete(name); },
  });
  return { surface: createNimiLocalAppStandardShellSurface(), currentId: () => `stream-${streamId}`,
    emit: (id: string, event: unknown) => handlers.get(id)?.({ payload: { subscriptionId: id, eventType: 'next', event } }) };
}

it('reports current Job failures once while preserving replay and stream delivery', async () => {
  const host = installStreamHost();
  const startedAt = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(startedAt);
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(<NimiContentRefusalNotice locale="en" />));
  const result = await host.surface.ai.scenarioJobs.submit({ type: 'image-generate', prompt: 'a mug', negativePrompt: '', size: '', aspectRatio: '', quality: '', style: '', referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '' });
  const sub = await host.surface.ai.scenarioJobs.subscribe(result.job.jobId);
  const id = host.currentId(), iterator = sub.events[Symbol.asyncIterator]();
  const failed = (at: number) => ({ eventType: 'failed', sequence: '3', traceId: 'trace',
    timestamp: { seconds: String(Math.floor(at / 1000)), nanos: at % 1000 * 1_000_000 },
    job: { ...submittedJob, status: 'failed', reasonCode: 'ai-content-filter-blocked' } });
  await act(async () => host.emit(id, failed(startedAt - 1000)));
  expect((await iterator.next()).value).toEqual(failed(startedAt - 1000));
  expect(getNimiContentRefusalNotice()).toBeNull();
  await act(async () => host.emit(id, failed(startedAt + 1)));
  expect((await iterator.next()).value).toEqual(failed(startedAt + 1));
  expect(document.querySelector('[aria-label="Content check notice"]')).not.toBeNull();
  const correlation = getNimiContentRefusalNotice()!.correlation;
  await act(async () => dismissNimiContentRefusalNotice(correlation));
  const second = await host.surface.ai.scenarioJobs.subscribe(result.job.jobId);
  await act(async () => host.emit(host.currentId(), failed(startedAt + 1)));
  await second.events[Symbol.asyncIterator]().next();
  expect(getNimiContentRefusalNotice()).toBeNull();
  await sub.cancel(); await second.cancel();
});

it('reports an image child refusal without failing its completed parent or colliding with another turn', async () => {
  const host = installStreamHost();
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(<><NimiContentRefusalNotice locale="en" /><textarea aria-label="Draft" defaultValue="Keep this draft" /></>));
  const request = { agentHandle: 'agent-ref', conversationAnchorId: 'anchor-1' };
  const first = await host.surface.conversation.subscribe(request);
  const firstId = host.currentId(), firstEvents = first.events[Symbol.asyncIterator]();
  const second = await host.surface.conversation.subscribe(request);
  const secondId = host.currentId(), secondEvents = second.events[Symbol.asyncIterator]();
  const failed = (turnId: string, reasonCode = 'AI_CONTENT_FILTER_BLOCKED') => ({ type: 'action-failed', conversationAnchorId: 'anchor-1', sequence: '1', turnId,
    action: { actionId: 'action-0', turnId, capabilityContract: 'image.generate', status: 'failed', projectionMessageId: null, artifactId: null, reasonCode, message: 'Image action failed.' } });
  await act(async () => host.emit(firstId, failed('turn-0', 'AI_PROVIDER_TIMEOUT')));
  expect((await firstEvents.next()).value).toEqual(failed('turn-0', 'AI_PROVIDER_TIMEOUT'));
  expect(getNimiContentRefusalNotice()).toBeNull();
  await act(async () => host.emit(firstId, failed('turn-1')));
  expect((await firstEvents.next()).value).toEqual(failed('turn-1'));
  const notice = getNimiContentRefusalNotice()!;
  expect(notice.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
  expect(node.textContent).toContain('You can keep using the app');
  expect((node.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Keep this draft');
  const completed = { type: 'turn-completed', conversationAnchorId: 'anchor-1', sequence: '2', turnId: 'turn-1', terminalReason: 'stop' };
  await act(async () => host.emit(firstId, completed));
  expect((await firstEvents.next()).value).toEqual(completed);
  await act(async () => dismissNimiContentRefusalNotice(notice.correlation));
  await act(async () => host.emit(secondId, failed('turn-1')));
  expect((await secondEvents.next()).value).toEqual(failed('turn-1'));
  expect(getNimiContentRefusalNotice()).toBeNull();
  await act(async () => host.emit(firstId, failed('turn-2')));
  expect((await firstEvents.next()).value).toEqual(failed('turn-2'));
  expect(getNimiContentRefusalNotice()?.correlation).not.toBe(notice.correlation);
  await act(async () => retireNimiContentRefusalPresentation());
  await act(async () => host.emit(firstId, failed('turn-3')));
  expect((await firstEvents.next()).value).toEqual(failed('turn-3'));
  expect(getNimiContentRefusalNotice()).toBeNull();
  await first.cancel(); await second.cancel();
});

it.each(['subscription', 'polling', 'submit-terminal', 'reused', 'retired'])('handles a new Job failing before its first watch without replaying old jobs: %s', async kind => {
  const startedAt = Date.now(); let clock = startedAt;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const stamp = (at: number) => ({ seconds: String(Math.floor(at / 1000)), nanos: at % 1000 * 1_000_000 });
  const terminal = kind === 'submit-terminal' || kind === 'reused';
  const job = { ...submittedJob, createdAt: stamp(kind === 'reused' ? startedAt - 1000 : startedAt),
    status: terminal ? 'failed' : 'submitted', reasonCode: terminal ? 'ai-content-filter-blocked' : 'unspecified' };
  const host = installStreamHost(job);
  const result = await host.surface.ai.scenarioJobs.submit({ type: 'image-generate', prompt: 'a mug', negativePrompt: '', size: '', aspectRatio: '', quality: '', style: '', referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '' });
  if (kind === 'submit-terminal') {
    expect(getNimiContentRefusalNotice()?.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
    return;
  }
  if (kind === 'retired') retireNimiContentRefusalPresentation();
  clock += 100;
  job.status = 'failed'; job.reasonCode = 'ai-content-filter-blocked';
  if (kind === 'polling') await host.surface.ai.scenarioJobs.get(result.job.jobId);
  else {
    const sub = await host.surface.ai.scenarioJobs.subscribe(result.job.jobId);
    const event = { eventType: 'failed', sequence: '3', traceId: 'trace', timestamp: stamp(startedAt + 1), job };
    host.emit(host.currentId(), event);
    expect((await sub.events[Symbol.asyncIterator]().next()).value).toEqual(event);
    await sub.cancel();
  }
  if (kind === 'reused' || kind === 'retired') expect(getNimiContentRefusalNotice()).toBeNull();
  else expect(getNimiContentRefusalNotice()?.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
});

it('keeps live failures visible after window Reconnect but retires them on real scope changes', async () => {
  const host = installStreamHost();
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  const render = (scopeKey: number) => <TooltipProvider><NimiAppChrome metadata={{ name: 'Test', version: '1' }} scopeKey={scopeKey} commands={[
    { id: 'test.failure', label: 'Window failure', menu: 'file', state: () => ({ enabled: true, visible: true }), execute: async () => { throw new Error('Window operation failed'); } },
  ]} /><textarea aria-label="Draft" defaultValue="Keep this draft" /></TooltipProvider>;
  await act(async () => root!.render(render(1)));
  const stream = await host.surface.ai.text.streamTurn({ messages: [{ role: 'user', text: 'ordinary request' }] });
  const id = host.currentId(), epoch = getNimiContentRefusalPresentationEpoch();
  const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
  await act(async () => button('File').click());
  await act(async () => button('Window failure').click());
  await act(async () => button('Reconnect').click());
  expect(getNimiContentRefusalPresentationEpoch()).toBe(epoch);
  const failure = { type: 'failed', sequence: '1', traceId: 'trace', reasonCode: 'ai-content-filter-blocked', actionHint: '' };
  await act(async () => host.emit(id, failure));
  expect((await stream.events[Symbol.asyncIterator]().next()).value).toEqual(failure);
  expect(getNimiContentRefusalNotice()?.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
  const old = await host.surface.ai.text.streamTurn({ messages: [{ role: 'user', text: 'old scope' }] });
  const oldId = host.currentId();
  await act(async () => root!.render(render(2)));
  await act(async () => host.emit(oldId, failure));
  expect((await old.events[Symbol.asyncIterator]().next()).value).toEqual(failure);
  expect(getNimiContentRefusalNotice()).toBeNull();
  expect(document.querySelector('textarea')!.value).toBe('Keep this draft');
  await stream.cancel(); await old.cancel();
});

it('keeps the draft and focus, shows a nonmodal notice and copies only safe constants', async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(<><textarea aria-label="Draft" defaultValue="Keep this draft" /><NimiContentRefusalNotice locale="zh" /></>));
  const draft = document.querySelector('textarea')!; draft.focus();
  await act(async () => report({ rule_id: 'github-classic-pat', failure_stage: 'input', matched_text: 'DO-NOT-COPY', provider_message: 'DO-NOT-COPY' }));
  expect(document.activeElement).toBe(draft); expect(draft.value).toBe('Keep this draft');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('应用仍可继续使用');
  expect(document.body.textContent).not.toContain('DO-NOT-COPY');
  expect(document.body.textContent).not.toContain('尚未发送');
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
  await act(async () => buttons().find(b => b.textContent === '复制安全诊断')!.click());
  expect(JSON.parse(copy.mock.calls[0]![0])).toEqual({ reasonCode: 'AI_CONTENT_FILTER_BLOCKED', ruleId: 'github-classic-pat', stage: 'input' });
  await act(async () => buttons().find(b => b.getAttribute('aria-label') === '关闭内容检查提醒')!.click());
  expect(document.querySelector('[role="status"]')).toBeNull(); expect(draft.value).toBe('Keep this draft');
});

it('announces a live Conversation failure even when subscribing after the turn started, once per turn', () => {
  const observe = createNimiContentRefusalObserver('conversation-test', true);
  const failure = { type: 'turn-failed', turnId: 'turn-1', conversationAnchorId: 'agent_anchor_test', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' };
  observe({ throughSequence: '1', activeTurn: null, lastTurn: { status: 'failed', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' } });
  expect(getNimiContentRefusalNotice()).toBeNull();
  observe(failure);
  expect(getNimiContentRefusalNotice()).toEqual({ correlation: 'conversation:agent_anchor_test:turn-1', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' });
  dismissNimiContentRefusalNotice(getNimiContentRefusalNotice()!.correlation);
  observe(failure); expect(getNimiContentRefusalNotice()).toBeNull();
});

it('does not suggest historical-context management for an unclassified Conversation refusal', async () => {
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(<NimiContentRefusalNotice locale="en" />));
  await act(async () => createNimiContentRefusalObserver('joined-turn', true)({
    type: 'turn-failed', turnId: 'turn-unknown', conversationAnchorId: 'anchor-unknown', reasonCode: 'AI_CONTENT_FILTER_BLOCKED',
  }));
  expect(document.body.textContent).toContain('You can keep using the app.');
  expect(document.body.textContent).toContain('No more specific public detail is available.');
  expect(document.body.textContent).not.toContain('Review conversation settings');
});

it('ignores retired presentation callbacks and does not turn a notice subscriber failure into a call failure', () => {
  const observe = createNimiContentRefusalObserver('retired-call');
  retireNimiContentRefusalPresentation();
  observe({ type: 'failed', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' });
  expect(getNimiContentRefusalNotice()).toBeNull();
  const stop = subscribeNimiContentRefusalNotice(() => { throw new Error('subscriber failed'); });
  expect(() => report()).not.toThrow(); stop();
  expect(getNimiContentRefusalNotice()?.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
});

it('shares turn correlation across overlapping live subscriptions without replacing a newer operation notice', () => {
  const first = createNimiContentRefusalObserver('subscription-a', true);
  const second = createNimiContentRefusalObserver('subscription-b', true);
  const started = { type: 'turn-started', turnId: 'turn-overlap', conversationAnchorId: 'anchor-overlap' };
  const failed = { ...started, type: 'turn-failed', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' };
  first(started); second(started); first(failed);
  report(); const newer = getNimiContentRefusalNotice(); second(failed);
  expect(getNimiContentRefusalNotice()).toBe(newer);
});

it('does not invent a rule from provider text or report permission failures as content checks', () => {
  reportNimiContentRefusal({ correlation: 'permission', presentationEpoch: getNimiContentRefusalPresentationEpoch(), reasonCode: 'PERMISSION_DENIED', metadata: { rule_id: 'pem-private-key' } });
  expect(getNimiContentRefusalNotice()).toBeNull();
  report({ rule_id: 'private-value', failure_stage: 'secret', content_part: 'secret' });
  expect(getNimiContentRefusalNotice()?.ruleId).toBeUndefined(); expect(getNimiContentRefusalNotice()?.stage).toBeUndefined();
});
