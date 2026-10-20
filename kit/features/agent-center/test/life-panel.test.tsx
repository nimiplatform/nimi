import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterLifePanel } from '../src/components/AgentCenterLifePanel.js';
import { sessionFor, testManagerActionAvailability } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;

it('lists retained intentions without a task management form', async () => {
  const session = await sessionFor({ manager: {
    life: { activities: [{ activityRef:'original',title:'Paused painting',kind:'project',phase:'paused',progress:20 }], revision:'1',current:null,recent:[],future:[],nextCheckAt:null,waitReason:'' },
    lifecycleStatus:'active',executionState:'idle',statusText:'',currentEmotion:'',source:null,context:null,conversationContext:null,actionAvailability:testManagerActionAvailability(),
  } });
  const container=document.createElement('div'); document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<AgentCenterLifePanel session={session} snapshot={session.getSnapshot()}/>));
  expect(document.body.textContent).toContain('Paused painting');
  expect(document.querySelector('form')).toBeNull();
});
