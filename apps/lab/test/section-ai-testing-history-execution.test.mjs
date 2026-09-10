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
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'FileReader']) {
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
      export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
      export { labStudioComposition } from './src/lab/lab-studio-composition.ts';`,
    resolveDir:root, loader:'ts',
  },
  outfile:path.join(buildDir,'studio.mjs'), bundle:true, packages:'external',
  platform:'node', format:'esm', target:'es2022', jsx:'automatic', logLevel:'silent',
});
const { SectionAITesting, TextStudioComposer, AIStudioHostProvider, labStudioComposition } = await import(pathToFileURL(path.join(buildDir,'studio.mjs')).href);

test.after(async () => {
  dom.window.close();
  await rm(buildDir, { recursive:true, force:true });
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
