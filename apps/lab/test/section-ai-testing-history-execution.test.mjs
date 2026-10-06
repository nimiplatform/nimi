import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'FileReader', 'File', 'Blob']) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TooltipProvider } = await import('@nimiplatform/kit/ui');
const { ScenarioJobStatus } = await import('@nimiplatform/sdk/runtime/generated');
mkdirSync(path.join(root, '.tmp'), { recursive:true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'studio-history-execution-'));
await build({
  stdin: {
    contents: `export { SectionAITesting } from './src/ai-studio-core/section-ai-testing.tsx';
      export { TextStudioComposer } from './src/ai-studio-core/section-ai-testing-composer.tsx';
      export { TextStudioResultState } from './src/ai-studio-core/section-ai-testing-result.tsx';
      export { MusicRecoveryPanel } from './src/studio-modules/studio-media/music-recovery-panel.tsx';
      export { StudioHistoryResultContext } from './src/ai-studio-core/contexts.tsx';
      export { textStudioMediaInputAvailable } from './src/ai-studio-core/section-ai-testing-input.ts';
      export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
      export { StudioCapabilityParameterContext } from './src/ai-studio-core/contexts.tsx';
      export { labStudioComposition } from './src/lab/lab-studio-composition.ts';
      export { createStudioRunHistoryRecord } from './src/ai-studio-core/history.ts';
      export { createRunConfigSnapshot } from './src/ai-studio-core/section-ai-testing-run.ts';
      export { parseStudioRunHistory } from './src/ai-studio-core/history-policy.ts';
      export { studioVoiceRuntimeHandlers } from './src/studio-modules/studio-voice/runtime.ts';
      export { t as labTranslate } from './src/shell/i18n/index.ts';`,
    resolveDir:root, loader:'ts',
  },
  outfile:path.join(buildDir,'studio.mjs'), bundle:true, packages:'external',
  platform:'node', format:'esm', target:'es2022', jsx:'automatic', logLevel:'silent',
});
const { SectionAITesting, TextStudioComposer, TextStudioResultState, MusicRecoveryPanel, StudioHistoryResultContext, textStudioMediaInputAvailable, AIStudioHostProvider, StudioCapabilityParameterContext, labStudioComposition, labTranslate } = await import(pathToFileURL(path.join(buildDir,'studio.mjs')).href);
const { createStudioRunHistoryRecord, createRunConfigSnapshot, parseStudioRunHistory, studioVoiceRuntimeHandlers } = await import(pathToFileURL(path.join(buildDir,'studio.mjs')).href);

test.after(async () => {
  dom.window.close();
  await rm(buildDir, { recursive:true, force:true });
});

test('text image action follows the effective configured feature and retains a blocked draft image', async () => {
  const selected = {
    capabilityContract:'text.generate',state:'ready',resource:{oneofKind:'cloud',cloud:{
      target:{state:'ready',supportedFeatures:['input.image']},
    }},
  };
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[selected]}),true);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[selected]}, 'audio/wav'),false);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[{...selected,resource:{oneofKind:'cloud',cloud:{target:{state:'ready',supportedFeatures:['input.audio','input.video']}}}}]}, 'audio/wav'),true);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[{...selected,resource:{oneofKind:'cloud',cloud:{target:{state:'ready',supportedFeatures:['input.audio','input.video']}}}}]}, 'video/mp4'),true);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[{
    ...selected,resource:{oneofKind:'cloud',cloud:{target:{state:'ready',supportedFeatures:[]}}},
  }]}),false);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[{
    ...selected,resource:{oneofKind:'local',local:{state:'ready',configuredFeatures:[],implementationSupportedFeatures:['input.image']}},
  }]}),false);
  assert.equal(textStudioMediaInputAvailable({effectiveSelections:[{
    ...selected,resource:{oneofKind:'local',local:{state:'ready',configuredFeatures:['input.image'],implementationSupportedFeatures:['input.image']}},
  }]}),true);

  const registration = labStudioComposition.getCapability('text.generate');
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const image = {id:'draft-image',kind:'image',name:'cats.jpg',mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,AQID'};
  const props = {
    registration,prompt:'Describe the image',context:'',intentLabel:'Cloud',running:false,
    attachments:[image],attachmentPickerEnabled:false,attachmentWarning:'Remove the image or choose a model that supports image input.',
    canDispatch:true,canConfigureIntent:false,onOpenAttachmentPicker:()=>{},onRemoveAttachment:()=>{},
    onPromptChange:()=>{},onContextChange:()=>{},onSubmit:()=>{},
  };
  const render = () => renderer.render(createElement(TooltipProvider,null,
    createElement(AIStudioHostProvider,{value:{translate:key=>key}},createElement(TextStudioComposer,props))));
  try {
    await act(async()=>{render();});
    assert.equal(container.querySelector('button[aria-label="Studio.composer.attachContext"]'),null);
    assert.equal(container.querySelector('.studio-attachment-chip__name')?.textContent,'cats.jpg');
    assert.match(container.textContent,/Remove the image/u);
    assert.equal(container.querySelector('button[aria-label="Studio.profiles.textGenerate.primaryLabel"]').disabled,true);
    props.attachmentPickerEnabled=true;
    props.attachmentWarning=undefined;
    await act(async()=>{render();});
    assert.ok(container.querySelector('button[aria-label="Studio.composer.attachContext"]'));
    assert.equal(container.querySelector('button[aria-label="Studio.profiles.textGenerate.primaryLabel"]').disabled,false);
  } finally {
    await act(async()=>{renderer.unmount();});
  }
});

for (const media of [{ name: 'cats.jpg', type: 'image/jpeg' }, { name: 'speech.wav', type: 'audio/wav' }, { name: 'clip.mp4', type: 'video/mp4' }]) {
test(`Text Studio exposes Stop for ${media.type} and cancels its own running request`, async () => {
  const registration = labStudioComposition.getCapability('text.generate');
  const calls = [];
  const recorded = [];
  const target = { capabilityId: 'text.generate', capabilityContract: 'text.generate', section: 'text',
    source: 'cloud', status: 'configured', canDispatch: true, intentLabel: 'Cloud', detail: 'configured',
    params: {}, paramsSummary: [], profileOrigin: null };
  const host = {
    appTitle: 'Lab', translate: key => key, locale: 'en', clock: { now: () => Date.now() },
    app: {
      projection: { promptDraft: () => ({ prompt: 'Describe the image' }), projectRunTarget: () => target, runStatusLabel: s => s },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => {} },
    },
    sdk: {
      aiConfig: { get: async () => null, getSnapshot: async () => ({ effectiveSelections: [{
        capabilityContract: 'text.generate', state: 'ready', resource: { oneofKind: 'cloud', cloud: {
          target: { state: 'ready', supportedFeatures: ['input.image', 'input.audio', 'input.video'] },
        } },
      }] }) },
      runCapability(input) { const deferred = Promise.withResolvers(); calls.push({ input, ...deferred }); return deferred.promise; },
    },
  };
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const button = label => Array.from(container.querySelectorAll('button')).find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label);
  const previousReader = globalThis.FileReader;
  try {
    await act(async () => renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host },
      createElement(SectionAITesting, {
        registration, registrations: [registration], runtime: { status: 'connected', detail: 'connected' },
        lastResult: null, history: {}, historySelectionRequest: null, onSelectHistoryRun: () => {},
        onResult: async result => { recorded.push(result); return null; }, verboseConsole: false, draftPersistence: false,
      })))));
    const readFinished = Promise.withResolvers();
    globalThis.FileReader = class extends dom.window.FileReader {
      constructor() { super(); this.addEventListener('loadend', readFinished.resolve, { once: true }); }
    };
    await act(async () => {
      button('Studio.composer.attachContext').click();
      const picker = document.querySelector('input[type="file"]');
      Object.defineProperty(picker, 'files', { value: [new dom.window.File(['media input'], media.name, { type: media.type })] });
      picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await readFinished.promise;
    });
    await act(async () => { button('Studio.profiles.textGenerate.primaryLabel').click(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.attachments[0].name, media.name);
    assert.ok(!container.textContent.includes('Studio.profiles.textGenerate.savedMediaUnavailable'), 'a running media request must not claim its source is unavailable');
    const stop = button('StudioShell.cancelGeneration');
    assert.ok(stop, 'the running image request needs a real Stop action');
    await act(async () => { stop.click(); });
    assert.equal(calls[0].input.signal.aborted, true);
    await act(async () => { calls[0].resolve({ ok: false, capabilityId: 'text.generate', reason: 'operation-aborted', message: 'stopped', actionHint: '' }); });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].reason, 'operation-aborted');
    assert.ok(container.textContent.includes('Studio.result.status.stoppedDirectCall'));
    assert.ok(!container.textContent.includes('Studio.result.status.operationAborted'));
  } finally {
    globalThis.FileReader = previousReader;
    await act(async () => { renderer.unmount(); });
  }
});
}

test('text history reruns its saved media and never borrows the current composer attachment', { timeout: 10_000 }, async () => {
  const registration = labStudioComposition.getCapability('text.generate');
  const target = { capabilityId: 'text.generate', capabilityContract: 'text.generate', section: 'text', source: 'cloud',
    status: 'configured', canDispatch: true, intentLabel: 'Cloud', detail: 'configured', params: {}, paramsSummary: [], profileOrigin: null };
  const bytes = new TextEncoder().encode('original owned audio');
  const source = { relativePath: 'studio/original.wav', mediaType: 'audio/wav', sizeBytes: bytes.byteLength,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, displayName: 'original.wav', previewSource: 'managed-asset' };
  const record = { id: 'saved-media', capabilityId: 'text.generate', createdAt: '2026-10-03T00:00:00.000Z', prompt: 'Describe this recording', status: 'ready', message: 'saved',
    result: { ok: true, kind: 'text', summary: 'answer', body: 'answer', charCount: 6, finishReason: 'stop', streamed: false, sourceImage: source },
    runConfig: { target, promptControls: { context: '', contextAttached: false, attachmentCount: 1 } } };
  const calls = [], results = [], reads = [];
  let completion = Promise.withResolvers();
  const host = {
    appTitle: 'Lab', translate: key => key, locale: 'en', clock: { now: () => Date.now() },
    app: { projection: { promptDraft: () => ({ prompt: 'new draft' }), projectRunTarget: () => target, runStatusLabel: s => s },
      events: { subscribeAIConfigRefresh: () => () => {} }, commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => {} } },
    sdk: { aiConfig: { get: async () => null, getSnapshot: async () => ({ effectiveSelections: [{ capabilityContract: 'text.generate', state: 'ready',
      resource: { oneofKind: 'cloud', cloud: { target: { state: 'ready', supportedFeatures: ['input.image', 'input.audio', 'input.video'] } } } }] }) },
      assets: { read: async ({ relativePath }) => { reads.push(relativePath); return { asset: source, body: { async *[Symbol.asyncIterator]() { yield bytes; } } }; } },
      runCapability: async input => { calls.push(input); return { ok: false, capabilityId: 'text.generate', reason: 'runtime-call-failed', message: 'stopped at test transport', actionHint: '' }; },
    },
  };
  const props = { registration, registrations: [registration], runtime: { status: 'connected', detail: 'connected' }, lastResult: null,
    history: { 'text.generate': [record] }, historySelectionRequest: { requestId: 1, record }, onSelectHistoryRun: () => {},
    onResult: async result => { results.push(result); completion.resolve(); return null; }, verboseConsole: false, draftPersistence: false };
  const container = document.getElementById('root'), renderer = createRoot(container);
  const render = () => renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host }, createElement(SectionAITesting, props))));
  const button = label => Array.from(container.querySelectorAll('button')).find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label);
  const regenerate = async () => {
    completion = Promise.withResolvers();
    await act(async () => { button('StudioShell.regenerate').click(); await completion.promise; });
  };
  const previousReader = globalThis.FileReader;
  try {
    await act(async () => render());
    await regenerate();
    assert.equal(calls.length, 1, JSON.stringify(results));
    assert.equal(calls[0].attachments[0].name, 'original.wav');
    assert.equal(calls[0].attachments[0].dataUrl, `data:audio/wav;base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(button('StudioShell.regenerate').disabled, false, 'a failed replay must retain its known saved input for an explicit retry');
    const readFinished = Promise.withResolvers();
    globalThis.FileReader = class extends dom.window.FileReader { constructor() { super(); this.addEventListener('loadend', readFinished.resolve, { once: true }); } };
    await act(async () => {
      button('Studio.composer.attachContext').click();
      const picker = document.querySelector('input[type="file"]');
      Object.defineProperty(picker, 'files', { value: [new dom.window.File(['new unrelated video'], 'other.mp4', { type: 'video/mp4' })] });
      picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await readFinished.promise;
    });
    globalThis.FileReader = previousReader;
    props.historySelectionRequest = { requestId: 2, record };
    await act(async () => render());
    await regenerate();
    assert.equal(calls[1].attachments[0].name, 'original.wav');
    assert.equal(calls[1].attachments[0].dataUrl, calls[0].attachments[0].dataUrl);
    assert.ok(container.textContent.includes('other.mp4'), 'replay must not mutate the current draft');
    const textOnly = structuredClone(record);
    textOnly.id = 'saved-text'; delete textOnly.result.sourceImage; textOnly.runConfig.promptControls.attachmentCount = 0;
    props.historySelectionRequest = { requestId: 3, record: textOnly };
    await act(async () => render());
    await regenerate();
    assert.deepEqual(calls[2].attachments, []);
    assert.deepEqual(reads, [source.relativePath, source.relativePath]);
    host.sdk.assets.read = async () => { throw new Error('asset missing'); };
    props.historySelectionRequest = { requestId: 4, record };
    await act(async () => render());
    await regenerate();
    assert.equal(calls.length, 3, 'missing original media must not dispatch plain text');
    assert.equal(results.at(-1).message, 'Studio.profiles.textGenerate.savedMediaUnavailable');
    const withoutSource = structuredClone(record); delete withoutSource.result.sourceImage;
    props.historySelectionRequest = { requestId: 5, record: withoutSource };
    await act(async () => render());
    assert.equal(button('StudioShell.regenerate').disabled, true);
    assert.ok(container.textContent.includes('Studio.profiles.textGenerate.savedMediaUnavailable'));
  } finally {
    globalThis.FileReader = previousReader;
    await act(async () => renderer.unmount());
  }
});

test('history previews do not inherit another run status or cancellation target', async () => {
  const registration = labStudioComposition.getCapability('vision.locate');
  const target = {
    capabilityId:'vision.locate', capabilityContract:'vision.locate', section:'image',
    source:'local', status:'configured', canDispatch:true, intentLabel:'Local', detail:'configured',
    params:{}, paramsSummary:[], profileOrigin:null,
  };
  const savedResult = {
    ok:true, capabilityId:'vision.locate', capabilityLabel:'Locate', message:'saved B',
    output:{kind:'vision-locate',jobId:'job-b',result:{imageArtifactId:'image-b',width:1200,height:800,locations:[]}},
  };
  const record = {
    id:'history-b', capabilityId:'vision.locate', createdAt:'2026-09-09T00:00:00.000Z',
    prompt:'the button', status:'ready', message:'saved B',
    result:{ok:true,kind:'vision-locate',jobId:'job-b',summary:'saved B',result:savedResult.output.result},
    runConfig:{target,promptControls:{context:'',contextAttached:false,attachmentCount:1}},
  };
  const calls = [];
  const host = {
    appTitle:'Lab', translate:key=>key, locale:'en', clock:{now:()=>Date.now()},
    app:{
      projection:{promptDraft:()=>({prompt:'the button'}),projectRunTarget:()=>target,runStatusLabel:s=>s},
      events:{subscribeAIConfigRefresh:()=>()=>{}},
      commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>{}},
    },
    sdk:{aiConfig:{get:async()=>null},runCapability(input){
      const deferred=Promise.withResolvers(); calls.push({input,...deferred}); return deferred.promise;
    }},
  };
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const props = {
    registration, registrations:[registration], runtime:{status:'connected',detail:'connected'},
    lastResult:null, history:{'vision.locate':[record]},historySelectionRequest:null,
    onSelectHistoryRun:()=>{}, onResult:async result=>result.ok ? record : null,
    verboseConsole:false,draftPersistence:false,
  };
  const render = () => renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},createElement(SectionAITesting,props))));
  const button = label => Array.from(container.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===label || el.textContent.trim()===label);
  try {
    await act(async()=>{render();});
    assert.equal(button('Studio.profiles.visionLocate.primaryLabel').disabled,true);
    // Use the actual attachment adapter so the run has its required image.
    const readFinished = Promise.withResolvers();
    globalThis.FileReader = class extends dom.window.FileReader {
      constructor() { super(); this.addEventListener('loadend',readFinished.resolve,{once:true}); }
    };
    try {
      await act(async()=>{
        button('VisionLocate.chooseImage').click();
        const picker = document.querySelector('input[type="file"]');
        Object.defineProperty(picker,'files',{value:[new dom.window.File(['image content'],'gui.png',{type:'image/png'})]});
        picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        await readFinished.promise;
      });
    } finally {
      globalThis.FileReader = dom.window.FileReader;
    }
    await act(async()=>{button('Studio.profiles.visionLocate.primaryLabel').click();});
    assert.equal(calls[0].input.attachments[0].name,'gui.png');
    await act(async()=>{calls[0].resolve(savedResult);});
    // B is now a completed current-session result. Start A, then select B.
    await act(async()=>{button('StudioShell.regenerate').click();});
    assert.equal(calls.length,2);
    props.historySelectionRequest={requestId:1,record};
    await act(async()=>{render();});
    await act(async()=>{calls[1].input.onJobUpdate({status:ScenarioJobStatus.RUNNING});});
    assert.ok(container.querySelector('.studio-locate-result'));
    assert.equal(container.querySelector('.studio-result__pending'),null);
    assert.equal(button('StudioShell.cancelGeneration'),undefined);
    assert.equal(button('StudioShell.regenerate').disabled,true);
    assert.equal(calls[1].input.signal.aborted,false);
    // A persisted record takes a different rendering branch than session B.
    props.historySelectionRequest={requestId:2,record:{...record,id:'older-history'}};
    await act(async()=>{render();});
    assert.ok(container.textContent.includes('Studio.result.statCompleted'), 'the saved complete BOX result is completed, not Runtime readiness');
    assert.equal(container.querySelector('.studio-result__pending'),null);
    assert.equal(button('StudioShell.cancelGeneration'),undefined);
    assert.equal(button('StudioShell.regenerate').disabled,true);
    await act(async()=>{button('StudioShell.returnToRunning').click();});
    assert.ok(container.querySelector('.studio-result__pending'));
    await act(async()=>{button('StudioShell.cancelGeneration').click();});
    assert.equal(calls[1].input.signal.aborted,true);
    assert.equal(calls[1].input.signal.reason,'studio-user-canceled');
    assert.equal(calls[0].input.signal.aborted,false);
    assert.equal(record.result.result.imageArtifactId,'image-b');
    await act(async()=>{calls[1].resolve({ok:false,capabilityId:'vision.locate',reason:'runtime-canceled',message:'canceled A'});});
    props.historySelectionRequest={requestId:3,record:{...record,id:'older-history'}};
    await act(async()=>{render();button('Studio.composer.removeAttachment').click();});
    assert.equal(button('StudioShell.regenerate').disabled,true);
    await act(async()=>{button('StudioShell.regenerate').click();});
    assert.equal(calls.length,2);
  } finally {
    await act(async()=>{renderer.unmount();});
  }
});

test('text annotation submits and records the exact composer document', async () => {
  const registration = labStudioComposition.getCapability('text.annotate');
  const target = {
    capabilityId: 'text.annotate', capabilityContract: 'text.annotate', section: 'embed',
    source: 'local', status: 'configured', canDispatch: true, intentLabel: 'Local', detail: 'configured',
    params: {}, paramsSummary: [], profileOrigin: null,
  };
  const submitted = [];
  const recorded = [];
  const host = {
    appTitle: 'Lab', translate: key => key, locale: 'en', clock: { now: () => Date.now() },
    app: {
      projection: { promptDraft: () => ({ prompt: '' }), projectRunTarget: () => target, runStatusLabel: s => s },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => {} },
    },
    sdk: {
      aiConfig: { get: async () => null },
      async runCapability(input) {
        submitted.push(input);
        return { ok: false, capabilityId: 'text.annotate', reason: 'runtime-call-failed', message: 'test stop', actionHint: '' };
      },
    },
  };
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  try {
    await act(async () => {
      renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host }, createElement(SectionAITesting, {
        registration, registrations: [registration], runtime: { status: 'connected', detail: 'connected' },
        lastResult: null, history: {}, historySelectionRequest: null, onSelectHistoryRun: () => {},
        onResult: async (_result, prompt) => { recorded.push(prompt); return null; },
        verboseConsole: false, draftPersistence: false,
      }))));
    });
    const documentText = '  The café sells 🍰 cake.  ';
    const textarea = container.querySelector('.studio-input textarea');
    assert.ok(textarea);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, documentText);
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'CapabilityTests.textAnnotate.primaryLabel');
    assert.ok(submit);
    await act(async () => { submit.click(); });
    assert.equal(submitted[0]?.prompt, documentText);
    assert.deepEqual(recorded, [documentText]);
  } finally {
    await act(async () => { renderer.unmount(); });
  }
});

test('vision locate exposes image selection and geometry beside the target query', async () => {
  const registration = labStudioComposition.getCapability('vision.locate');
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  let chooseCount = 0;
  let removeCount = 0;
  let submitCount = 0;
  let configureCount = 0;
  const props = {
    registration, prompt:'', context:'', intentLabel:'Local', running:false,
    attachments:[], canDispatch:true, canConfigureIntent:true,
    onOpenAttachmentPicker:()=>{chooseCount++;}, onRemoveAttachment:()=>{removeCount++;},
    onPromptChange:()=>{}, onContextChange:()=>{},
    onSubmit:()=>{submitCount++;}, onOpenIntentConfig:()=>{configureCount++;},
  };
  const render = () => renderer.render(createElement(TooltipProvider,null,
    createElement(AIStudioHostProvider,{value:{translate:key=>key}},createElement(TextStudioComposer,{
      ...props,
      parameterPanel:createElement(registration.parameterPanel,{
        capabilityId:'vision.locate', contract:registration.parameters, source:'local',
        parameters:{geometry:'box'}, disabled:props.running, onChange:()=>{},
      }),
    }))));
  const button = label => Array.from(container.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===label || el.textContent.trim()===label);
  try {
    await act(async()=>{render();});
    assert.equal(button('Studio.profiles.visionLocate.primaryLabel').disabled,true);
    assert.ok(container.querySelector('.studio-locate-parameters [role="combobox"]'));
    assert.equal(container.querySelector('.studio-parameters-drawer'),null);
    assert.equal(button('Studio.composer.context'),undefined);
    assert.equal(button('Studio.composer.attachContext'),undefined);
    await act(async()=>{button('VisionLocate.chooseImage').click();});
    assert.equal(chooseCount,1);

    props.attachments=[{id:'image',kind:'image',name:'gui.png',mimeType:'image/png',dataUrl:'data:image/png;base64,aW1hZ2U='}];
    await act(async()=>{render();});
    assert.ok(container.querySelector('img[alt="VisionLocate.draftImage"]'));
    assert.equal(button('Studio.profiles.visionLocate.primaryLabel').disabled,true);
    props.prompt='the search button';
    await act(async()=>{render();});
    assert.equal(button('Studio.profiles.visionLocate.primaryLabel').disabled,false);
    await act(async()=>{button('Studio.profiles.visionLocate.primaryLabel').click();});
    assert.equal(submitCount,1);
    await act(async()=>{button('VisionLocate.replaceImage').click();button('Studio.composer.removeAttachment').click();});
    assert.equal(chooseCount,2);
    assert.equal(removeCount,1);

    props.running=true;
    await act(async()=>{render();});
    assert.equal(button('Studio.profiles.visionLocate.primaryRunningLabel').disabled,true);
    assert.equal(button('VisionLocate.replaceImage').disabled,true);
    assert.equal(button('Studio.composer.removeAttachment').disabled,true);
    assert.equal(container.querySelector('.studio-locate-parameters [role="combobox"]').disabled,true);

    props.running=false;
    props.attachments=[];
    props.prompt='';
    props.canDispatch=false;
    await act(async()=>{render();});
    assert.equal(button('Studio.composer.configureIntent').disabled,false);
    await act(async()=>{button('Studio.composer.configureIntent').click();});
    assert.equal(configureCount,1);
    assert.equal(submitCount,1);
  } finally {
    await act(async()=>{renderer.unmount();});
  }
});

test('Decisions run the request from Parameters, stop the one call and replay or restore a recorded request', async () => {
  const registration = labStudioComposition.getCapability('text.decide');
  const codec = registration.parameters.recordedInput;
  assert.ok(codec);
  const target = {
    capabilityId: 'text.decide', capabilityContract: 'text.decide', section: 'chat',
    source: 'cloud', status: 'configured', canDispatch: true, intentLabel: 'Cloud', detail: 'configured',
    params: {}, paramsSummary: [], profileOrigin: null,
  };
  const calls = [];
  const recorded = [];
  const host = {
    appTitle: 'Lab', translate: key => key, locale: 'en', clock: { now: () => Date.now() },
    app: {
      projection: { promptDraft: () => ({ prompt: '' }), projectRunTarget: () => target, runStatusLabel: s => s },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => {} },
    },
    sdk: {
      aiConfig: { get: async () => null },
      runCapability(input) {
        const deferred = Promise.withResolvers();
        calls.push({ input, ...deferred });
        return deferred.promise;
      },
    },
  };
  const relevance = registration.parameters.initial();
  let parameters = relevance;
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const props = {
    registration, registrations: [registration], runtime: { status: 'connected', detail: 'connected' },
    lastResult: null, history: {}, historySelectionRequest: null, onSelectHistoryRun: () => {},
    onResult: async (result, prompt) => { recorded.push({ result, prompt }); return null; },
    verboseConsole: false, draftPersistence: false,
  };
  const store = () => ({
    state: { 'text.decide': parameters },
    setParameters: (capabilityId, next) => {
      assert.equal(capabilityId, 'text.decide');
      parameters = next;
      render();
    },
  });
  const render = () => renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host },
    createElement(StudioCapabilityParameterContext.Provider, { value: store() }, createElement(SectionAITesting, props)))));
  const button = label => Array.from(container.querySelectorAll('button')).find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label);
  try {
    await act(async () => { render(); });
    // The loaded example is complete, so one click runs it as one request.
    const relevancePrompt = codec.encode(relevance);
    await act(async () => { button('CapabilityTests.textDecide.primaryLabel').click(); });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input.parameters, relevance);
    assert.equal(calls[0].input.prompt, relevancePrompt);
    assert.equal(container.querySelector('.studio-turn__request pre').textContent, relevancePrompt);
    await act(async () => { button('StudioShell.cancelGeneration').click(); });
    assert.equal(calls[0].input.signal.aborted, true);
    assert.equal(calls[0].input.signal.reason, 'studio-user-canceled');
    await act(async () => { calls[0].resolve({ ok: false, capabilityId: 'text.decide', reason: 'operation-aborted', message: 'stopped', actionHint: '' }); });
    assert.equal(recorded[0].prompt, relevancePrompt);
    // A stopped direct call has no Job to wait for: it reads as stopped, not as a pending cancellation.
    assert.ok(container.textContent.includes('Studio.result.status.stoppedDirectCall'));
    assert.ok(container.textContent.includes('NonSuccess.message.stoppedDirectCall'));
    assert.ok(!container.textContent.includes('Studio.result.status.operationAborted'));

    // An example from Parameters replaces the form; the next run sends it.
    await act(async () => { button(labTranslate('CapabilityTests.textDecide.exampleIntent')).click(); });
    assert.equal(parameters.stateFormat, 'text');
    await act(async () => { button('CapabilityTests.textDecide.primaryLabel').click(); });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].input.parameters, parameters);
    const answers = [
      { questionId: 'intent', kind: 'choice', selectedCandidateId: 'exchange', probabilities: ['refund', 'exchange', 'repair', 'shipping', 'other'].map((candidateId) => ({ candidateId, probability: candidateId === 'exchange' ? 0.6 : 0.1 })) },
      { questionId: 'needs_agent', kind: 'boolean', trueProbability: 0.7 },
    ];
    await act(async () => { calls[1].resolve({ ok: true, capabilityId: 'text.decide', capabilityLabel: 'Decisions', message: 'ok', output: { kind: 'text-decision', answers }, trace: { traceId: 'trace-intent' } }); });
    assert.equal(container.querySelectorAll('.studio-decision__question').length, 2);
    assert.equal(container.querySelectorAll('.studio-decision__bar').length, 6);
    assert.equal(container.querySelector('.studio-decision__bar[aria-current="true"] .studio-decision__label').textContent, 'exchange');
    assert.ok(container.textContent.includes('trace-intent'));

    // A recorded request reruns as recorded, whatever the form holds now, and
    // restores the form only when asked.
    const record = {
      id: 'history-decide', capabilityId: 'text.decide', createdAt: '2026-09-24T00:00:00.000Z',
      prompt: relevancePrompt, status: 'ready', message: 'saved',
      result: { ok: true, kind: 'text-decision', summary: 'relevant: true 0.80', questionCount: 2, answers: [
        { questionId: 'relevant', kind: 'boolean', trueProbability: 0.8 },
        { questionId: 'hands_on', kind: 'boolean', trueProbability: 0.3 },
      ] },
      runConfig: { target, promptControls: { contextAttached: false, attachmentCount: 0 } },
    };
    props.history = { 'text.decide': [record] };
    props.historySelectionRequest = { requestId: 1, record };
    await act(async () => { render(); });
    assert.equal(container.querySelector('.studio-turn__request pre').textContent, relevancePrompt);
    assert.equal(container.querySelectorAll('.studio-decision__bar').length, 2);
    await act(async () => { button('StudioShell.regenerate').click(); });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].input.prompt, relevancePrompt);
    assert.deepEqual(calls[2].input.parameters.questions, relevance.questions);
    assert.equal(parameters.stateFormat, 'text', 'a replay leaves the form unchanged');
    await act(async () => { calls[2].resolve({ ok: false, capabilityId: 'text.decide', reason: 'runtime-timeout', message: 'late', actionHint: '' }); });
    props.historySelectionRequest = { requestId: 2, record };
    await act(async () => { render(); });
    await act(async () => { button('StudioShell.useAsDraft').click(); });
    assert.equal(parameters.stateFormat, 'json');
    assert.deepEqual(JSON.parse(parameters.state), JSON.parse(relevance.state));
    assert.deepEqual(parameters.questions, relevance.questions);
  } finally {
    await act(async () => { renderer.unmount(); });
  }
});


test('saved speech replay and draft restore keep the recorded voice and complete controls', async () => {
  const registration = labStudioComposition.getCapability('audio.synthesize');
  const saved = { voiceKind: 'asset', voiceAssetId: 'saved-voice', language: 'zh' };
  const target = { capabilityId: 'audio.synthesize', capabilityContract: 'audio.synthesize', section: 'tts', source: 'cloud', status: 'configured', canDispatch: true, intentLabel: 'Cloud', detail: 'configured', params: {}, paramsSummary: [], profileOrigin: null };
  const record = { id: 'saved-speech', capabilityId: 'audio.synthesize', createdAt: '2026-10-03T00:00:00Z', prompt: 'Saved speech text', status: 'failed', message: 'previous failure', result: { ok: false, kind: 'non-success', reason: 'runtime-call-failed', message: 'previous failure', summary: 'previous failure' }, runConfig: { target: { ...target, params: saved }, promptControls: { contextAttached: false, context: '', attachmentCount: 0 } } };
  const calls = [];
  const host = { appTitle: 'Lab', translate: key => key, locale: 'en', clock: { now: () => Date.now() }, app: { projection: { promptDraft: () => ({ prompt: 'Current draft' }), projectRunTarget: () => target, runStatusLabel: s => s }, events: { subscribeAIConfigRefresh: () => () => {} }, commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => {} } }, sdk: { aiConfig: { get: async () => null }, listLocalAppPresetVoices: async () => [], listLocalAppVoiceAssets: async () => [{ voiceAssetId: 'saved-voice', creationSource: 'text-description', status: 'active' }], runCapability: async input => { calls.push(input); return { ok: false, capabilityId: 'audio.synthesize', reason: 'runtime-call-failed', message: 'fixture observes request only', actionHint: '' }; } } };
  let parameters = { voiceKind: 'preset', voicePreset: 'live-voice', language: 'en', speed: 2 };
  const renderer = createRoot(document.getElementById('root'));
  const props = { registration, registrations: [registration], runtime: { status: 'connected', detail: 'connected' }, lastResult: null, history: { 'audio.synthesize': [record] }, historySelectionRequest: { requestId: 1, record }, onSelectHistoryRun: () => {}, onResult: async () => null, verboseConsole: false, draftPersistence: false };
  const render = () => renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host }, createElement(StudioCapabilityParameterContext.Provider, { value: { state: { 'audio.synthesize': parameters }, setParameters: (_id, next) => { parameters = next; render(); } } }, createElement(SectionAITesting, props)))));
  const button = label => [...document.getElementById('root').querySelectorAll('button')].find(x => x.getAttribute('aria-label') === label || x.textContent.trim() === label);
  try {
    await act(async () => { render(); });
    await act(async () => { button('StudioShell.regenerate').click(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, record.prompt);
    assert.deepEqual(calls[0].parameters, saved);
    assert.equal(parameters.speed, 2, 'replay leaves the live draft unchanged');
    props.historySelectionRequest = { requestId: 2, record };
    await act(async () => { render(); });
    await act(async () => { button('StudioShell.useAsDraft').click(); });
    assert.deepEqual(parameters, saved, 'draft restore must remove omitted live controls');
    assert.equal(registration.parameters.restoreRecordedParameters({ voiceKind: 'unknown' }), null);
    assert.equal(registration.parameters.restoreRecordedParameters({ language: { bad: true } }), null);
  } finally { await act(async () => { renderer.unmount(); }); }
});

test('saved separation range stays with its own submission across history, whole-source and unknown records', async () => {
  const registration = labStudioComposition.getCapability('audio.separate');
  const asset = name => ({ relativePath: `audio/${name}.wav`, mediaType: 'audio/wav', sizeBytes: 58,
    sha256: `sha256:${'a'.repeat(64)}`, previewSource: 'managed-asset' });
  const separation = { sourceAudio: asset('full-source'), vocals: asset('vocals'), background: asset('background') };
  const draftTarget = { capabilityId: 'audio.separate', capabilityContract: 'audio.separate', section: 'music',
    source: 'local', status: 'configured', intentLabel: 'Local', paramsSummary: [], profileOrigin: null,
    params: { sourceRelativePath: 'draft.wav', startSeconds: 5, endSeconds: 6 } };
  const record = parameters => ({ id: 'saved-separation', capabilityId: 'audio.separate', prompt: '',
    createdAt: '2026-10-05T01:24:17.000Z', status: 'ready', message: 'saved',
    result: { ok: true, kind: 'artifacts', summary: 'completed', jobId: 'saved-job', jobState: 'completed',
      artifactCount: 2, artifacts: [separation.vocals, separation.background], audioSeparation: separation },
    runConfig: { target: { ...draftTarget, params: parameters }, promptControls: { context: '', contextAttached: false, attachmentCount: 0 } } });
  const host = { translate: (key, values) => key + (values ? JSON.stringify(values) : ''), locale: 'en', clock: { now: () => Date.now() },
    app: { projection: { projectRunTarget: () => draftTarget, runStatusLabel: status => status }, commands: {} }, sdk: {} };
  const props = { registration, activeRun: { prompt: '', context: '', record: record({ sourceRelativePath: 'saved.wav', startSeconds: 2, endSeconds: 9 }) },
    admission: {}, intentLabel: 'Local', running: false, canRegenerate: false, cancelRequested: false,
    streamingText: null, verboseConsole: false, composer: null, onCopy() {}, onDownload() {}, onRegenerate() {}, onUseAsDraft() {} };
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const render = () => renderer.render(createElement(TooltipProvider, null,
    createElement(AIStudioHostProvider, { value: host }, createElement(TextStudioResultState, props))));
  const range = () => container.querySelector('[data-audio-separation-range]')?.textContent;
  try {
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRange{"start":2,"end":9}');
    draftTarget.params = { sourceRelativePath: 'changed-draft.wav', startSeconds: 1, endSeconds: 3 };
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRange{"start":2,"end":9}', 'current draft cannot change a saved range');
    props.activeRun.record = record({ sourceRelativePath: 'whole-source.wav' });
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedFullSource');
    props.activeRun.record = record({});
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRangeUnknown');
    props.activeRun.record = record({ recoverySubmissionId: 'own-recovery', ...draftTarget.params });
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRangeUnknown', 'a recovery action is not a fresh range submission');
    props.activeRun.record = record({ sourceRelativePath: 'bad-range.wav', startSeconds: null, endSeconds: 9 });
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRangeUnknown', 'null is not a recorded zero-second start');
    props.activeRun.result = { ok: true, capabilityId: 'audio.separate', capabilityLabel: 'Separate', message: 'completed',
      output: { kind: 'artifacts', jobId: 'live-job', jobState: 'completed', artifactCount: 2,
        artifacts: [separation.vocals, separation.background],
        audioSeparation: { ...separation, request: { kind: 'range', startSeconds: 2, endSeconds: 9 } } } };
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedRange{"start":2,"end":9}', 'live output uses its captured request');
    props.activeRun.result.output.audioSeparation.request = { kind: 'full-source' };
    await act(async () => render());
    assert.equal(range(), 'AudioSeparate.processedFullSource');
  } finally { await act(async () => renderer.unmount()); }
});

test('music recovery opens success only after the workspace commits formal history', async () => {
  // UI/storage workflow fixture, not a model or protected-App acceptance.
  const asset = name => ({ relativePath: `synthetic/${name}.wav`, mediaType: 'audio/wav', sizeBytes: 58,
    sha256: `sha256:${'a'.repeat(64)}`, previewSource: 'managed-asset' });
  const sourceAudio = asset('source'), vocals = asset('vocals'), background = asset('background');
  const separation = { sourceAudio, vocals, background, request: { kind: 'range', startSeconds: 2, endSeconds: 9 } };
  const result = { ok: true, capabilityId: 'audio.separate', capabilityLabel: 'Synthetic', message: 'synthetic',
    output: { kind: 'artifacts', jobId: 'synthetic-job', jobState: 'completed', artifactCount: 2,
      artifacts: [vocals, background], firstArtifact: vocals, audioSeparation: separation } };
  const entry = { clientSubmissionId: 'synthetic-recovery', createdAt: '2026-10-05T00:00:00Z', prompt: 'original prompt',
    sourceAudio, message: result.message, result: { ok: true, summary: 'synthetic', ...result.output } };
  const assets = new Map([sourceAudio, vocals, background].map(ref => [ref.relativePath, ref]));
  const calls = [], deferred = Promise.withResolvers();
  const host = { translate: key => key, locale: 'en',
    app: { events: { subscribeAIConfigRefresh: () => () => {} } },
    sdk: { storage: { readJson: async () => ({ value: [entry] }) }, assets: { stat: async path => assets.get(path) },
      runCapability: async input => { calls.push(input); return result; } } };
  const commits = [];
  const commit = async (...args) => { commits.push(args); await deferred.promise; return { id: 'formal-record' }; };
  const container = document.getElementById('root'), renderer = createRoot(container);
  try {
    await act(async () => renderer.render(createElement(AIStudioHostProvider, { value: host },
      createElement(StudioHistoryResultContext.Provider, { value: commit }, createElement(MusicRecoveryPanel, { capability: 'audio.separate', disabled: false })))));
    const open = [...container.querySelectorAll('button')].find(button => button.textContent === 'Music.openSaved');
    await act(async () => open.click());
    assert.equal(commits.length, 1); assert.equal(commits[0][0], result); assert.equal(commits[0][1], 'original prompt');
    assert.equal(container.querySelector('[data-audio-separation-range]'), null, 'uncommitted result is not presented as saved');
    await act(async () => { deferred.resolve(); await deferred.promise; });
    assert.ok(container.querySelector('[data-audio-separation-range]'));
    assert.equal(calls.length, 1); assert.equal(calls[0].parameters.recoverySubmissionId, 'synthetic-recovery');
  } finally { await act(async () => renderer.unmount()); }
});

function savedReplayRecord(id, target, saved, output, prompt = '', saveConfig = true) {
  const result = output
    ? { ok:true, capabilityId:id, message:'Saved result', output }
    : { ok:false, capabilityId:id, reason:'runtime-call-failed', message:'Saved request failed', actionHint:'Check the recorded source' };
  const record = createStudioRunHistoryRecord({ result, prompt, runId:`saved-${id.replaceAll('.','-')}`, createdAt:'2026-10-06T00:00:00Z',
    ...(saveConfig ? { runConfig:createRunConfigSnapshot({target,context:'',attachmentCount:0,requestParameters:saved}) } : {}) });
  return parseStudioRunHistory(JSON.parse(JSON.stringify({[id]:[record]})))[id][0];
}

for (const item of [
  { id:'music.transcribe', saved:{sourceRelativePath:'owned/A.wav',sourceMimeType:'audio/wav',requestedPart:'note-events',requestedFormats:['midi'],startSeconds:2,endSeconds:9}, live:{sourceRelativePath:'owned/B.wav',sourceMimeType:'audio/wav',requestedPart:'note-events',requestedFormats:['midi'],startSeconds:20,endSeconds:30} },
  { id:'audio.separate', saved:{sourceRelativePath:'owned/A.wav',sourceMimeType:'audio/wav',startSeconds:2,endSeconds:9,includeInstrumentParts:false}, live:{sourceRelativePath:'owned/B.wav',sourceMimeType:'audio/wav',startSeconds:20,endSeconds:30,includeInstrumentParts:false} },
]) {
 test(`${item.id} parsed history dispatches saved A and range while the draft remains B`,async()=>{
  const registration=labStudioComposition.getCapability(item.id), calls=[];let sourcePresent=true;
  const target={capabilityId:item.id,capabilityContract:item.id,section:'music',source:'local',status:'configured',canDispatch:true,intentLabel:'Local',detail:'configured',params:{},paramsSummary:[],profileOrigin:null};
  const record=savedReplayRecord(item.id,target,item.saved);let parameters={...item.live};
  const host={appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},app:{projection:{promptDraft:()=>({prompt:''}),projectRunTarget:()=>target,runStatusLabel:s=>s},events:{subscribeAIConfigRefresh:()=>()=>{}},commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>({ok:false})}},sdk:{aiConfig:{get:async()=>null,getSnapshot:async()=>({effectiveSelections:[{capabilityContract:item.id,state:'ready',resource:{oneofKind:'local',local:{musicInput:{transcription:[{parts:['note-events'],formats:['midi'],supportsRange:true,maxSourceBytes:536870912,maxDurationSeconds:600}]}}}}]})},assets:{stat:async path=>{if(!sourcePresent || path!=='owned/A.wav')throw Error('unexpected source');return {relativePath:path}}},runCapability:input=>{const d=Promise.withResolvers();calls.push({input,...d});return d.promise}}};
  const props={registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{[item.id]:[record]},historySelectionRequest:{requestId:1,record},onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
  const container=document.getElementById('root'),renderer=createRoot(container);
  const render=()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},createElement(StudioCapabilityParameterContext.Provider,{value:{state:{[item.id]:parameters},setParameters:(_id,next)=>{parameters=next;render()}}},createElement(SectionAITesting,props)))));
  try {
   await act(async()=>{render()});const regenerate=container.querySelector('button[aria-label="StudioShell.regenerate"]');assert.equal(regenerate.disabled,false);
   await act(async()=>{regenerate.click()});assert.equal(calls.length,1);assert.deepEqual(calls[0].input.parameters,item.saved);assert.deepEqual(parameters,item.live);
   await act(async()=>{calls[0].resolve({ok:false,capabilityId:item.id,reason:'runtime-canceled',message:'isolated request boundary',actionHint:''})});
   props.historySelectionRequest={requestId:2,record:{...record,status:'unavailable'}};await act(async()=>{render()});assert.equal(container.querySelector('button[aria-label="StudioShell.regenerate"]').disabled,true);assert.match(container.textContent,/StudioShell.historyInputsUnavailable/);
   sourcePresent=false;props.historySelectionRequest={requestId:3,record:{...record,id:'missing-source-record'}};await act(async()=>{render()});assert.equal(container.querySelector('button[aria-label="StudioShell.regenerate"]').disabled,true);assert.match(container.textContent,/StudioShell.historyInputsUnavailable/);
  }finally{await act(async()=>renderer.unmount())}
 });
}

test('ASR File history cannot borrow a newly selected file',async()=>{
 const id='audio.transcribe',registration=labStudioComposition.getCapability(id),calls=[];
 const target={capabilityId:id,capabilityContract:id,section:'voice',source:'local',status:'configured',canDispatch:true,intentLabel:'Local',detail:'configured',params:{},paramsSummary:[],profileOrigin:null};
 const record=savedReplayRecord(id,target,{audioFile:'A.wav (128 bytes)',mimeType:'audio/wav',timestamps:true});
 const parameters={audioFile:{name:'B.wav',mimeType:'audio/wav',sizeBytes:128,bytes:new Uint8Array(128)},mimeType:'audio/wav',timestamps:false};
 const host={appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},app:{projection:{promptDraft:()=>({prompt:''}),projectRunTarget:()=>target,runStatusLabel:s=>s},events:{subscribeAIConfigRefresh:()=>()=>{}},commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>({ok:false})}},sdk:{aiConfig:{get:async()=>null},runCapability:input=>{calls.push(input);throw Error('historical File must not dispatch')}}};
 const props={registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{[id]:[record]},historySelectionRequest:{requestId:1,record},onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
 const container=document.getElementById('root'),renderer=createRoot(container);
 try{await act(async()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},createElement(StudioCapabilityParameterContext.Provider,{value:{state:{[id]:parameters},setParameters:()=>{}}},createElement(SectionAITesting,props))))));const b=container.querySelector('button[aria-label="StudioShell.regenerate"]');assert.equal(b.disabled,true);await act(async()=>b.click());assert.equal(calls.length,0);assert.match(container.textContent,/StudioShell.historyInputsUnavailable/)}finally{await act(async()=>renderer.unmount())}
});

test('parsed ASR URL history restores URL A and all saved controls while File B remains the current draft', async () => {
  const id = 'audio.transcribe', registration = labStudioComposition.getCapability(id), calls = [], runnerCalls = [], changes = [];
  const target = { capabilityId:id, capabilityContract:id, section:'voice', source:'cloud', status:'configured', canDispatch:true,
    intentLabel:'Cloud', detail:'configured', params:{}, paramsSummary:[], profileOrigin:null };
  const url = 'https://audio.example.test/recording-A.wav?version=1';
  const saved = { mimeType:'audio/wav', language:'en', timestamps:true, diarization:false, speakerCount:2,
    prompt:'Nimi is a product name.', responseFormat:'text' };
  const draft = { audioFile:{name:'B.wav',mimeType:'audio/wav',sizeBytes:3,bytes:new Uint8Array([8,9,10])},
    mimeType:'audio/wav',language:'zh',timestamps:false,diarization:true,speakerCount:3,prompt:'Draft B context',responseFormat:'text' };
  let parameters = draft;
  const host = { appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},
    app:{projection:{promptDraft:()=>({prompt:'https://audio.example.test/draft-B.wav'}),projectRunTarget:()=>target,runStatusLabel:s=>s},
      events:{subscribeAIConfigRefresh:()=>()=>{}},commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>({ok:false})}},
    sdk:{aiConfig:{get:async()=>null},runCapability:async input=>{
      calls.push(input);
      return studioVoiceRuntimeHandlers[id]({capability:registration.descriptor,input,prompt:input.prompt,scenarioId:'isolated-asr',host:{
        appId:'lab',surfaceId:'ai-capabilities',client:{ai:{}},createScenarioJobClient:()=>({}),
        runners:{speechTranscribe:async request=>{runnerCalls.push(request);return {ok:false,reason:'runtime-call-failed',message:'isolated request boundary',actionHint:''}}},
        nonSuccess:(capability,reason,message)=>({ok:false,capabilityId:capability.id,reason,message,actionHint:''}),
      }});
    }} };
  const record = savedReplayRecord(id,target,saved,undefined,url);
  const props = {registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{[id]:[record]},
    historySelectionRequest:{requestId:1,record},onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
  const container=document.getElementById('root'),renderer=createRoot(container);
  const render=()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},
    createElement(StudioCapabilityParameterContext.Provider,{value:{state:{[id]:parameters},setParameters:(_id,next)=>{parameters=next;changes.push(next);render()}}},createElement(SectionAITesting,props)))));
  const regenerate=()=>container.querySelector('button[aria-label="StudioShell.regenerate"]');
  try {
    await act(async()=>render()); assert.equal(regenerate().disabled,false);
    await act(async()=>regenerate().click());
    assert.equal(calls.length,1); assert.equal(calls[0].prompt,url); assert.deepEqual(calls[0].parameters,saved);
    assert.equal(runnerCalls.length,1); assert.equal(runnerCalls[0].audioUrl,url); assert.equal(runnerCalls[0].audio,undefined);
    for (const [key,value] of Object.entries(saved)) assert.deepEqual(runnerCalls[0][key],value,key);
    assert.equal(calls[0].parameters.audioFile,undefined); assert.deepEqual(parameters,draft); assert.deepEqual(changes,[]);
    const variants = [
      {label:'speakerCount zero is preserved',params:{...saved,speakerCount:0},prompt:url,enabled:true},
      {label:'speakerCount upper boundary is preserved',params:{...saved,speakerCount:32},prompt:url,enabled:true},
      {label:'speakerCount below zero is rejected',params:{...saved,speakerCount:-1},prompt:url},
      {label:'speakerCount above 32 is rejected',params:{...saved,speakerCount:33},prompt:url},
      {label:'explicit empty controls with inferred MIME',params:{},prompt:url,enabled:true},
      {label:'explicit MIME with an extensionless HTTPS URL',params:{mimeType:'audio/wav',timestamps:false},prompt:'https://audio.example.test/recording-A',enabled:true},
      {label:'missing runConfig',params:saved,prompt:url,saveConfig:false},
      {label:'missing URL',params:saved,prompt:''},
      {label:'HTTP URL',params:saved,prompt:'http://audio.example.test/A.wav'},
      {label:'unknown MIME without an extension',params:{timestamps:true},prompt:'https://audio.example.test/recording-A'},
      {label:'File history even with a URL in the composer',params:{...saved,audioFile:'A.wav (128 bytes)'},prompt:url},
      {label:'invalid scalar',params:{...saved,timestamps:'true'},prompt:url},
    ];
    for (const [index,item] of variants.entries()) {
      const next = savedReplayRecord(id,target,item.params,undefined,item.prompt,item.saveConfig !== false);
      props.historySelectionRequest={requestId:index+2,record:next}; await act(async()=>render());
      assert.equal(regenerate().disabled,!item.enabled,item.label);
      const count=calls.length;
      const runnerCount=runnerCalls.length;
      await act(async()=>regenerate().click());
      assert.equal(calls.length,count+(item.enabled?1:0),item.label);
      assert.equal(runnerCalls.length,runnerCount+(item.enabled?1:0),item.label);
      if (item.enabled) {
        assert.equal(calls.at(-1).prompt,item.prompt); assert.deepEqual(calls.at(-1).parameters,item.params);
        assert.equal(runnerCalls.at(-1).audioUrl,item.prompt);
        for (const [key,value] of Object.entries(item.params)) assert.deepEqual(runnerCalls.at(-1)[key],value,`${item.label}: ${key}`);
      }
      else assert.match(container.textContent,/StudioShell.historyInputsUnavailable/);
      assert.deepEqual(parameters,draft);
    }
    props.historySelectionRequest={requestId:variants.length+2,record}; await act(async()=>render());
    await act(async()=>container.querySelector('button[aria-label="StudioShell.useAsDraft"]').click());
    assert.deepEqual(parameters,saved); assert.equal(parameters.audioFile,undefined);
  } finally { await act(async()=>renderer.unmount()); }
});

test('parsed media histories require complete saved requests and distinguish absent from explicit empty controls', async () => {
  const asset = name => ({relativePath:`owned/${name}.wav`,mediaType:'audio/wav',sizeBytes:58,
    sha256:`sha256:${'a'.repeat(64)}`,previewSource:'managed-asset'});
  const source=asset('A'),vocals=asset('vocals'),background=asset('background'),reference=asset('reference');
  const info={sampleRateHz:44100,channels:2,frameCount:441000,durationMs:10000};
  const output = media => ({kind:'artifacts',jobId:'saved-job',jobState:'completed',artifactCount:2,artifacts:[vocals,background],...media});
  const separation = request => output({audioSeparation:{sourceAudio:source,vocals,background,...(request?{request}:{})}});
  const score={relativePath:'owned/score.mid',mediaType:'audio/midi',sizeBytes:58,sha256:`sha256:${'a'.repeat(64)}`,previewSource:'managed-asset'};
  const music={kind:'artifacts',jobId:'saved-job',jobState:'completed',artifactCount:1,artifacts:[score],musicTranscription:{sourceAudio:source,sourceInfo:info,
    inputRange:{startFrame:88200,endFrame:220500},completeness:'complete',origin:'transcribed-estimate',scores:[{relativePath:score.relativePath,format:'midi',part:'note-events'}]}};
  const voice={kind:'artifacts',jobId:'saved-job',jobState:'completed',artifactCount:1,artifacts:[vocals],voiceConversion:{sourceVocal:source,targetVoice:reference,
    sourceInfo:info,inputRange:{startFrame:0,endFrame:441000},vocalInfo:info,vocal:vocals,lengthRelation:'EXACT',durationDeltaMs:0}};
  const cases = [
    {label:'music lacks runConfig',id:'music.transcribe',saved:{},output:music,saveConfig:false},
    {label:'music explicitly empty controls',id:'music.transcribe',saved:{},output:music},
    {label:'music lacks requestedPart',id:'music.transcribe',saved:{requestedFormats:['midi']},output:music},
    {label:'music lacks requestedFormats',id:'music.transcribe',saved:{requestedPart:'note-events'},output:music},
    {label:'music lacks source',id:'music.transcribe',saved:{requestedPart:'note-events',requestedFormats:['midi']}},
    {label:'music invalid range',id:'music.transcribe',saved:{requestedPart:'note-events',requestedFormats:['midi'],startSeconds:5,endSeconds:2},output:music},
    {label:'separation lacks runConfig and saved request',id:'audio.separate',saved:{},output:separation(),saveConfig:false},
    {label:'separation explicitly empty means omitted controls',id:'audio.separate',saved:{},output:separation(),enabled:true},
    {label:'separation recorded range alone is complete (real A shape)',id:'audio.separate',saved:{},output:separation({kind:'range',startSeconds:2,endSeconds:5}),saveConfig:false,enabled:true,range:[2,5]},
    {label:'separation recorded full source is complete',id:'audio.separate',saved:{},output:separation({kind:'full-source'}),saveConfig:false,enabled:true},
    {label:'separation lacks source',id:'audio.separate',saved:{startSeconds:2,endSeconds:5}},
    {label:'voice lacks request controls',id:'audio.voice.convert',saved:{},output:voice,saveConfig:false},
    {label:'voice lacks target kind and target fact',id:'audio.voice.convert',saved:{sourceRelativePath:source.relativePath,sourceMimeType:'audio/wav'}},
  ];
  const calls=[]; let sourcePresent=true;
  const draft={sourceRelativePath:'owned/B.wav',sourceMimeType:'audio/wav',startSeconds:1,endSeconds:4,
    requestedPart:'lead-sheet',requestedFormats:['abc'],targetKind:'reference-audio',targetRelativePath:'owned/B-target.wav',targetMimeType:'audio/wav',semitoneShift:4};
  const container=document.getElementById('root'),renderer=createRoot(container);
  const host={appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},
    app:{projection:{promptDraft:()=>({prompt:''}),projectRunTarget:()=>target,runStatusLabel:s=>s},events:{subscribeAIConfigRefresh:()=>()=>{}},
      commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>({ok:false})}},
    sdk:{aiConfig:{get:async()=>null,getSnapshot:async()=>({effectiveSelections:[]})},listLocalAppVoiceAssets:async()=>[],listLocalAppPresetVoices:async()=>[],
      assets:{stat:async path=>{if(!sourcePresent)throw Error('missing source');return {relativePath:path}}},
      runCapability:async input=>{calls.push(input);return {ok:false,capabilityId:input.capabilityId,reason:'runtime-call-failed',message:'isolated request boundary',actionHint:''}}}};
  let target,props;
  const render=()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},
    createElement(StudioCapabilityParameterContext.Provider,{value:{state:{[props.registration.descriptor.id]:draft},setParameters:()=>{throw Error('history preview cannot mutate draft')}}},createElement(SectionAITesting,props)))));
  const regenerate=()=>container.querySelector('button[aria-label="StudioShell.regenerate"]');
  try {
    for (const [index,item] of cases.entries()) {
      const registration=labStudioComposition.getCapability(item.id);
      target={capabilityId:item.id,capabilityContract:item.id,section:'music',source:'local',status:'configured',canDispatch:true,intentLabel:'Local',detail:'configured',params:{},paramsSummary:[],profileOrigin:null};
      const record=savedReplayRecord(item.id,target,item.saved,item.output,'',item.saveConfig !== false);
      props={registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{[item.id]:[record]},historySelectionRequest:{requestId:index+1,record},
        onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
      await act(async()=>render()); assert.equal(regenerate().disabled,!item.enabled,item.label);
      const count=calls.length; await act(async()=>regenerate().click()); assert.equal(calls.length,count+(item.enabled?1:0),item.label);
      if (item.enabled) {
        assert.equal(calls.at(-1).parameters.sourceRelativePath,source.relativePath);
        if (item.range) assert.deepEqual([calls.at(-1).parameters.startSeconds,calls.at(-1).parameters.endSeconds],item.range);
      } else assert.match(container.textContent,/StudioShell.historyInputsUnavailable/);
    }
    const registration=labStudioComposition.getCapability('audio.separate');
    target={...target,capabilityId:'audio.separate',capabilityContract:'audio.separate'};
    const record=savedReplayRecord('audio.separate',target,{},separation({kind:'range',startSeconds:2,endSeconds:5}),'',false);
    sourcePresent=false;
    props={...props,registration,registrations:[registration],historySelectionRequest:{requestId:cases.length+1,record}};
    await act(async()=>render()); assert.equal(regenerate().disabled,true); assert.match(container.textContent,/StudioShell.historyInputsUnavailable/);
  } finally { await act(async()=>renderer.unmount()); }
});

for(const transcript of [
 {status:'transcribed',text:Array.from({length:401},(_,i)=>`word${i}`).join(' '),language:'',words:Array.from({length:401},(_,i)=>({text:`word${i}`,startSeconds:i*.25,endSeconds:i*.25+.125}))},
 {status:'no-speech',text:'',language:'',words:[]},
]) {
 test(`parsed ${transcript.status} history exports the complete typed transcript`,async()=>{
  const id='audio.transcribe',registration=labStudioComposition.getCapability(id),exports=[],copies=[];
  const target={capabilityId:id,capabilityContract:id,section:'voice',source:'local',status:'configured',canDispatch:true,intentLabel:'Local',detail:'configured',params:{},paramsSummary:[],profileOrigin:null};
  const record=savedReplayRecord(id,target,{timestamps:true},{kind:'transcript',text:transcript.text,transcription:transcript,jobId:'saved-asr-job',jobState:'completed',artifactCount:0});
  assert.equal(record.result.charCount,transcript.text.length);assert.equal(record.result.transcription.words.length,transcript.words.length);
  const host={appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},app:{projection:{promptDraft:()=>({prompt:''}),projectRunTarget:()=>target,runStatusLabel:s=>s},events:{subscribeAIConfigRefresh:()=>()=>{}},commands:{savePromptDraft:async()=>{},copyText:async text=>{copies.push(text);return {ok:true}},exportText:async input=>{exports.push(input);return {ok:false,error:Error('isolated native export boundary')}}}},sdk:{aiConfig:{get:async()=>null},runCapability:()=>{throw Error('export never runs a model')}}};
  const props={registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{[id]:[record]},historySelectionRequest:{requestId:1,record},onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
  const container=document.getElementById('root'),renderer=createRoot(container);
  try{await act(async()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},createElement(SectionAITesting,props)))));assert.equal(container.querySelectorAll('tbody tr').length,Math.min(400,transcript.words.length));
   const exportButton=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='StudioResults.transcript.exportComplete');assert.ok(exportButton);await act(async()=>exportButton.click());assert.equal(exports.length,1);assert.deepEqual(JSON.parse(exports[0].body),transcript);assert.equal(exports[0].filename,'speech-transcript.json');
   if(transcript.words.length){await act(async()=>container.querySelector('button[aria-label="StudioShell.copyGeneration"]').click());assert.equal(copies[0],transcript.text);assert.equal(JSON.parse(exports[0].body).words[0].startSeconds,0);assert.equal(JSON.parse(exports[0].body).words[400].text,'word400')}
  }finally{await act(async()=>renderer.unmount())}
 });
}

for(const item of [{id:'audio.separate',kind:'source'},{id:'audio.voice.convert',kind:'source'},{id:'audio.voice.convert',kind:'target'}]) {
 for(const outcome of ['complete','failure']) {
 test(`${item.id} ${item.kind} replacement ${outcome} blocks execution until its new reference commits`,async()=>{
  const registration=labStudioComposition.getCapability(item.id),writes=[],calls=[];const transfer=Promise.withResolvers();
  let parameters={sourceRelativePath:'owned/source-A.wav',sourceName:'source-A.wav',sourceMimeType:'audio/wav',...(item.id==='audio.voice.convert'?{targetKind:'reference-audio',targetRelativePath:'owned/target-A.wav',targetName:'target-A.wav',targetMimeType:'audio/wav',sourceStartSeconds:2,sourceEndSeconds:5,targetStartSeconds:1,targetEndSeconds:4}:{startSeconds:2,endSeconds:5,includeInstrumentParts:false})};
  const target={capabilityId:item.id,capabilityContract:item.id,section:'music',source:'local',status:'configured',canDispatch:true,intentLabel:'Local',detail:'configured',params:{},paramsSummary:[],profileOrigin:null};
  const profile={sourceKinds:['singing'],targetKinds:['reference-audio'],maxSourceBytes:536870912,maxTargetBytes:536870912,maxSourceSeconds:600,maxTargetSeconds:25,supportsRange:true,supportsSemitoneShift:true,minSemitoneShift:-12,maxSemitoneShift:12};
  const host={appTitle:'Lab',translate:key=>key,locale:'en',clock:{now:()=>Date.now()},app:{projection:{promptDraft:()=>({prompt:''}),projectRunTarget:()=>target,runStatusLabel:s=>s},events:{subscribeAIConfigRefresh:()=>()=>{}},commands:{savePromptDraft:async()=>{},copyText:async()=>({ok:true}),exportText:async()=>({ok:false})}},sdk:{aiConfig:{get:async()=>null,getSnapshot:async()=>({effectiveSelections:[{capabilityContract:item.id,state:'ready',resource:{oneofKind:'local',local:{musicInput:{voiceConvert:[profile]}}}}]})},listLocalAppVoiceAssets:async()=>[],assets:{write:input=>{writes.push(input);return transfer.promise},remove:async()=>{throw Error('existing input assets must not be deleted')}},runCapability:input=>{calls.push(input);throw Error('a pending or failed replacement must not dispatch')}}};
  const props={registration,registrations:[registration],runtime:{status:'connected',detail:'connected'},lastResult:null,history:{},historySelectionRequest:null,onSelectHistoryRun:()=>{},onResult:async()=>null,verboseConsole:false,draftPersistence:false};
  const container=document.getElementById('root'),renderer=createRoot(container);
  const render=()=>renderer.render(createElement(TooltipProvider,null,createElement(AIStudioHostProvider,{value:host},createElement(StudioCapabilityParameterContext.Provider,{value:{state:{[item.id]:parameters},setParameters:(_id,next)=>{parameters=next;render()}}},createElement(SectionAITesting,props)))));
  const primary=()=>container.querySelector(`button[aria-label="${registration.profile.primaryLabelKey}"]`);
  try{
   await act(async()=>render());assert.equal(primary().disabled,false);
   const file=new File([new Uint8Array(128)],'replacement-B.wav',{type:'audio/wav'});Object.defineProperty(file,'stream',{value:()=>new ReadableStream({start(controller){controller.enqueue(new Uint8Array(128));controller.close()}})});
   const input=container.querySelectorAll('input[type=file]')[item.kind==='target'?1:0];Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
   assert.equal(writes.length,1);assert.equal(parameters[`${item.kind}RelativePath`],undefined);assert.equal(primary().disabled,true);
   await act(async()=>container.querySelector('.studio-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls.length,0);
   if(outcome==='complete'){
    await act(async()=>transfer.resolve({relativePath:`owned/${item.kind}-B.wav`}));assert.equal(parameters[`${item.kind}RelativePath`],`owned/${item.kind}-B.wav`);assert.equal(primary().disabled,false);
    if(item.id==='audio.voice.convert'){assert.equal(parameters[item.kind==='source'?'targetRelativePath':'sourceRelativePath'],item.kind==='source'?'owned/target-A.wav':'owned/source-A.wav');assert.equal(parameters[`${item.kind}StartSeconds`],undefined)}else assert.equal(parameters.startSeconds,undefined);
   }else{
    await act(async()=>transfer.reject(Error('controlled storage failure')));assert.match(container.textContent,/controlled storage failure/);assert.equal(primary().disabled,true);assert.equal(calls.length,0);
   }
  }finally{await act(async()=>renderer.unmount())}
 });
 }
}
