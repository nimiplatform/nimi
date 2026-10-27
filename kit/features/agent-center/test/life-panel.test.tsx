import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterLifePanel } from '../src/components/AgentCenterLifePanel.js';
import { sessionFor, testManagerActionAvailability } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;

it('keeps retained intentions in a disclosure without a task management form', async () => {
  const session = await sessionFor({ manager: {
    life: { activities: [{ activityRef:'original',title:'Paused painting',kind:'project',phase:'paused',progress:20 }], revision:'1',current:null,recent:[],future:[],nextCheckAt:null,waitReason:'' },
    lifecycleStatus:'active',executionState:'idle',statusText:'',currentEmotion:'',source:null,context:null,conversationContext:null,actionAvailability:testManagerActionAvailability(),
  } });
  const container=document.createElement('div'); document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<AgentCenterLifePanel session={session} snapshot={session.getSnapshot()}/>));
  const details = document.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('Things to continue · 1');
  await act(async()=>{ (details.querySelector('summary') as HTMLElement).click(); await Promise.resolve(); });
  expect(details.open).toBe(true);
  expect(details.textContent).toContain('Paused painting');
  expect(document.querySelector('form')).toBeNull();
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
  session.dispose();
});

it('shows the committed paused state without inventing an activity', async () => {
  const session = await sessionFor();
  const container=document.createElement('div'); document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<AgentCenterLifePanel session={session} snapshot={session.getSnapshot()}/>));
  expect(document.body.textContent).toContain('Autonomous life is currently paused.');
  expect(document.body.textContent).toContain('Paused');
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
  session.dispose();
});

it('shows refresh progress until the owner refresh completes', async () => {
  const session = await sessionFor();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const refresh = vi.spyOn(session, 'refresh').mockReturnValue(pending);
  const container=document.createElement('div'); document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<AgentCenterLifePanel session={session} snapshot={session.getSnapshot()}/>));
  await act(async()=>{ button('Refresh').click(); await Promise.resolve(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(button('Refreshing…').disabled).toBe(true);
  expect(document.querySelector('section[aria-label="Life updates"]')?.getAttribute('aria-busy')).toBe('true');
  await act(async()=>{ release(); await Promise.resolve(); });
  expect(button('Refresh').disabled).toBe(false);
  expect(document.querySelector('section[aria-label="Life updates"]')?.getAttribute('aria-busy')).toBe('false');
  session.dispose();
});

it('places refresh failure feedback next to the refresh action', async () => {
  const session = await sessionFor();
  vi.spyOn(session, 'refresh').mockRejectedValue(new Error('owner unavailable'));
  const container=document.createElement('div'); document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<AgentCenterLifePanel session={session} snapshot={session.getSnapshot()}/>));
  await act(async()=>{ button('Refresh').click(); await Promise.resolve(); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not refresh life updates.');
  expect(button('Refresh').disabled).toBe(false);
  session.dispose();
});
