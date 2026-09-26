import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppAgentIntroduction } from '@nimiplatform/kit/core/sdk-contract';
import { AgentIntroduction } from '../src/components/agent-introduction.js';
import { agentIntroductionQuestions, agentIntroductionSubtitle } from '../src/agent-introduction.js';
import { useAgentIntroduction } from '../src/runtime/agent-introduction.js';
import { CanonicalTranscriptView } from '../src/components/canonical-transcript-view.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const intro: NimiLocalAppAgentIntroduction = { worldName: '清代', era: 'qing-dynasty', role: '学者', greeting: '與你談談讀書。', referenceImageUrl: 'https://cdn.example.test/full.png', voiceSampleUrl: null, voiceSampleDurationSec: null, questionTopics: [{kind:'role',text:'学者'},{kind:'work',text:'潛研堂集'}] };

describe('shared Agent introduction', () => {
 it('keeps the empty introduction at the top when a footer arrives', async () => {
  const container = document.createElement('div'); const root = createRoot(container);
  const render = (footer?: React.ReactNode) => <CanonicalTranscriptView messages={[]} activeConversationId="empty" emptyStateContent={<div>Character introduction</div>} footerContent={footer} />;
  try {
   await act(async () => root.render(render()));
   const viewport = container.querySelector<HTMLElement>('[data-canonical-transcript-root]')!;
   Object.defineProperties(viewport,{clientHeight:{value:500,configurable:true},scrollHeight:{value:800,configurable:true}});
   await act(async () => root.render(render(<p>Optional application references</p>)));
   expect(viewport.scrollTop).toBe(0);
  } finally { await act(async () => root.unmount()); }
 });
 it('keeps authored introduction visible while input is unavailable', () => {
  const html = renderToStaticMarkup(<AgentIntroduction introduction={intro} displayName="钱大昕" locale="zh-CN" questionsEnabled={false} onPrefill={() => undefined} />);
  expect(html).toContain('清代 · 学者');
  expect(html).toContain('与你谈谈读书。');
  expect(html).toContain('https://cdn.example.test/full.png');
  expect(html).not.toContain('data-agent-empty-suggestions');
  expect(html).not.toContain('秦代');
 });
 it('does not fabricate missing material and localizes up to two questions', () => {
  const html = renderToStaticMarkup(<AgentIntroduction introduction={null} displayName="Partner" locale="en" questionsEnabled onPrefill={() => undefined} />);
  expect(html).toContain('Start a conversation');
  expect(html).not.toContain('data-agent-empty-character-image');
  expect(agentIntroductionQuestions(intro,'zh-CN')).toHaveLength(2);
  expect(agentIntroductionQuestions(intro,'en')[0]).toBe('Why are you known as 学者?');
  expect(agentIntroductionSubtitle({...intro, era:'beijing', worldName:null, role:null},'zh-CN')).toBe('beijing');
  expect(agentIntroductionQuestions({...intro, questionTopics:[{kind:'work',text:'著述线索'},{kind:'topic',text:'association：数据库线索'},{kind:'topic',text:'scene-grounded-greeting'}]},'zh')).toEqual(['介绍一下你自己','陪我随便聊聊','给我讲个有趣的故事']);
  expect(agentIntroductionQuestions({...intro, questionTopics:[{kind:'topic',text:'poetry'}]},'en')).toEqual(['How would you explain poetry?']);
 });
 it('question clicks only prefill the controlled draft', async () => {
  const onPrefill = vi.fn(); const container = document.createElement('div'); const root = createRoot(container);
  try {
   await act(async () => root.render(<AgentIntroduction introduction={intro} displayName="钱大昕" locale="zh" questionsEnabled onPrefill={onPrefill} />));
   await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-empty-suggestions] button')!.click());
   expect(onPrefill).toHaveBeenCalledExactlyOnceWith('你为什么被称为学者？');
  } finally { await act(async () => root.unmount()); }
 });
 it('distinguishes a failed read from absent material without disabling conversation suggestions', () => {
  const html = renderToStaticMarkup(<AgentIntroduction introduction={null} displayName="Partner" locale="zh" questionsEnabled onPrefill={() => undefined} unavailable onRetry={() => undefined} />);
  expect(html).toContain('人物介绍暂时无法加载。');
  expect(html).toContain('重试');
  expect(html).toContain('介绍一下你自己');
 });
 it('ignores late results after switching partners and exposes read failure separately', async () => {
  let resolveFirst!: (value: NimiLocalAppAgentIntroduction) => void;
  const getIntroduction = vi.fn(async ({agentHandle}: {agentHandle:string}) => agentHandle === 'A' ? new Promise<NimiLocalAppAgentIntroduction>(resolve => { resolveFirst = resolve; }) : {...intro, greeting:'B'});
  function Consumer({handle}: {handle:string}) { const value = useAgentIntroduction({agentHandle:handle,getIntroduction}); return <span>{value.introduction?.greeting ?? 'loading'}</span>; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
   await act(async () => root.render(<Consumer handle="A" />));
   await act(async () => root.render(<Consumer handle="B" />));
   await act(async () => resolveFirst(intro));
   expect(container.textContent).toBe('B');
  } finally { await act(async () => root.unmount()); }
 });
 it('attempts autoplay, supports stop with rewind, and releases audio on unmount', async () => {
  let paused = true;
  const play = vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement) { paused=false; this.dispatchEvent(new Event('play')); return Promise.resolve(); });
  const pause = vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement) { paused=true; this.dispatchEvent(new Event('pause')); });
  const pausedGetter = vi.spyOn(HTMLMediaElement.prototype,'paused','get').mockImplementation(() => paused);
  const container = document.createElement('div'); const root = createRoot(container);
  try {
   await act(async () => root.render(<AgentIntroduction introduction={{...intro,voiceSampleUrl:'https://cdn.example.test/voice.mp3'}} displayName="钱大昕" locale="zh" questionsEnabled={false} />));
   expect(play).toHaveBeenCalledOnce();
   const audio = container.querySelector('audio')!; audio.currentTime=3;
   await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-empty-character-voice]')!.click());
   expect(audio.currentTime).toBe(0); expect(pause).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); play.mockRestore();pause.mockRestore();pausedGetter.mockRestore(); }
 });
});
