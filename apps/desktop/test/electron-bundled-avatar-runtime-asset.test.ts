import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

const electronMockUrl = `data:text/javascript,${encodeURIComponent(`
  export class BrowserWindow {
    static fromWebContents() { return null; }
  }
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
  desktopAvatarWindowBindingMatches,
} = await import('../src-electron/bundled-avatar-host.js');

test('bundled Avatar window reuse requires the same current handle and exact anchor', () => {
  const current = {
    agentHandle: `agent_ref_${'a'.repeat(43)}`,
    conversationAnchorId: 'anchor-current',
  };
  assert.equal(desktopAvatarWindowBindingMatches(current, current), true);
  assert.equal(desktopAvatarWindowBindingMatches(current, {
    ...current,
    conversationAnchorId: 'anchor-rotated',
  }), false);
  assert.equal(desktopAvatarWindowBindingMatches(current, {
    ...current,
    agentHandle: `agent_ref_${'b'.repeat(43)}`,
  }), false);
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
  assert.match(source, /await assetHost\.close\(\);/u);
  assert.match(
    source,
    /if \(!initialNavigationComplete\) return;\s+event\.preventDefault\(\);\s+invalidate\(\);\s+if \(!window\.isDestroyed\(\)\) window\.close\(\);/u,
  );
});
