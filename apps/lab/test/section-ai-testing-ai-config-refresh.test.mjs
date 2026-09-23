import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const kitRequire = createRequire(path.resolve(root, '../../kit/package.json'));
const { JSDOM } = kitRequire('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url:'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'KeyboardEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TooltipProvider } = await import('@nimiplatform/kit/ui');
mkdirSync(path.join(root, '.tmp'), { recursive:true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'studio-ai-config-refresh-'));
// Compose the packed studio-media slice the way generated App hosts do.
await build({
  stdin: {
    contents: `export { SectionAITesting } from './src/ai-studio-core/section-ai-testing.tsx';
      export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
      export { StudioCapabilityParameterContext } from './src/ai-studio-core/contexts.tsx';
      export { composeAIStudioModules } from './src/ai-studio-core/module-registration.ts';
      export { createStudioRunTargetSummary } from './src/ai-studio-core/run-target.ts';
      export { STUDIO_AI_CONFIG_CHANGED_EVENT, subscribeStudioAIConfigRefresh } from './src/ai-studio-core/ai-config.ts';
      export { studioMediaModule } from './src/studio-modules/studio-media/index.ts';`,
    resolveDir:root, loader:'ts',
  },
  outfile:path.join(buildDir,'studio.mjs'), bundle:true, packages:'external',
  platform:'node', format:'esm', target:'es2022', jsx:'automatic', logLevel:'silent',
});
const {
  SectionAITesting, AIStudioHostProvider, StudioCapabilityParameterContext, composeAIStudioModules,
  createStudioRunTargetSummary, STUDIO_AI_CONFIG_CHANGED_EVENT, subscribeStudioAIConfigRefresh, studioMediaModule,
} = await import(pathToFileURL(path.join(buildDir,'studio.mjs')).href);

test.after(async () => {
  dom.window.close();
  await rm(buildDir, { recursive:true, force:true });
});

const unconfigured = { config:null, revision:'1', effectiveSelections:[] };
const configured = {
  config:{
    owner:{ owner:{ oneofKind:'app', app:{ appId:'nimi.lab' } } },
    capabilities:[{ capabilityContract:'audio.separate', requiredFeatures:[], route:{ oneofKind:'local', local:{} } }],
  },
  revision:'2',
  effectiveSelections:[{ capabilityContract:'audio.separate', state:'ready' }],
};

test('mounted media parameter fields refresh readiness after the in-app AIConfig drawer closes', async () => {
  const composition = composeAIStudioModules([studioMediaModule]);
  const registration = composition.getCapability('audio.separate');
  let snapshot = unconfigured;
  const reads = { snapshot:0, config:0, recovery:0 };
  const host = {
    appTitle:'Studio', translate:key=>key, locale:'en', clock:{now:()=>Date.now()},
    app:{
      projection:{promptDraft:()=>({prompt:null}),projectRunTarget:createStudioRunTargetSummary,runStatusLabel:s=>s},
      // Bound the same way as the generated App host and the Lab adapter.
      events:{subscribeAIConfigRefresh:listener=>subscribeStudioAIConfigRefresh(listener, window, document)},
      commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>{}},
    },
    sdk:{
      aiConfig:{
        getSnapshot:async()=>{ reads.snapshot++; return snapshot; },
        get:async()=>{ reads.config++; return snapshot.config; },
      },
      storage:{
        readJson:async relativePath=>{
          if (relativePath === 'studio/audio-separation-recovery.json') reads.recovery++;
          return { value:[] };
        },
        writeJson:async()=>{},
      },
      runCapability:async()=>{ throw new Error('refreshing readiness must not run the capability'); },
    },
  };
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const props = {
    registration, registrations:composition.capabilities,
    runtime:{status:'connected',mode:'electron-local-app',detail:'connected'},
    lastResult:null, history:null, historySelectionRequest:null,
    onSelectHistoryRun:()=>{}, onResult:async()=>null,
    verboseConsole:false, draftPersistence:false,
    renderAIConfigPanel:()=>createElement('p',{'data-testid':'ai-config-panel'},'AIConfig editor'),
  };
  const flush = () => new Promise(resolve=>setTimeout(resolve,0));
  const button = label => Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===label || el.textContent.trim()===label);
  const fields = () => container.textContent;
  try {
    await act(async()=>{
      renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},
        createElement(StudioCapabilityParameterContext.Provider,{value:{state:{},setParameters:()=>{}}},
          createElement(SectionAITesting,props)))));
      await flush();
    });
    assert.match(fields(), /AudioSeparate\.configureInputs/);
    assert.equal(button('AudioSeparate.chooseSource').disabled,true);
    assert.match(fields(), /StudioShell\.statusBlocked/);

    await act(async()=>{ button('Studio.composer.openIntentConfig').click(); await flush(); });
    const panel = document.querySelector('[data-testid="ai-config-panel"]');
    assert.ok(panel, 'the in-app AIConfig drawer must be open');
    // The drawer commits the write inside this window, so focus never moves.
    snapshot = configured;
    const beforeClose = { ...reads };
    await act(async()=>{
      panel.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await flush();
    });
    assert.match(fields(), /AudioSeparate\.inputHint/);
    assert.doesNotMatch(fields(), /AudioSeparate\.configureInputs/);
    assert.equal(button('AudioSeparate.chooseSource').disabled,false);
    assert.match(fields(), /StudioShell\.statusConfigured/);
    assert.deepEqual(reads, {
      snapshot:beforeClose.snapshot+1,
      config:beforeClose.config+1,
      recovery:beforeClose.recovery+1,
    });

    // Writes from other surfaces still arrive through window focus.
    snapshot = unconfigured;
    await act(async()=>{ window.dispatchEvent(new dom.window.Event('focus')); await flush(); });
    assert.match(fields(), /AudioSeparate\.configureInputs/);
    assert.equal(button('AudioSeparate.chooseSource').disabled,true);
  } finally {
    await act(async()=>{renderer.unmount();});
  }
  const afterUnmount = { ...reads };
  window.dispatchEvent(new dom.window.Event(STUDIO_AI_CONFIG_CHANGED_EVENT));
  await flush();
  assert.deepEqual(reads, afterUnmount, 'unmounted consumers must unsubscribe from in-app AIConfig writes');
});
