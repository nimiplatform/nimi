import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, Cpu, MessageCircle, Pencil, Send, Trash2, X } from 'lucide-react';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat/ui';
import type { StoryText } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT } from '../../content/story-model.js';
import type { HeroDemoAgent } from '../../content/landing-content.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { createChatAgentClient } from '../demo-chat-agent-center.js';
import { createDemoZhiyuAgentCenterSession, type DemoZhiyuAgentCenterSession } from '../demo-zhiyu-agent-center.js';
import { StoryHeading } from './story-shared.js';

const steps = ['home', 'zhiyu', 'memory'] as const;
type ExperienceStep = typeof steps[number];
const explanations = [
  { key: 'models', Icon: Cpu },
  { key: 'memory', Icon: BookOpen },
  { key: 'continuity', Icon: MessageCircle },
] as const;
const noopSubscribe = () => () => {};
const emptySnapshot = () => null;

// @nimi-authority: rule.nimi.cognition.memory.r007
// @nimi-authority: rule.nimi.cognition.memory.r008
/** A guided preview using the same in-browser conversations and memory client as Home and Zhiyu. */
export function StoryExperience({ t, agent, onApp, onHome }: {
  t: StoryText; agent: HeroDemoAgent;
  onApp: (id: string) => void; onHome: (id: string) => void;
}) {
  const session = useHeroDemoSession();
  const [step, setStep] = useState<ExperienceStep>('home');
  const prompt = t(agent.id === DEFAULT_STORY_AGENT ? 'experience.prompt' : 'experience.genericPrompt');
  const [draft, setDraft] = useState(prompt);
  const messages = [...(session.baseMessages[agent.id] ?? []), ...(session.localMessages[agent.id] ?? [])];
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length, step]);

  const client = useMemo(() => session.agentClients.get(agent.id, () => createChatAgentClient(agent, session.demo)), [agent, session.demo, session.agentClients]);
  const [center, setCenter] = useState<DemoZhiyuAgentCenterSession | null>(null);
  useEffect(() => {
    const created = createDemoZhiyuAgentCenterSession(client);
    setCenter(created);
    const unsubscribe = client.subscribeChanges(() => { void created.session.refresh(); });
    return () => { unsubscribe(); created.session.dispose(); };
  }, [client]);
  const snapshot = useSyncExternalStore(center?.session.subscribe ?? noopSubscribe, center?.session.getSnapshot ?? emptySnapshot, emptySnapshot);
  const memories = snapshot?.state.cognition.memory?.items ?? [];
  const hasExampleMemory = session.demo.appPreview.zhiyu.partners.some(partner => partner.id === agent.id && partner.memories.length > 0);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState('');
  const act = async (fn: () => Promise<unknown>, notice: string) => {
    setMemoryBusy(true); setMemoryError(false); setMemoryNotice('');
    try { await fn(); setMemoryNotice(notice); }
    catch { setMemoryError(true); }
    finally { setMemoryBusy(false); }
  };
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    session.submitTo(agent.id, { text }, text === prompt ? t('experience.sampleReply') : session.demo.chat.scriptedReply);
    client.noteConversationTurn();
    setDraft('');
    input.current?.focus({ preventScroll: true });
  };
  const openPreview = () => step === 'zhiyu' ? onApp('nimi.zhiyu') : onHome(agent.id);

  return <section className="story-section story-experience" id="apps" aria-labelledby="experience-heading" data-story-scene>
    <div className="story-container story-experience-composition">
      <div className="story-experience-intro">
        <StoryHeading t={t} section="experience" />
        <ul className="story-ownership-points">
          {explanations.map(({ key, Icon }) => <li key={key}>
            <Icon size={21} aria-hidden="true" />
            <div><h3>{t(`experience.${key}Title`)}</h3><p>{t(`experience.${key}Body`)}</p>
              {key === 'models' && <a href="#models">{t('experience.modelsLink')}<ArrowUpRight size={13} aria-hidden="true" /></a>}
            </div>
          </li>)}
        </ul>
      </div>

      <div className="story-ownership-demo" aria-label={t('experience.demoTitle')}>
        <div className="story-demo-heading"><span>{t('experience.demoTitle')}</span><small>{t('experience.demoLabel')}</small></div>
        <ol className="story-ownership-steps" aria-label={t('experience.demoTitle')}>
          {steps.map((item, index) => <li key={item}><button type="button" aria-current={step === item ? 'step' : undefined}
            aria-controls="ownership-demo-panel" onClick={() => setStep(item)}>
            <span>0{index + 1}</span>{t(`experience.${item}Step`)}
          </button></li>)}
        </ol>
        <div className="story-experience-stage" id="ownership-demo-panel" data-step={step}>
          <p className="story-demo-caption" aria-live="polite">{t(`experience.${step}Caption`)}</p>
          <Surface material="glass-regular" padding="none" className={`story-conversation${step === 'zhiyu' ? ' is-zhiyu' : ''}`}>
            <header>
              <div className="story-conversation-brand"><img src={step === 'zhiyu' ? '/demo/zhiyu-icon.png' : '/logo.svg'} alt="" /><strong>{step === 'zhiyu' ? t('experience.zhiyuApp') : 'Nimi Home'}</strong></div>
              <button type="button" className="story-evidence" onClick={openPreview}>{t('experience.expand')}<ArrowUpRight size={14} aria-hidden="true" /></button>
            </header>
            <div className="story-scene-owner"><img src={agent.avatarUrl} alt="" /><span><strong>{agent.name}</strong><small>{agent.worldName}</small></span><span className="story-owner-label">{t('experience.sameCompanion')}</span></div>
            {step === 'memory' ? <div className="story-memory-scene">
              <h3><BookOpen size={18} aria-hidden="true" />{t('experience.memory')}</h3>
              <p className="story-memory-note">{t('experience.memoryNote')}</p>
              {snapshot?.phase !== 'ready' ? <p role="status">{t('common.loading')}</p> : memories.length ? memories.map(memory => <div className="story-memory-item" key={memory.memoryId}>
                {edit?.id === memory.memoryId ? <>
                  <textarea aria-label={t('experience.editMemory')} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} />
                  <div className="story-inline-actions"><button disabled={memoryBusy || !edit.text.trim()} type="button" onClick={() => act(async () => {
                    await center!.session.correctMemory({ memoryId: edit.id, correctedContent: edit.text.trim() }); setEdit(null);
                  }, t('experience.memorySaved'))}><Check size={15} aria-hidden="true" />{t('experience.save')}</button>
                    <button type="button" disabled={memoryBusy} aria-label={t('common.close')} onClick={() => setEdit(null)}><X size={15} aria-hidden="true" /></button></div>
                </> : <><p>{memory.content}</p><small>{memory.sourceExplanation}</small>
                  <div className="story-inline-actions"><button type="button" disabled={memoryBusy} onClick={() => { setEdit({ id: memory.memoryId, text: memory.content }); setMemoryNotice(''); }}><Pencil size={14} aria-hidden="true" />{t('experience.editMemory')}</button>
                    <button type="button" disabled={memoryBusy} onClick={() => act(() => center!.session.forgetMemory({ memoryIds: [memory.memoryId], confirmed: true }), t('experience.memoryRemoved'))}><Trash2 size={14} aria-hidden="true" />{t('experience.forgetMemory')}</button></div>
                </>}
              </div>) : <><p>{t('experience.memoryEmpty')}</p>{hasExampleMemory && <button className="story-link" type="button" disabled={memoryBusy} onClick={() => act(async () => { client.resetExampleMemory(); await center!.session.refresh(); }, '')}>{t('experience.restoreMemory')}</button>}</>}
              {memoryError && <p role="alert">{t('common.actionError')}</p>}
              <p className="story-memory-notice" role="status">{memoryNotice}</p>
            </div> : <>
              <div className="story-transcript" ref={transcript} role="log" aria-live="polite" aria-label={t('experience.conversation')}>
                {messages.length ? messages.map(message => <div key={message.id} className={`story-message is-${message.role}`}>
                  {message.role === 'assistant' ? <ChatMarkdownRenderer content={message.text} copy={{ markdownCopyLabel: t('common.copy'), markdownCopiedLabel: t('common.copied') }} /> : message.text}
                </div>) : <p className="story-empty-message">{t('experience.emptyConversation')}</p>}
              </div>
              <form onSubmit={e => { e.preventDefault(); submit(); }}><textarea ref={input} aria-label={t('experience.placeholder')} placeholder={t('experience.placeholder')} value={draft} rows={2} onChange={e => setDraft(e.target.value)} onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              }} /><button type="submit" disabled={!draft.trim()} aria-label={t('experience.send')}><Send size={18} aria-hidden="true" /></button></form>
            </>}
          </Surface>
        </div>
        <div className="story-demo-next"><span>{t('experience.browserOnly')}</span><button type="button" onClick={() => setStep(step === 'home' ? 'zhiyu' : step === 'zhiyu' ? 'memory' : 'home')}>
          {t(step === 'home' ? 'experience.nextZhiyu' : step === 'zhiyu' ? 'experience.nextMemory' : 'experience.backHome')}<ArrowRight size={16} aria-hidden="true" />
        </button></div>
      </div>
      <p className="story-ownership-scope">{t('experience.scope')}</p>
    </div>
  </section>;
}
