import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterReferenceVoiceSection } from '../src/components/AgentCenterReferenceVoiceSection.js';
import type { AgentCenterSession, AgentCenterSnapshot, AgentCenterReferenceVoiceProjection } from '../src/types.js';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); container?.remove(); root = null; container = null; });
async function render(voice: AgentCenterReferenceVoiceProjection, appearance: Partial<AgentCenterSession['appearance']> = {}) {
  if (!root) {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  }
  const useVoice = vi.fn(async () => undefined); const openSetup = vi.fn();
  const session = { appearance: { useReferenceVoice: useVoice, ...appearance }, refresh: vi.fn(async () => undefined) } as unknown as AgentCenterSession;
  const snapshot = { state: { appearance: { referenceVoice: voice } }, availability: { replaceAppearance: { state: 'available' } } } as unknown as AgentCenterSnapshot;
  await act(async () => root!.render(<AgentCenterReferenceVoiceSection session={session} snapshot={snapshot} placementActions={{ openReferenceVoiceSetup: openSetup }} />));
  return { useVoice, openSetup, button: (text: string) => Array.from(container!.querySelectorAll('button')).find(x => x.textContent === text)! };
}
it('shows the selected sound and cost before an explicit create action', async () => {
  const f = await render({ phase: 'ready', sampleUrl: 'https://assets.example.test/greeting.wav', reason: null, reasonCode: null });
  expect(container!.querySelector('audio')?.getAttribute('src')).toBe('https://assets.example.test/greeting.wav');
  expect(container!.textContent).toContain('provider charges'); expect(f.useVoice).not.toHaveBeenCalled();
  await act(async () => f.button('Create and use voice').click()); expect(f.useVoice).toHaveBeenCalledTimes(1);
});
it('opens the correct existing setup scope without creating a voice', async () => {
  const f = await render({ phase: 'unavailable', sampleUrl: 'https://assets.example.test/greeting.wav', reason: 'creation-configuration-required', reasonCode: null });
  expect(f.button('Create and use voice')).toBeUndefined(); await act(async () => f.button('Configure service').click());
  expect(f.openSetup).toHaveBeenCalledWith('creation'); expect(f.useVoice).not.toHaveBeenCalled();
});

it.each(['create', 'cancel'] as const)('ignores a late %s failure after the Agent session changes', async (action) => {
  let reject!: (error: Error) => void;
  const operation = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const voice = { phase: 'ready' as const, sampleUrl: 'https://assets.example.test/greeting.wav', reason: null, reasonCode: null };
  const previous = await render({ ...voice, phase: action === 'create' ? 'ready' : 'creating' }, action === 'create'
    ? { useReferenceVoice: operation } : { cancelReferenceVoice: operation });
  await act(async () => {
    container!.querySelector('summary')!.click();
    previous.button(action === 'create' ? 'Create and use voice' : 'Cancel').click();
  });
  expect(operation).toHaveBeenCalledOnce();
  const current = await render(voice);
  await act(async () => { reject(new Error('previous Agent failed')); });
  expect(container!.textContent).not.toContain('Voice setup did not complete');
  expect(current.useVoice).not.toHaveBeenCalled();
});

it('retains a voice failure while its Agent session is still current', async () => {
  const operation = vi.fn(async () => { throw new Error('current Agent failed'); });
  const current = await render({ phase: 'ready', sampleUrl: null, reason: null, reasonCode: null }, { useReferenceVoice: operation });
  await act(async () => { current.button('Create and use voice').click(); });
  expect(container!.textContent).toContain('Voice setup did not complete');
});
