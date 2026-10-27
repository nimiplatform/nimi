import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterCognitionSection } from '../src/components/AgentCenterCognitionSection.js';
import { useAgentCenterStore } from '../src/store.js';
import type { AgentCenterSession } from '../src/types.js';
import { sessionFor } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
let session: AgentCenterSession | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  session?.dispose();
  root = null;
  session = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function Harness({ session }: { session: AgentCenterSession }) {
  return <AgentCenterCognitionSection
    session={session}
    snapshot={useAgentCenterStore(session).snapshot}
    i18n={{ language: 'zh', t: (key) => key }}
  />;
}

async function renderMemory() {
  session = await sessionFor({ cognitionMemory: {
    outcome: 'ready', enabled: true, adoptionRequired: false,
    currentCount: 2, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
    items: ['茶饮偏好：乌龙茶', '测试项目：青竹'].map((content, index) => ({
      memoryId: `memory-${index}`, content, epistemicStatus: 'explicit', lifecycle: 'current',
      occurredAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z',
      sourceExplanation: index === 0 ? 'Committed user correction' : 'Committed user message',
    })),
  } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness session={session!} />));
  return session;
}

function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it('names the exact Memory in the localized confirmation and cancels without mutation', async () => {
  const owner = await renderMemory();
  const forget = vi.spyOn(owner, 'forgetMemory');
  const target = document.querySelector('[data-agent-center-memory-id="memory-1"]')!;
  expect(document.body.textContent).toContain('由你纠正');
  expect(target.textContent).toContain('来自你的对话');
  await act(async () => button('忘记', target).click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('测试项目：青竹');
  expect(dialog.textContent).not.toContain('茶饮偏好：乌龙茶');
  await act(async () => button('取消', dialog).click());
  expect(forget).not.toHaveBeenCalled();
  expect(owner.getSnapshot().state.cognition.memory?.currentCount).toBe(2);
});

it.each([
  { action: 'forgetMemory' as const, entry: '忘记', confirm: '忘记' },
  { action: 'deleteAllMemory' as const, entry: '删除全部记忆', confirm: '全部删除' },
])('keeps $action failure visible inside the open confirmation', async ({ action, entry, confirm }) => {
  const owner = await renderMemory();
  vi.spyOn(owner, action).mockRejectedValue(new Error('验收：服务暂时不可用'));
  await act(async () => button(entry).click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(button('取消', dialog)).toBeTruthy();
  await act(async () => button(confirm, dialog).click());
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('验收：服务暂时不可用');
  expect(owner.getSnapshot().state.cognition.memory?.currentCount).toBe(2);
});
