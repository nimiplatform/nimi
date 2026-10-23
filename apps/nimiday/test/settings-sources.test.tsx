// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsSources } from '../src/nimiday/ui/settings-sources.js';
import { ParentOSChildren } from '../src/nimiday/ui/parentos-children.js';
import { DEFAULT_PROFILE } from '../src/nimiday/domain/defaults.js';
import type { SourceApp } from '../src/nimiday/domain/sources.js';
import { copyFor } from '../src/nimiday/i18n/index.js';

// Component regressions with isolated data; these do not certify a live App session.
const context = vi.hoisted(() => ({ engine: {} as Record<string, unknown>, retry: vi.fn() }));
vi.mock('../src/nimiday/app/context.js', () => ({
  useNimiDay: () => ({ copy: copyFor('zh'), activity: { retry: context.retry }, actions: {} }),
  useDayStore: () => ({ state: { profile: DEFAULT_PROFILE, circles: [] } }),
  useEngine: () => context.engine,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apps: SourceApp[] = Array.from({ length: 100 }, (_, i) => ({
  appId: `source-${i}`, appName: `App ${i}`, count: 1, latestAt: '2026-10-23T00:00:00Z',
  groups: [], ungrouped: { count: 1, examples: ['Record'] },
}));
const parentos: SourceApp = {
  ...apps[0]!, appId: 'nimi.parentos', appName: 'ParentOS',
  groups: Array.from({ length: 80 }, (_, i) => ({
    key: `parentos\0child:${i}`, count: 1, examples: [`Record ${i}`], firstAt: '2026-10-23T00:00:00Z',
    child: { sourceRef: 'parentos', childId: String(i), childName: `Child ${i}` }, available: true,
  })),
};
function resetEngine() {
  context.engine = { sourceApps: [...apps, parentos], activityStatus: 'ready', directoryStatus: 'ready',
    childDirectory: { unavailable: false, sources: 1 }, now: new Date('2026-10-23T00:00:00Z'),
    activityCoverage: { openTodos: 'complete', recent: 'complete' } };
}
async function edit(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('finds a source in a long list and preserves its open editor and child query when filtered out', async () => {
  resetEngine();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SettingsSources />));
    const section = container.querySelector<HTMLElement>('section[aria-label="ParentOS"]')!;
    await act(async () => section.querySelector('summary')!.click());
    await edit(section.querySelector('input')!, 'Child 79');
    expect(section.querySelectorAll('[data-testid="nd-source-group"]')).toHaveLength(1);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索 App"]')!;
    await edit(input, '  APP 99  ');
    expect(container.querySelectorAll('[data-testid="nd-source-setting"]:not([hidden])')).toHaveLength(1);
    expect(section.hidden).toBe(true);
    await edit(input, 'no matching publisher');
    expect(container.textContent).toContain(copyFor('zh').settings.searchEmpty);
    await edit(input, '');
    expect(section.hidden).toBe(false);
    expect(section.querySelector('details')!.open).toBe(true);
    expect(section.querySelector('input')!.value).toBe('Child 79');
    expect(section.querySelectorAll('[data-testid="nd-source-group"]')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('searches a large child directory and retains the list after an empty search', async () => {
  resetEngine();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ParentOSChildren />));
    const input = container.querySelector('input')!;
    await edit(input, '  child 79  ');
    expect(container.querySelectorAll('.nd-child-source:not([hidden])')).toHaveLength(1);
    await edit(input, 'missing child');
    expect(container.querySelector('[role="status"]')!.textContent).toBe(copyFor('zh').settings.searchEmpty);
    await edit(input, '');
    expect(container.querySelectorAll('.nd-child-source:not([hidden])')).toHaveLength(80);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('shows denied access without editable cached source controls and can retry', async () => {
  resetEngine(); context.engine.activityStatus = 'no-access'; context.retry.mockClear();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SettingsSources />));
    expect(container.querySelector('[role="status"]')!.textContent).toContain(copyFor('zh').today.sourcesNoAccessBody);
    expect(container.querySelector('[data-testid="nd-source-setting"]')).toBeNull();
    await act(async () => container.querySelector('button')!.click());
    expect(context.retry).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('distinguishes equal child names from different registrations even without reminder examples', async () => {
  resetEngine();
  context.engine.sourceApps = [{ ...parentos, groups: ['source-a', 'source-b'].map(sourceRef => ({
    ...parentos.groups[0]!, key: `${sourceRef}\0child:one`, examples: [],
    child: { sourceRef, childId: 'one', childName: 'Same name' },
  })) }];
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SettingsSources />));
    const groups = [...container.querySelectorAll('[data-testid="nd-source-group"]')];
    expect(groups).toHaveLength(2);
    expect(groups[0]!.textContent).toContain(copyFor('zh').settings.childSourceIdentity('one', 'source-a'));
    expect(groups[1]!.textContent).toContain(copyFor('zh').settings.childSourceIdentity('one', 'source-b'));
  } finally { await act(async () => root.unmount()); container.remove(); }
});
