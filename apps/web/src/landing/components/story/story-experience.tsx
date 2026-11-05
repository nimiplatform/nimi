import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, MessageCircle, Pause, Play, Send, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat/ui';
import type { StoryText, StoryKey } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT, STORY_APPS } from '../../content/story-model.js';
import type { HeroDemoAgent } from '../../content/landing-content.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { createChatAgentClient } from '../demo-chat-agent-center.js';
import { createDemoZhiyuAgentCenterSession, type DemoZhiyuAgentCenterSession } from '../demo-zhiyu-agent-center.js';
import { StoryHeading } from './story-shared.js';

export type ExperienceMode = 'chat' | 'apps' | 'partner' | 'memory' | 'manage';
const modes = ['chat', 'apps', 'partner', 'memory', 'manage'] as const;
const icons = [MessageCircle, Sparkles, BookOpen, BookOpen, Settings2];
const noopSubscribe = () => () => {};
const emptySnapshot = () => null;

export function StoryExperience({ t, agent, mode, onMode, onApp, onHome }: {
  t: StoryText; agent: HeroDemoAgent; mode: ExperienceMode; onMode: (mode: ExperienceMode) => void;
  onApp: (id: string) => void; onHome: (id: string | null) => void;
}) {
  const session = useHeroDemoSession();
  const [channel, setChannel] = useState<'home' | 'zhiyu'>('home');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const target = mode === 'chat' ? 'ai:plan' : agent.id;
  const draft = drafts[target] ?? '';
  const messages = [...(session.baseMessages[target] ?? []), ...(session.localMessages[target] ?? [])];
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [target, messages.length]);
  const client = useMemo(() => session.agentClients.get(agent.id, () => createChatAgentClient(agent, session.demo)), [agent, session.demo, session.agentClients]);
  const [center, setCenter] = useState<DemoZhiyuAgentCenterSession | null>(null);
  useEffect(() => { const c = createDemoZhiyuAgentCenterSession(client); setCenter(c); const unsubscribe = client.subscribeChanges(() => { void c.session.refresh(); }); return () => { unsubscribe(); c.session.dispose(); }; }, [client]);
  const snapshot = useSyncExternalStore(center?.session.subscribe ?? noopSubscribe, center?.session.getSnapshot ?? emptySnapshot, emptySnapshot);
  const memories = snapshot?.state.cognition.memory?.items ?? [];
  const hasExampleMemory = session.demo.appPreview.zhiyu.partners.some(partner => partner.id === agent.id && partner.memories.length > 0);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setMemoryBusy(true); setMemoryError(false);
    try { await fn(); } catch { setMemoryError(true); } finally { setMemoryBusy(false); }
  };
  const proactive = snapshot?.state.autonomy.enabled ?? false;
  const toggle = () => act(async () => {
    const a = center?.session.getSnapshot().state.autonomy;
    if (!center || !a || a.dailyTokenBudget === null || a.maxBackgroundOutputTokens === null || a.freeContactEnabled === null || a.maxFreeContactsPerDay === null) return;
    await center.session.updateAutonomy({ expectedRevision: a.revision ?? '', enabled: !proactive, mode: proactive ? 'off' : 'low', dailyTokenBudget: a.dailyTokenBudget, maxBackgroundOutputTokens: a.maxBackgroundOutputTokens,
      freeContactEnabled: a.freeContactEnabled, maxFreeContactsPerDay: a.maxFreeContactsPerDay, quietHours: a.quietHours });
  });
  const submit = () => {
    if (!draft.trim()) return;
    session.submitTo(target, { text: draft.trim() }, mode === 'chat' ? t('experience.reply') : undefined);
    if (mode !== 'chat') client.noteConversationTurn();
    setDrafts(old => ({ ...old, [target]: '' }));
    input.current?.focus({ preventScroll: true });
  };
  return <section className="story-section story-experience" id="apps" aria-labelledby="experience-heading" data-story-scene data-mode={mode}>
    <div className="story-container story-experience-composition">
      <div className="story-experience-intro"><StoryHeading t={t} section="experience" /><p className="story-mode-caption" id="experience-title">{t(`experience.${mode}Detail` as StoryKey)}</p></div>
      {mode === 'partner' || mode === 'memory' || mode === 'manage' ? <figure className={`story-companion-figure ${agent.id === DEFAULT_STORY_AGENT ? 'is-cutout' : ''}`} key={agent.id}><img src={agent.id === DEFAULT_STORY_AGENT ? '/story/heguan-cutout-v2.webp' : agent.avatarUrl} alt={agent.name} /><figcaption><strong>{agent.name}</strong><span>{agent.worldName}</span></figcaption></figure> : <div className="story-ai-emblem" aria-hidden="true"><img src="/logo.svg" alt="" /><span>{mode === 'chat' ? 'Nimi Chat' : 'Nimi'}</span></div>}
        <div key={mode} className={`story-experience-stage is-${mode}`}>

          {(mode === 'memory' || mode === 'manage') && <div className="story-scene-owner" aria-label={t('experience.selectedCompanion')}><img src={agent.avatarUrl} alt="" /><span><strong>{agent.name}</strong><small>{agent.worldName}</small></span></div>}
          {mode === 'apps' ? <div className="story-app-shelf"><h3>{t('experience.chooseApp')}</h3>{STORY_APPS.map(id => { const app = session.demo.apps.items.find(a => a.id === id)!; return <button key={id} type="button" onClick={() => onApp(id)}><img src={app.iconSrc} alt="" /><span><strong>{app.name}</strong><small>{app.task}</small></span><ArrowUpRight size={20} /></button>; })}</div>
          : mode === 'memory' ? <div className="story-memory-scene">
            <div className="story-memory-paper"><BookOpen size={26} /><h3>{t('experience.memory')}</h3>
              {memories.length ? memories.map(memory => <div className="story-memory-item" key={memory.memoryId}>
                {edit?.id === memory.memoryId ? <><textarea aria-label={t('experience.editMemory')} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /><div className="story-inline-actions"><button disabled={memoryBusy || !edit.text.trim()} type="button" onClick={() => act(async () => { await center!.session.correctMemory({ memoryId: edit.id, correctedContent: edit.text.trim() }); setEdit(null); })}><Check size={15} />{t('experience.save')}</button><button type="button" aria-label={t('common.close')} onClick={() => setEdit(null)}><X size={15} /></button></div></> : <><p>{memory.content}</p><small>{memory.sourceExplanation}</small><div className="story-inline-actions"><button type="button" onClick={() => setEdit({ id: memory.memoryId, text: memory.content })}>{t('experience.editMemory')}</button><button type="button" disabled={memoryBusy} onClick={() => act(async () => center!.session.forgetMemory({ memoryIds: [memory.memoryId], confirmed: true }))}><Trash2 size={14} />{t('experience.forgetMemory')}</button></div></>}
              </div>) : <><p>{t('experience.memoryEmpty')}</p>{hasExampleMemory && <button type="button" disabled={memoryBusy || snapshot?.phase !== 'ready'} onClick={() => act(async () => { client.resetExampleMemory(); await center?.session.refresh(); })}>{t('experience.restoreMemory')}</button>}</>}
              {memoryError && <p role="alert">{t('common.actionError')}</p>}
            </div>
          </div> : mode === 'manage' ? <div className="story-manage-scene"><p className="story-life-steps">{t('experience.life')}</p><div className="story-management-control"><div><h3>{t('experience.proactive')}</h3><p>{t('experience.proactiveNote')}</p></div><button type="button" aria-pressed={proactive} disabled={memoryBusy || snapshot?.phase !== 'ready'} onClick={toggle}>{proactive ? <Pause size={18} /> : <Play size={18} />}{t(proactive ? 'experience.enabled' : 'experience.disabled')}</button></div><button className="story-link" type="button" onClick={() => onHome(agent.id)}>{t('common.viewApp')}<ArrowUpRight size={16} /></button>{memoryError && <p role="alert">{t('common.actionError')}</p>}</div>
          : <div className={`story-conversation ${channel === 'zhiyu' && mode === 'partner' ? 'is-zhiyu' : ''}`}>
            <header><div className="story-conversation-brand"><img src={mode === 'chat' ? '/logo.svg' : agent.avatarUrl} alt="" /><strong>{mode === 'chat' ? 'Nimi Chat' : agent.name}</strong></div>{mode === 'partner' ? <div className="story-channel"><button type="button" aria-pressed={channel === 'home'} onClick={() => { setChannel('home'); onHome(agent.id); }}>{t('experience.home')}</button><button type="button" aria-pressed={channel === 'zhiyu'} onClick={() => { setChannel('zhiyu'); onApp('nimi.zhiyu'); }}>{t('experience.zhiyu')}</button></div> : <MessageCircle size={18} />}</header>
            <div className="story-transcript" ref={transcript} role="log" aria-live="polite" aria-label={t('experience.chat')}>
              {messages.length ? messages.map(m => <div key={m.id} className={`story-message is-${m.role}`}>{m.role === 'assistant' ? <ChatMarkdownRenderer content={m.text} copy={{ markdownCopyLabel: t('common.copy'), markdownCopiedLabel: t('common.copied') }} /> : m.text}</div>) : <div className="story-empty-message"><Sparkles size={32} /><p>{mode === 'chat' ? t('hero.peek') : agent.bio}</p></div>}
            </div>
            <form onSubmit={e => { e.preventDefault(); submit(); }}><textarea ref={input} aria-label={t('experience.placeholder')} placeholder={t('experience.placeholder')} value={draft} rows={2} onChange={e => setDrafts(old => ({ ...old, [target]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} /><button type="submit" disabled={!draft.trim()} aria-label={t('experience.send')}><Send size={19} /></button></form>
            <button type="button" className="story-evidence" onClick={() => mode === 'partner' && channel === 'zhiyu' ? onApp('nimi.zhiyu') : onHome(target)}>{t('common.viewApp')}<ArrowUpRight size={15} /></button>
          </div>}
        </div>
      <div className="story-journey" role="group" aria-label={t('common.experience')}>
        {modes.map((item, index) => { const Icon = icons[index]!; return <button key={item} type="button" aria-pressed={mode === item} onClick={() => onMode(item)}><span className="story-journey-index">0{index + 1}</span><Icon size={18} /><span>{t(`experience.${item}`)}</span><ChevronRight size={15} /></button>; })}
      </div>
    </div>
  </section>;
}
