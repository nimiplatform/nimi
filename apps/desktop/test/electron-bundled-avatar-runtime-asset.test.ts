import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

const electronMockUrl = `data:text/javascript,${encodeURIComponent(`
  export class BrowserWindow {
    static fromWebContents() { return null; }
  }
  export const powerMonitor = {
    on() {},
    removeListener() {},
  };
  export const screen = {};
  export const shell = {};
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: electronMockUrl };
    }
    return nextResolve(specifier, context);
  },
});

const {
  desktopAvatarPrimaryFallbackBounds,
  desktopAvatarWindowBindingMatches,
  desktopAvatarWindowCanRebindSession,
  desktopAvatarWindowHandoffBindingAction,
  desktopAvatarWindowWasOnRemovedDisplay,
} = await import('../src-electron/bundled-avatar-host.js');

test('removed-display recovery identifies the owning display and uses a bounded primary default', () => {
  const removed = { x: 1920, y: 0, width: 1920, height: 1080 };
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const windowBounds = { x: 3300, y: 500, width: 420, height: 680 };
  assert.equal(
    desktopAvatarWindowWasOnRemovedDisplay(windowBounds, removed, [primary]),
    true,
  );
  assert.deepEqual(
    desktopAvatarPrimaryFallbackBounds(windowBounds, primary),
    { x: 1500, y: 360, width: 420, height: 680 },
  );
  assert.equal(
    desktopAvatarWindowWasOnRemovedDisplay(
      { x: 100, y: 100, width: 420, height: 680 },
      removed,
      [primary],
    ),
    false,
  );
});

test('bundled Avatar window reuse requires the same current handle and exact anchor', () => {
  const current = {
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'anchor-current',
  };
  assert.equal(desktopAvatarWindowBindingMatches(current, current), true);
  assert.equal(desktopAvatarWindowBindingMatches(current, {
    agentHandle: current.agentHandle,
    conversationAnchorId: null,
  }), true);
  assert.equal(desktopAvatarWindowBindingMatches(current, {
    ...current,
    conversationAnchorId: 'anchor-rotated',
  }), false);
  assert.equal(desktopAvatarWindowBindingMatches(current, {
    ...current,
    agentHandle: `agent_ref_${'b'.repeat(43)}`,
  }), false);
  assert.equal(desktopAvatarWindowCanRebindSession(current, {
    ...current,
    agentHandle: `agent_ref_${'b'.repeat(43)}`,
  }), true);
  assert.equal(desktopAvatarWindowCanRebindSession(current, {
    ...current,
    conversationAnchorId: 'anchor-rotated',
  }), false);
});

test('validated launch rotation rebinds the record before presence and focus reuse it', () => {
  let current = {
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'anchor-current',
  };
  const rotated = {
    agentHandle: `agent_ref_${'b'.repeat(43)}`,
    conversationAnchorId: 'anchor-current',
  };
  assert.equal(desktopAvatarWindowHandoffBindingAction('presence', current, {
    agentHandle: current.agentHandle,
    conversationAnchorId: null,
  }), 'reuse');
  assert.equal(desktopAvatarWindowHandoffBindingAction('focus', current, rotated), 'absent');
  assert.equal(desktopAvatarWindowHandoffBindingAction('presence', current, {
    ...current,
    conversationAnchorId: 'anchor-stale',
  }), 'absent');
  assert.equal(desktopAvatarWindowHandoffBindingAction('launch', current, rotated), 'rebind');

  current = rotated;
  assert.equal(desktopAvatarWindowHandoffBindingAction('presence', current, rotated), 'reuse');
  assert.equal(desktopAvatarWindowHandoffBindingAction('focus', current, rotated), 'reuse');
});

test('bundled Avatar asset command carries the reminted formal App handle into Host materialization', async () => {
  const source = await readFile(
    new URL('../src-electron/bundled-avatar-host.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /requiredAgentHandle\(request\.agentHandle, 'agentHandle'\)/u,
  );
  assert.doesNotMatch(source, /resolveBoundPresentation\([\s\S]*record\.launchContext\.agentHandle/u);
  assert.match(source, /assetHost\.resolveBoundPresentation/u);
  assert.doesNotMatch(source, /GetAgentPresentationAsset|bundledAvatarUnary/u);
  assert.doesNotMatch(source, /privateBinding|localAgentRef|ownerUserId|runtimeSourceRef/u);
  assert.doesNotMatch(source, /resolveSelectedDataRoot/u);
  assert.doesNotMatch(source, /launchInitialAvatar|desktop_avatar_launch_handoff/u);
  assert.match(source, /await assetHost\.close\(\);/u);
  assert.match(source, /powerMonitor\.on\('suspend', handleHostSuspend\)/u);
  assert.match(source, /powerMonitor\.on\('lock-screen', handleHostSuspend\)/u);
  assert.match(source, /handleHostResume[\s\S]*constrainAllWindows\(\);[\s\S]*handleHostSuspend\(\);/u);
  assert.match(source, /powerMonitor\.removeListener\('lock-screen', handleHostSuspend\)/u);
  assert.match(
    source,
    /if \(!initialNavigationComplete\) return;\s+event\.preventDefault\(\);\s+invalidate\(\);\s+if \(!window\.isDestroyed\(\)\) window\.close\(\);/u,
  );
});
