import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterReferenceVoiceSection } from '../src/components/AgentCenterReferenceVoiceSection.js';
import type { AgentCenterSession, AgentCenterSnapshot, AgentCenterReferenceVoiceProjection } from '../src/types.js';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); container?.remove(); root = null; container = null; });
async function render(voice: AgentCenterReferenceVoiceProjection) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  const useVoice = vi.fn(async () => undefined); const openSetup = vi.fn();
  const session = { appearance: { useReferenceVoice: useVoice }, refresh: vi.fn(async () => undefined) } as unknown as AgentCenterSession;
  const snapshot = { state: { appearance: { referenceVoice: voice } }, availability: { replaceAppearance: { state: 'available' } } } as unknown as AgentCenterSnapshot;
  await act(async () => root!.render(<AgentCenterReferenceVoiceSection session={session} snapshot={snapshot} placementActions={{ openReferenceVoiceSetup: openSetup }} />));
  return { useVoice, openSetup, button: (text: string) => Array.from(container!.querySelectorAll('button')).find(x => x.textContent === text)! };
}
it('shows the selected sound and cost before an explicit create action', async () => {
  const f = await render({ phase: 'ready', sampleUrl: 'https://assets.example.test/greeting.wav', reason: null, reasonCode: null });
  expect(container!.querySelector('audio')?.getAttribute('src')).toBe('https://assets.example.test/greeting.wav');
  expect(container!.textContent).toContain('provider charges'); expect(f.useVoice).not.toHaveBeenCalled();
  await act(async () => f.button('Use this voice').click()); expect(f.useVoice).toHaveBeenCalledTimes(1);
});
it('opens the correct existing setup scope without creating a voice', async () => {
  const f = await render({ phase: 'unavailable', sampleUrl: 'https://assets.example.test/greeting.wav', reason: 'creation-configuration-required', reasonCode: null });
  expect(f.button('Use this voice').disabled).toBe(true); await act(async () => f.button('Open configuration').click());
  expect(f.openSetup).toHaveBeenCalledWith('creation'); expect(f.useVoice).not.toHaveBeenCalled();
});
