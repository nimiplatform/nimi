import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AmbientBackground, Button, IconButton, TextField, TextareaField } from '@nimiplatform/kit/ui';
import { ModelConfigAIConfigSurface, type ModelConfigAIConfigSurfaceProps } from '@nimiplatform/kit/features/model-config';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Feather,
  Fingerprint,
  ImagePlus,
  Lightbulb,
  MessageCircle,
  Moon,
  MousePointer2,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type { HeroDemoOddBureauMoodId, HeroDemoOddBureauMystery, HeroDemoOddBureauPreview } from '../content/landing-content.js';
import {
  actionText,
  commitPromises,
  editMachinePath,
  findStrikeSolution,
  hitProp,
  initialMachine,
  interpretProposalLocally,
  machineChallenge,
  NOTE_NAMES,
  offerText,
  OP_COPY,
  runMachine,
  simulateMachine,
  strikeReady,
  TASK_NAMES,
  TASKS,
  type MachineRound,
  type Note,
  type PlayRound,
  type PromiseAction,
  type Prop,
  type StrikeRound,
} from './demo-odd-bureau-rules.js';

/**
 * Interactive replica of the Odd Bureau (奇物局) app (nimiapp-odd-bureau
 * src/odd-bureau): the playground lobby, the 怪机器 and 罢工谈判 activities,
 * the 照片探案 mystery, and the capability setup page, mounted on the app's
 * own class names over the stylesheet ported in demo-odd-bureau.css. The
 * fixed play rules run for real (demo-odd-bureau-rules.ts, including the
 * local tone player); what Runtime AI produces in the app comes from the
 * authored landing content, and the preparation stages are timed to read
 * the way the app's locate/generate progress does.
 */

type Photo = HeroDemoOddBureauPreview['photo'];
type PlaySave = { id: string; props: Prop[]; round: PlayRound };
type Message = { who: 'player' | 'object'; text: string };
type Session = {
  id: string;
  mood: HeroDemoOddBureauMoodId;
  props: Prop[];
  mystery: HeroDemoOddBureauMystery;
  discovered: string[];
  evidence: string[];
  messages: Record<string, Message[]>;
  accusation: string | null;
};

const MOODS = [
  { id: 'missing', name: '离奇失窃', hint: '谁动了大家的宝贝？' },
  { id: 'strike', name: '集体罢工', hint: '总有一个带头搞事的。' },
  { id: 'party', name: '秘密派对', hint: '主人不在，谁最会玩？' },
] as const;

const LOCATE_STEP_MS = 320;
const WRITE_MS = 1100;
const PROPOSAL_MS = 700;
const PERFORMANCE_MS = 1300;
const STREAM_TICK_MS = 28;
const NOTICE_MS = 6_000;
let seed = 0;
const mintId = () => `demo-${(seed += 1).toString(36)}`;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '这次操作没有完成，请重试。';
}
const canAccuse = (session: Session) => session.evidence.length >= 2;

/** Port of the app's TonePlayer: the machine performs its note rules locally as sound. */
class TonePlayer {
  private context: AudioContext | null = null;
  private finish: ((completed: boolean) => void) | null = null;
  async play(notes: readonly Note[]): Promise<boolean> {
    this.stop();
    if (!notes.length) return false;
    const context = new AudioContext();
    this.context = context;
    await context.resume();
    if (this.context !== context) return false;
    if (context.state !== 'running') { this.stop(); throw new Error('声音没有开始播放，请再点一次试听。'); }
    const pitches = [261.626, 293.665, 329.628, 391.995, 440];
    let time = context.currentTime + 0.025;
    return new Promise<boolean>((resolve) => {
      this.finish = resolve;
      notes.forEach((note, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const duration = note.beats * 0.23;
        oscillator.type = 'triangle';
        oscillator.frequency.value = pitches[note.pitch]!;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.15, time + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.025);
        if (index === notes.length - 1) oscillator.onended = () => { if (this.context === context) { resolve(true); this.stop(); } else resolve(false); };
        time += duration + 0.055;
      });
    });
  }
  stop() {
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
    this.finish?.(false);
    this.finish = null;
  }
}

/* ------------------------------------------------------------------------ */
/* Photo stage (PhotoStage.tsx)                                               */
/* ------------------------------------------------------------------------ */

function ObjectPortrait({ prop, photo, className = '' }: { prop: Prop; photo: Photo; className?: string }) {
  const b = prop.box;
  return (
    <svg className={`prop-portrait ${className}`} viewBox={`${b.x1 * photo.width} ${b.y1 * photo.height} ${(b.x2 - b.x1) * photo.width} ${(b.y2 - b.y1) * photo.height}`} role="img" aria-label={prop.label}>
      <image href={photo.src} width={photo.width} height={photo.height} />
    </svg>
  );
}

function PhotoStage({
  photo, objects, selected, path = [], badges = {}, resting, active, flowing, onSelect, onConnect, instruction, children, markerId,
}: {
  photo: Photo; objects: Prop[]; selected?: string | null; path?: string[]; badges?: Record<string, string>;
  resting?: string | null; active?: string | null; flowing?: boolean; onSelect?: (id: string) => void;
  onConnect?: (from: string, to: string) => void; instruction: string; children?: ReactNode; markerId: string;
}) {
  const centers = path.map((id) => objects.find((p) => p.id === id)).filter((p): p is Prop => !!p).map((p) => ({ x: (p.box.x1 + p.box.x2) * 500, y: (p.box.y1 + p.box.y2) * 500 }));
  return (
    <section className="play-scene" aria-label="照片游乐场">
      <div className="scene-top"><span><span className="live-dot" />{instruction}</span><span>{photo.name}</span></div>
      <div className="play-image-wrap">
        <div className="play-image-plane" style={{ aspectRatio: `${photo.width}/${photo.height}`, '--photo-ratio': photo.width / photo.height } as CSSProperties}>
          <img src={photo.src} alt={`照片舞台：${photo.name}。AI 创作的试玩照片。`} draggable={false} />
          {!!centers.length && (
            <svg className={`play-wires ${flowing ? 'is-flowing' : ''}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#c7f6a8" /></marker></defs>
              {centers.slice(1).map((to, i) => <line key={i} x1={centers[i]!.x} y1={centers[i]!.y} x2={to.x} y2={to.y} markerEnd={`url(#${markerId})`} vectorEffect="non-scaling-stroke" />)}
            </svg>
          )}
          {objects.map((prop, i) => (
            <button
              key={prop.id}
              type="button"
              className={`play-object ${selected === prop.id ? 'selected' : ''} ${path.includes(prop.id) ? 'connected' : ''} ${resting === prop.id ? 'resting' : ''} ${active === prop.id ? 'performing' : ''}`}
              style={{ left: `${prop.box.x1 * 100}%`, top: `${prop.box.y1 * 100}%`, width: `${(prop.box.x2 - prop.box.x1) * 100}%`, height: `${(prop.box.y2 - prop.box.y1) * 100}%` }}
              aria-label={`选择${prop.label}：${badges[prop.id] ?? '物品'}`}
              onClick={() => onSelect?.(prop.id)}
              disabled={!onSelect}
              draggable={!!onConnect}
              onDragStart={(event) => { event.dataTransfer.setData('application/odd-bureau-object', prop.id); event.dataTransfer.effectAllowed = 'link'; }}
              onDragOver={(event) => { if (onConnect) { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; } }}
              onDrop={(event) => { event.preventDefault(); const from = event.dataTransfer.getData('application/odd-bureau-object'); if (from && objects.some((p) => p.id === from) && from !== prop.id) onConnect?.(from, prop.id); }}
            >
              <span className="play-object-number">{path.includes(prop.id) ? path.indexOf(prop.id) + 1 : i + 1}</span>
              <span className="play-object-label">{prop.label}<small>{badges[prop.id]}</small></span>
            </button>
          ))}
          {!objects.length && <div className="sample-tag">AI 创作的试玩照片 · 开玩后，物品就会登场</div>}
          {children}
        </div>
      </div>
      {!!objects.length && (
        <div className="play-cast" aria-label="物品按钮">
          {objects.map((prop) => (
            <button key={prop.id} type="button" onClick={() => onSelect?.(prop.id)} disabled={!onSelect} className={selected === prop.id ? 'selected' : ''} aria-label={`选择${prop.label}`}>
              <ObjectPortrait prop={prop} photo={photo} /><span>{prop.label}</span><small>{badges[prop.id] ?? ''}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Machine game (MachineGame.tsx)                                             */
/* ------------------------------------------------------------------------ */

function Notes({ notes, label }: { notes: readonly Note[]; label?: string }) {
  return (
    <div className="note-strip" role="img" aria-label={label ?? notes.map((n) => `${NOTE_NAMES[n.pitch]}${n.beats}拍`).join('、')}>
      {notes.map((n, i) => <span key={i} className={`note note-${n.pitch}`} title={`${NOTE_NAMES[n.pitch]} · ${n.beats}拍`}><span>{NOTE_NAMES[n.pitch]}</span>{n.beats > 1 && <small>×{n.beats}</small>}</span>)}
      {!notes.length && <span className="empty-notes">还没有声音</span>}
    </div>
  );
}

function MachineGame({ photo, objects, round, onChange, markerId }: { photo: Photo; objects: Prop[]; round: MachineRound; onChange: (round: MachineRound) => void; markerId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const player = useRef<TonePlayer | null>(null);
  const playId = useRef(0);
  const latest = useRef(round);
  latest.current = round;
  if (!player.current) player.current = new TonePlayer();
  useEffect(() => () => { playId.current++; player.current?.stop(); }, []);
  const { plan, state } = round;
  const goal = useMemo(() => machineChallenge(plan, objects), [plan, objects]);
  let preview: ReturnType<typeof simulateMachine> | null = null;
  let pathHint = '从一个发声物品开始，再接改造器和容器。';
  try { preview = simulateMachine(plan, objects, state.path); pathHint = ''; } catch (e) { if (state.path.length) pathHint = errorMessage(e); }
  const node = plan.nodes.find((n) => n.objectId === selected);
  const prop = objects.find((p) => p.id === selected);
  const label = (id: string) => objects.find((p) => p.id === id)!.label;
  function stop() { playId.current++; player.current?.stop(); setPlaying(false); }
  async function listen(notes: readonly Note[]): Promise<boolean> {
    const id = ++playId.current;
    setPlaying(true); setError('');
    try { return await player.current!.play(notes); }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { if (playId.current === id) setPlaying(false); }
  }
  function select(id: string) {
    stop(); setSelected(id); setError('');
    if (!state.path.length && plan.nodes.find((n) => n.objectId === id)?.op !== 'source') return;
    try { onChange({ ...round, state: { ...state, path: editMachinePath(plan, state.path, id) } }); }
    catch (e) { setError(errorMessage(e)); }
  }
  function connect(from: string, to: string) {
    stop(); setError(''); setSelected(to);
    try { const path = editMachinePath(plan, editMachinePath(plan, state.path, from), to); onChange({ ...round, state: { ...state, path } }); }
    catch (e) { setError(errorMessage(e)); }
  }
  function run() {
    setError('');
    try { const next = runMachine(plan, objects, state); onChange({ ...round, state: next }); if (sound) void listen(next.lastRun!.notes); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function pour(id: string) {
    const notes = state.stored[id] ?? [];
    const completed = await listen(notes);
    if (completed) { const current = latest.current; onChange({ ...current, state: { ...current.state, stored: { ...current.state.stored, [id]: [] } } }); }
  }
  const deviceDetail = (
    <div className="device-detail">
      {node && prop ? (
        <>
          <div className="device-heading"><ObjectPortrait prop={prop} photo={photo} /><div><h3>{prop.label}</h3><span>{OP_COPY[node.op].name}</span></div></div>
          <p className="character-line">“{node.line}”</p>
          <p className="fixed-rule">{OP_COPY[node.op].rule}</p>
          {node.op === 'source' && <Notes notes={node.melody.map((pitch) => ({ pitch, beats: 1 }))} />}
        </>
      ) : (
        <><h3>这些家伙，各有一招。</h3><p>点照片里的物品查看规则。它们今天的本领已经确定，反复试也不会偷偷改口。</p></>
      )}
    </div>
  );
  return (
    <div className="play-layout machine-game">
      <div className="play-left">
        <div className="mobile-machine-goal"><strong>{state.solved ? '挑战完成，继续自由发明。' : `把这段声音送进${label(goal.receiver)}`}</strong><div><Notes notes={goal.notes} /><button type="button" onClick={() => void listen(goal.notes)} aria-label="试听目标旋律"><Volume2 size={19} /></button></div><small>本次挑战的线长预算：{goal.cost}</small></div>
        <PhotoStage photo={photo} objects={objects} selected={selected} path={state.path} flowing={playing} badges={Object.fromEntries(plan.nodes.map((n) => [n.objectId, OP_COPY[n.op].name]))} onSelect={select} onConnect={connect} instruction="点选连线，也可以把一件物品拖向另一件" markerId={markerId} />
        <div className="mobile-device-detail" aria-live="polite">{deviceDetail}</div>
        <div className="route-bench">
          <div className="route-heading"><strong>我的线路</strong><button type="button" onClick={() => { stop(); onChange({ ...round, state: { ...state, path: [] } }); }} disabled={!state.path.length}><RotateCcw size={14} />拆掉线路</button></div>
          <div className="route-chips">
            {state.path.map((id, i) => <span className="route-chip-wrap" key={id}>{i > 0 && <ChevronRight size={15} />}<span className="route-chip">{label(id)}<button type="button" aria-label={`从线路移除${label(id)}`} onClick={() => { stop(); onChange({ ...round, state: { ...state, path: state.path.filter((p) => p !== id) } }); }}><X size={12} /></button></span></span>)}
            {!state.path.length && <p>先找带着「发声」标签的物品。</p>}
          </div>
          {preview ? <div className="run-preview"><div><span>照这条线，会得到</span><Notes notes={preview.notes} /></div><span className="wire-cost">线长 {preview.cost}<small>挑战预算 {goal.cost}</small></span></div> : <p className="path-hint">{pathHint}</p>}
          <div className="machine-run-actions"><Button className="primary-key" leadingIcon={<Play size={18} />} onClick={run} disabled={!preview || playing}>启动这台怪机器</Button><IconButton icon={playing ? <Square size={17} /> : <Volume2 size={18} />} aria-label={playing ? '停止声音' : sound ? '关闭运行声音' : '开启运行声音'} onClick={playing ? stop : () => setSound((v) => !v)} className={`sound-key ${sound ? 'enabled' : ''}`} /></div>
        </div>
        {state.lastRun && <div className="machine-trace" aria-label="刚才的运行过程"><strong>刚才，声音经过了这里</strong>{state.lastRun.trace.map((step) => <div key={step.objectId}><span>{label(step.objectId)}</span><Notes notes={step.notes} /></div>)}</div>}
      </div>
      <aside className="activity-panel">
        <div className={`machine-goal ${state.solved ? 'solved' : ''}`}><span className="goal-symbol">{state.solved ? <Check size={25} /> : <Volume2 size={25} />}</span><h2>{state.solved ? '成了！再胡思乱想一次？' : '先造出这一小段声音'}</h2><p>送进<strong>{label(goal.receiver)}</strong>，线长不超过 {goal.cost}。</p><Notes notes={goal.notes} /><button type="button" className="text-action" onClick={() => void listen(goal.notes)}>听听目标旋律 <Play size={13} /></button>{state.solved && <p className="success-caption">目标已完成。换一条线，看看它还能变出什么。</p>}</div>
        {deviceDetail}
        <div className="sound-shelves"><h3>装起来的声音</h3>{plan.nodes.filter((n) => n.op === 'store').map((n) => { const notes = state.stored[n.objectId] ?? []; return <div className="sound-shelf" key={n.objectId}><div><strong>{label(n.objectId)}</strong><span>{notes.length} / 32 个音</span></div><Notes notes={notes} /><div className="shelf-actions"><button type="button" disabled={!notes.length || playing} onClick={() => void pour(n.objectId)}><Volume2 size={14} />倒出来听</button><button type="button" disabled={!notes.length || playing} onClick={() => onChange({ ...round, state: { ...state, stored: { ...state.stored, [n.objectId]: [] } } })}><Trash2 size={14} />清空</button></div></div>; })}</div>
        {error && <p className="play-error" role="alert">{error}</p>}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Strike game (StrikeGame.tsx)                                               */
/* ------------------------------------------------------------------------ */

function StrikeGame({ content, photo, objects, round, onChange, onRestart, onVoice, markerId }: { content: HeroDemoOddBureauPreview; photo: Photo; objects: Prop[]; round: StrikeRound; onChange: (round: StrikeRound) => void; onRestart: () => void; onVoice: () => void; markerId: string }) {
  const [selected, setSelected] = useState(objects[0]!.id);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<{ reply: string; actions: PromiseAction[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const proposalPanel = useRef<HTMLDivElement>(null);
  const { plan, state } = round;
  const current = commitPromises(plan, [], state.promises);
  const ready = strikeReady(current);
  const performance = state.performance;
  const deadlocked = useMemo(() => !findStrikeSolution(plan, state.promises), [plan, state.promises]);
  const person = plan.people.find((p) => p.objectId === selected)!;
  const prop = objects.find((p) => p.id === selected)!;
  const label = (id: string | null | undefined) => objects.find((p) => p.id === id)?.label ?? '还没有人';
  let preview: ReturnType<typeof commitPromises> | null = null;
  let proposalError = '';
  if (proposal?.actions.length) { try { preview = commitPromises(plan, state.promises, proposal.actions); } catch (e) { proposalError = errorMessage(e); } }
  const proposalEndsRound = preview ? !findStrikeSolution(plan, preview.promises) : false;
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (proposal) proposalPanel.current?.scrollIntoView({ block: 'nearest' }); }, [proposal]);
  function propose(action: PromiseAction) { setError(''); setProposal({ reply: '先看看这份安排的影响，确认后才算承诺。', actions: [action] }); }
  function confirm() {
    if (!proposal?.actions.length || !preview) return;
    const next = commitPromises(plan, state.promises, proposal.actions);
    onChange({ ...round, state: { ...state, promises: next.promises, journal: [...state.journal, ...proposal.actions.map((a) => `已兑现：${actionText(a, objects)}`)].slice(-12) } });
    setProposal(null); setMessage('');
  }
  async function ask() {
    if (!message.trim() || busy) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError(''); setProposal(null);
    try { await sleep(PROPOSAL_MS, controller.signal); setProposal(interpretProposalLocally(plan, objects, message.trim())); }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  async function perform() {
    if (!ready || busy) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try { await sleep(PERFORMANCE_MS, controller.signal); onChange({ ...round, state: { ...state, performance: [...content.performance], curtain: 0 } }); }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const badges = Object.fromEntries(objects.map((p) => [p.id, current.rest === p.id ? '获准休息' : [...TASKS.filter((t) => current.tasks[t] === p.id).map((t) => TASK_NAMES[t]), ...(current.credit === p.id ? ['署名'] : [])].join(' · ') || (performance ? '观众席' : '等你来谈')]));
  return (
    <div className="play-layout strike-game">
      <div className="play-left">
        <PhotoStage photo={photo} objects={objects} selected={selected} badges={badges} resting={current.rest} active={performance && state.curtain < 3 ? current.tasks.reading : null} onSelect={(id) => { if (!busy) setSelected(id); }} instruction={performance ? state.curtain === 3 ? '故事会已谢幕，每一份承诺都算数' : '故事会开场了' : '点一位伙伴，听听它愿意做什么'} markerId={markerId} />
        <div className="promise-board"><div className="route-heading"><strong>已经答应的事</strong><span>{state.promises.length} 份承诺</span></div>{state.promises.length ? <ol>{state.promises.map((a, i) => <li key={i}><Check size={15} />{actionText(a, objects)}</li>)}</ol> : <p>先聊条件，再确认。许出的约定，这一局会一直遵守。</p>}</div>
      </div>
      <aside className="activity-panel">
        <div className="strike-mission"><h2>{performance ? state.curtain === 3 ? '说到做到，故事落幕。' : '今晚的故事会' : '让故事会开得成。'}</h2><p>{performance ? `署名：${label(current.credit)} · 朗读：${label(current.tasks.reading)}` : plan.situation}</p><div className="allocation-row"><span><Moon size={16} />{current.rest ? `${label(current.rest)}休息` : '一份休假'}</span><span><Feather size={16} />{current.credit ? `${label(current.credit)}署名` : '一份署名'}</span></div><p className="strike-limits">每件最多两份工作；休假伙伴不工作，署名留给工作者。</p><div className="task-slots">{TASKS.map((task) => <div key={task} className={current.tasks[task] ? 'filled' : ''}><span>{TASK_NAMES[task]}</span><strong>{label(current.tasks[task])}</strong>{current.tasks[task] && <Check size={14} />}</div>)}</div></div>
        {performance ? (
          <div className="performance">
            <p className="leave-note"><Moon size={16} />{label(current.rest)}安心休息，所有安排照约定进行。</p>
            {state.curtain < 3 ? (
              <>
                <span className="act-number">{label(current.tasks.story)}的童话 · 第 {state.curtain + 1} 幕 / 3</span>
                <p className="story-part">{performance[state.curtain]}</p>
                <Button className="upload-key" leadingIcon={<Volume2 size={17} />} onClick={onVoice}>{`听${label(current.tasks.reading)}读这一幕`}</Button>
                <Button className="primary-key" trailingIcon={<ArrowRight size={18} />} onClick={() => onChange({ ...round, state: { ...state, curtain: state.curtain + 1 } })}>{state.curtain === 2 ? '谢幕' : '下一幕'}</Button>
              </>
            ) : (
              <><div className="curtain-check"><Check size={35} /></div><p className="story-part">有人得到了休息，有人终于被写进名字里。这场故事会，是你安排出来的。</p>{performance.map((part, i) => <p className="recap-part" key={i}>{part}</p>)}</>
            )}
          </div>
        ) : deadlocked ? (
          <div className="performance round-failed"><h2>这一次，没能开场。</h2><p className="story-part">已经许出的约定不会被收回，但它们让剩下的工作无法安排齐。</p><p>看看左边的承诺，下一轮可以换一种选择。</p><Button className="primary-key" onClick={onRestart}>另开一轮谈判</Button></div>
        ) : (
          <>
            <div className="strike-person">
              <div className="device-heading"><ObjectPortrait prop={prop} photo={photo} /><div><h3>{prop.label}</h3><span>{person.persona}</span></div></div>
              <div className="allocation-actions"><Button size="sm" leadingIcon={<Moon size={14} />} disabled={busy || !!current.rest} onClick={() => propose({ kind: 'rest', objectId: selected })}>提议让它休息</Button><Button size="sm" leadingIcon={<Feather size={14} />} disabled={busy || !!current.credit} onClick={() => propose({ kind: 'credit', objectId: selected })}>提议给它署名</Button></div>
              <div className="offer-list">{person.offers.map((offer) => <button type="button" key={offer.task} disabled={busy || !!current.tasks[offer.task]} onClick={() => propose({ kind: 'assign', objectId: selected, task: offer.task })}><span><strong>{TASK_NAMES[offer.task]}</strong><small>{offerText(offer, objects)}</small></span>{current.tasks[offer.task] ? <Check size={16} /> : <ArrowRight size={16} />}</button>)}</div>
            </div>
            {proposal && (
              <div className="proposal-review" ref={proposalPanel}>
                <div><strong>还没许出口的提议</strong><button type="button" aria-label="收起提议" onClick={() => setProposal(null)}><X size={16} /></button></div>
                <p>{proposal.reply}</p>
                {proposal.actions.length > 0 && <ol>{proposal.actions.map((a, i) => <li key={i}>{actionText(a, objects)}</li>)}</ol>}
                {proposalError ? <p className="proposal-problem" role="status">{proposalError}</p> : preview && <p className="proposal-impact">确认后：{TASKS.filter((t) => preview!.tasks[t]).length}/3 份工作已落实，休假{preview.rest ? '已许出' : '还在'}，署名{preview.credit ? '已许出' : '还在'}。</p>}
                {proposalEndsRound && <p className="proposal-problem">这份承诺会让本局无法完成故事会。确认后，将以未开场结束。</p>}
                <Button className="primary-key" disabled={!preview || busy} onClick={confirm}>{proposalEndsRound ? '接受这次散场' : '确认这份承诺'}</Button>
              </div>
            )}
            {ready ? (
              <div className="ready-to-perform"><p><Check size={17} />安排齐了。让大家把故事演出来。</p><Button className="primary-key" leadingIcon={<Play size={18} />} disabled={busy} onClick={() => void perform()}>{busy ? '正在写今晚的故事…' : '故事会，开场'}</Button></div>
            ) : (
              <div className="proposal-composer"><label htmlFor="strike-proposal">也可以直接说出你的安排</label><TextareaField id="strike-proposal" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} rows={2} placeholder="比如：先让一位伙伴休息，再安排大家的工作…" disabled={busy} /><Button className="upload-key" disabled={busy || !message.trim()} onClick={() => void ask()}>{busy ? '正在整理你的提议…' : '让管家整理提议'}</Button></div>
            )}
            {busy && <button type="button" className="text-action cancel-proposal" onClick={() => request.current?.abort()}>取消这次生成</button>}
          </>
        )}
        {error && <p className="play-error" role="alert">{error}</p>}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Photo mystery (App.tsx OddBureau)                                          */
/* ------------------------------------------------------------------------ */

function Mystery({ content, onExit, onSettings, onVoice, onHostOnly }: { content: HeroDemoOddBureauPreview; onExit: () => void; onSettings: () => void; onVoice: () => void; onHostOnly: () => void }) {
  const photo = content.photo;
  const [session, setSession] = useState<Session | null>(null);
  const [mood, setMood] = useState<HeroDemoOddBureauMoodId>('missing');
  const [stage, setStage] = useState<'locating' | 'writing' | null>(null);
  const [foundProps, setFoundProps] = useState<Prop[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'witness' | 'notebook'>('witness');
  const [question, setQuestion] = useState('');
  const [streaming, setStreaming] = useState('');
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [accusing, setAccusing] = useState(false);
  const [confirmAccusation, setConfirmAccusation] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const replyIndex = useRef<Record<string, number>>({});
  const chatBottom = useRef<HTMLDivElement>(null);
  const busy = !!stage || talking;
  useEffect(() => () => { operation.current?.abort(); }, []);
  useEffect(() => { chatBottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [streaming, session?.messages, selected]);
  function updateSession(next: Session) { sessionRef.current = next; setSession(next); }

  async function startCase() {
    if (busy || operation.current) return;
    setError(''); setAccusing(false); setConfirmAccusation(null); setShowHint(false); setSelected(null); setPanel('witness'); setFoundProps([]);
    const controller = new AbortController();
    operation.current = controller;
    try {
      setStage('locating');
      const props: Prop[] = [];
      for (const prop of content.props) {
        await sleep(LOCATE_STEP_MS, controller.signal);
        props.push({ ...prop, box: { ...prop.box } });
        setFoundProps([...props]);
      }
      setStage('writing');
      await sleep(WRITE_MS, controller.signal);
      const mystery = content.mysteries.find((m) => m.mood === mood) ?? content.mysteries[0]!;
      updateSession({ id: mintId(), mood, props, mystery, discovered: [], evidence: [], messages: {}, accusation: null });
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (operation.current === controller) { operation.current = null; setStage(null); } }
  }
  function discover(prop: Prop) {
    const current = sessionRef.current;
    if (!current || stage || talking) return;
    setError(''); setQuestion(''); setStreaming(''); setShowHint(false); setMiss(false);
    if (accusing) { setConfirmAccusation(prop.id); return; }
    setSelected(prop.id); setPanel('witness');
    if (!current.discovered.includes(prop.id)) updateSession({ ...current, discovered: [...current.discovered, prop.id] });
  }
  function collect(characterId: string) {
    const current = sessionRef.current;
    const character = current?.mystery.characters.find((c) => c.objectId === characterId);
    if (!current || !character || current.evidence.includes(characterId)) return;
    const messages = current.messages[characterId] ?? [];
    updateSession({ ...current, evidence: [...current.evidence, characterId], messages: { ...current.messages, [characterId]: [...messages, { who: 'player', text: '案发时，你注意到了什么？' }, { who: 'object', text: character.testimony }] } });
  }
  async function ask(text = question) {
    const current = sessionRef.current;
    const character = current?.mystery.characters.find((c) => c.objectId === selected);
    const trimmed = text.trim();
    if (!current || !character || !trimmed || busy || current.accusation) return;
    setTalking(true); setError(''); setStreaming('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const index = replyIndex.current[character.objectId] ?? 0;
      replyIndex.current[character.objectId] = index + 1;
      const answer = character.replies[index % character.replies.length] ?? character.greeting;
      await sleep(600, controller.signal);
      const glyphs = Array.from(answer);
      for (let i = 1; i <= glyphs.length; i++) {
        await sleep(STREAM_TICK_MS, controller.signal);
        setStreaming(glyphs.slice(0, i).join(''));
      }
      const latest = sessionRef.current!;
      updateSession({ ...latest, messages: { ...latest.messages, [character.objectId]: [...(latest.messages[character.objectId] ?? []).slice(-22), { who: 'player', text: trimmed }, { who: 'object', text: answer }] } });
      setQuestion('');
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (operation.current === controller) { operation.current = null; setTalking(false); setStreaming(''); } }
  }
  function finishCase() {
    if (!session || !confirmAccusation || !canAccuse(session)) return;
    updateSession({ ...session, accusation: confirmAccusation }); setAccusing(false); setConfirmAccusation(null); setSelected(null);
  }
  function newCase() { operation.current?.abort(); setSession(null); sessionRef.current = null; setSelected(null); setError(''); setQuestion(''); setAccusing(false); setConfirmAccusation(null); }

  const character = session?.mystery.characters.find((c) => c.objectId === selected);
  const selectedProp = session?.props.find((p) => p.id === selected);
  const complete = !!session?.accusation;
  const culprit = session?.mystery.characters.find((c) => c.objectId === session.mystery.culpritId);
  const accused = session?.mystery.characters.find((c) => c.objectId === confirmAccusation);
  const nameOf = (id: string) => session?.props.find((p) => p.id === id)?.label ?? '';

  return (
    <div className="odd-bureau" data-density="expressive" data-odd-bureau-screen="mystery">
      <header className="bureau-header">
        <button type="button" className="wordmark" onClick={() => setShowHelp((value) => !value)} aria-label="奇物局，查看玩法"><Fingerprint size={33} strokeWidth={1.7} /><span>奇物局<span className="wordmark-en">ODD BUREAU</span></span></button>
        <Button className="quiet-button" onClick={onExit} disabled={busy}>返回游乐场</Button>
        <div className="header-actions"><span className="nimi-credit">POWERED BY NIMI</span><IconButton className="help-button" icon={<Settings2 size={20} />} aria-label="能力设置" onClick={onSettings} disabled={busy} /><IconButton className="help-button" icon={<CircleHelp size={21} />} aria-label="怎么玩" onClick={() => setShowHelp((value) => !value)} /></div>
      </header>
      {showHelp && <div className="how-to"><div><strong>一张照片，一桩荒诞小案。</strong><p>选一张至少有 3 件独立物品的照片。开案后点击照片里的物品，听它们说话，收集关键证词，最后指认嫌疑物。所有故事均为 AI 创作的虚构故事。</p><p>物品位置由 Nimi 视觉定位；文字和可选语音使用 Nimi 中已配置的能力。照片会交给所选能力处理。</p></div><IconButton icon={<X size={18} />} aria-label="关闭玩法说明" onClick={() => setShowHelp(false)} /></div>}
      <main className={`bureau-main ${session ? 'in-case' : 'at-home'}`}>
        {!session && <div className="intro-line"><div><h1>照片里的家伙，<br />有<span className="trouble-word">事</span>瞒着你。</h1><p>给日常拍张照。让物品开口，破一桩只有你能遇见的怪案。</p></div><div className="play-note"><span className="play-note-title">今日营业</span><span>荒诞推理 / 一张照片 / 无限可能</span><MousePointer2 size={23} /></div></div>}
        {session && <div className="case-heading"><div><h1>{session.mystery.title}</h1><p>{session.mystery.incident}</p></div><Button className="quiet-button" leadingIcon={<ArrowLeft size={16} />} onClick={newCase} disabled={busy}>换个案件</Button></div>}
        <div className="arcade">
          <section className="scene-column" aria-label="照片现场">
            <div className="scene-top"><span><span className="live-dot" />{session ? complete ? '案件已揭晓' : '现场调查中' : '一切都从这张照片开始'}</span><span>{photo.name}</span></div>
            <div className={`photo-frame ${accusing ? 'accusing' : ''}`}>
              <div
                className="photo-plane"
                style={{ aspectRatio: `${photo.width}/${photo.height}` }}
                onClick={(event) => {
                  if (!session || busy || complete) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const prop = hitProp(session.props, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
                  if (prop) discover(prop); else { setMiss(true); setShowHint(true); }
                }}
              >
                <img className="scene-photo" src={photo.src} alt={session ? `本案现场：${photo.name}。可用下方角色按钮探索每件物品。` : `已选照片：${photo.name}。AI 创作的试玩场景。`} draggable={false} />
                {!session && !stage && <div className="sample-tag"><ImagePlus size={14} />AI 创作的试玩照片 · 实时开案</div>}
                {session && !complete && session.props.map((prop, index) => {
                  const revealed = showHint || session.discovered.includes(prop.id) || accusing;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      className={`object-hit ${revealed ? 'revealed' : ''} ${selected === prop.id ? 'selected' : ''} ${session.evidence.includes(prop.id) ? 'has-evidence' : ''}`}
                      style={{ left: `${prop.box.x1 * 100}%`, top: `${prop.box.y1 * 100}%`, width: `${(prop.box.x2 - prop.box.x1) * 100}%`, height: `${(prop.box.y2 - prop.box.y1) * 100}%` }}
                      aria-label={`${accusing ? '指认' : '调查'}${prop.label}`}
                      disabled={busy}
                      onClick={(event) => { event.stopPropagation(); discover(prop); }}
                    >
                      <span className="hotspot-number">{session.evidence.includes(prop.id) ? <Check size={15} /> : String(index + 1).padStart(2, '0')}</span>
                      <span className="hotspot-label">{prop.label}</span>
                    </button>
                  );
                })}
                {complete && <div className="scene-verdict"><Fingerprint size={38} /><span>{session!.accusation === session!.mystery.culpritId ? '漂亮，破案了！' : '真相另有其物。'}</span><p>原来是{nameOf(culprit?.objectId ?? '')}在搞鬼。</p></div>}
                {stage && <div className="generation-overlay" role="status" aria-live="polite"><div className="scan-mark"><Search size={36} /></div><h2>{stage === 'locating' ? '嘘，看看谁在现场…' : '物品们正在串供…'}</h2><p>{stage === 'locating' ? foundProps.length ? `已找到：${foundProps.map((prop) => prop.label).join('、')}。继续寻找下一位…` : '正在逐个寻找可以登场的物品，首次运行可能需要一点时间' : '正在编织角色、证词和一个说得通的真相'}</p><Button className="cancel-key" onClick={() => operation.current?.abort()}>取消开案</Button></div>}
              </div>
            </div>
            <div className="scene-bottom"><span>{session ? accusing ? '点击你认为的嫌疑物' : complete ? '同一张照片，还能发生下一桩怪案。' : miss ? '这里暂时没有角色。亮起的物品可以调查。' : '试着点点照片里的物品。它们都有话说。' : '桌面、客厅、书架… 越日常，越意想不到。'}</span>{session && !complete && <button type="button" className="hint-key" onClick={() => { setShowHint((v) => !v); setMiss(false); }} disabled={busy}><Lightbulb size={15} />{showHint ? '收起提示' : '找不到？'}</button>}</div>
            {session && (
              <div className="cast-strip" aria-label="可调查物品，亦可用键盘选择">
                {session.props.map((prop, index) => {
                  const known = session.discovered.includes(prop.id) || complete;
                  return (
                    <button key={prop.id} type="button" className={`cast-key ${selected === prop.id ? 'active' : ''}`} onClick={() => discover(prop)} disabled={busy || complete} aria-label={`调查${prop.label}`}>
                      <ObjectPortrait prop={prop} photo={photo} /><span>{known ? prop.label : `物品 ${index + 1}`}</span><small>{session.evidence.includes(prop.id) ? '已记证词' : known ? '继续盘问' : '还没聊过'}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <aside className={`case-panel ${!session ? 'start-panel' : ''}`} aria-label={session ? '调查手记' : '开始新案件'}>
            {!session ? (
              <>
                <div className="welcome-stamp"><Fingerprint size={43} strokeWidth={1.4} /><span>奇物调查员<br /><b>入局邀请</b></span><Sparkles className="stamp-spark" size={19} /></div>
                <h2>今天，查点什么？</h2><p className="panel-intro">物品们有自己的小秘密。<br />挑一种故事，让它们露出马脚。</p>
                <div className="mood-options" role="group" aria-label="选择案件风格">{MOODS.map((item, index) => <button type="button" key={item.id} className={`mood-key ${mood === item.id ? 'active' : ''}`} onClick={() => setMood(item.id)} disabled={busy} aria-pressed={mood === item.id}><span className="mood-symbol">{index === 0 ? <Search /> : index === 1 ? <AudioLines /> : <Sparkles />}</span><span><b>{item.name}</b><small>{item.hint}</small></span><span className="mood-check">{mood === item.id ? <Check size={15} /> : null}</span></button>)}</div>
                <div className="start-actions"><Button className="primary-key" leadingIcon={<Fingerprint size={22} />} trailingIcon={<ArrowRight size={20} />} onClick={() => void startCase()} disabled={busy}>{stage ? '正在开案…' : '就用这张，开案'}</Button><Button className="upload-key" leadingIcon={<ImagePlus size={18} />} onClick={onHostOnly} disabled={busy}>换成我的照片</Button></div>
                <p className="first-play-note">第一次？直接用这张照片玩。<br />无需写提示词，也不需要先想一个故事。</p>
              </>
            ) : complete ? (
              <div className="reveal-panel">
                <div className="solved-mark"><CheckCheck size={31} /></div><h2>{session.accusation === session.mystery.culpritId ? '日常，果然不简单。' : '这次被它骗到了。'}</h2><p className="culprit-name">幕后搞事的：<strong>{nameOf(culprit?.objectId ?? '')}</strong></p><p className="resolution">{session.mystery.resolution}</p>
                <div className="reasoning"><h3>把这几句话连起来</h3>{session.mystery.decisiveEvidenceIds.map((id) => { const c = session.mystery.characters.find((c) => c.objectId === id)!; return <p key={id}><b>{nameOf(id)}</b><span>{c.testimony}</span>{!session.evidence.includes(id) && <small>这条证词，本局还没收集</small>}</p>; })}</div>
                <Button className="primary-key" trailingIcon={<ArrowRight size={19} />} onClick={() => { newCase(); void startCase(); }} disabled={busy}>同一张照片，再来一案</Button><Button className="upload-key" onClick={newCase}>用新照片开案</Button><p className="fiction-note">这是一桩 AI 创作的虚构小案。</p>
              </div>
            ) : (
              <>
                <div className="panel-tabs" role="group" aria-label="调查面板"><button type="button" aria-pressed={panel === 'witness'} onClick={() => setPanel('witness')}>物品来话<MessageCircle size={16} /></button><button type="button" aria-pressed={panel === 'notebook'} onClick={() => setPanel('notebook')}>线索本<span>{session.evidence.length}</span></button></div>
                <div className="panel-body">
                  {confirmAccusation && accused ? (
                    <div className="accusation-panel"><Fingerprint size={44} /><h2>就是{nameOf(accused.objectId)}？</h2><p>确认后会揭晓本案真相。<br />还有疑问的话，可以回去再问两句。</p><Button className="primary-key" onClick={finishCase}>确认指认，揭晓真相</Button><Button className="upload-key" onClick={() => { setConfirmAccusation(null); setAccusing(false); }}>再调查一下</Button></div>
                  ) : panel === 'notebook' ? (
                    <div className="notebook"><h2>听他们说，<br />也听话外之音。</h2>{session.evidence.length ? session.evidence.map((id, index) => { const c = session.mystery.characters.find((c) => c.objectId === id)!; return <article className="evidence-note" key={id}><span className="evidence-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{c.clueTitle}</h3><p>{c.testimony}</p><button type="button" onClick={() => { setSelected(id); setPanel('witness'); }}>{nameOf(id)}<ChevronRight size={14} /></button></div></article>; }) : <div className="no-clues"><Search size={32} /><p>空白也没关系。<br />点一个物品，问问它案发时看到了什么。</p></div>}</div>
                  ) : character && selectedProp ? (
                    <div className="witness">
                      <div className="witness-profile"><ObjectPortrait prop={selectedProp} photo={photo} /><div><h2>{selectedProp.label}</h2><p>{character.persona}</p></div><IconButton className="voice-key" icon={<Volume2 size={19} />} aria-label="听它说话" onClick={onVoice} disabled={talking} /></div>
                      <div className="conversation" aria-label={`${selectedProp.label}的对话`}><p className="object-message">{character.greeting}</p>{(session.messages[character.objectId] ?? []).map((message, index) => <p key={index} className={message.who === 'player' ? 'player-message' : 'object-message'}>{message.text}</p>)}{talking && <p className="object-message streaming" role="status">{streaming || '它想了想，准备开口…'}</p>}<div ref={chatBottom} /></div>
                      {!session.evidence.includes(character.objectId) ? <button type="button" className="evidence-action" onClick={() => collect(character.objectId)} disabled={talking}><Search size={18} /><span>问问案发时，它看到了什么</span><ArrowRight size={17} /></button> : <div className="collected-tag"><Check size={16} />关键证词已记入线索本</div>}
                      <div className="question-area"><button type="button" className="suggested-question" onClick={() => void ask(character.suggestedQuestion)} disabled={talking}>{character.suggestedQuestion}<ArrowRight size={14} /></button><form onSubmit={(event) => { event.preventDefault(); void ask(); }}><TextField aria-label="自由盘问这个物品" placeholder="也可以直接问它…" maxLength={350} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={talking} /><IconButton className="send-key" icon={talking ? <Square size={15} /> : <Send size={17} />} aria-label={talking ? '停止盘问' : '发送问题'} type={talking ? 'button' : 'submit'} disabled={!talking && !question.trim()} onClick={talking ? () => operation.current?.abort() : undefined} /></form></div>
                    </div>
                  ) : (
                    <div className="case-opening"><div className="opening-symbol"><MessageCircle size={39} /></div><h2>现场交给你了。</h2><p>{session.mystery.opening}</p><div className="opening-tip"><MousePointer2 size={20} /><span>点点照片里的物品，<br />听听谁的故事对不上。</span></div></div>
                  )}
                </div>
                <div className="accuse-bar"><span>已收集 <b>{session.evidence.length}</b> / {session.props.length} 份证词</span><Button className="accuse-key" leadingIcon={<Fingerprint size={17} />} onClick={() => { setAccusing((v) => !v); setConfirmAccusation(null); }} disabled={!canAccuse(session) || busy}>{accusing ? '取消指认' : '我知道是谁了'}</Button>{!canAccuse(session) && <small>先收集 2 份证词，再提出你的猜想。</small>}</div>
              </>
            )}
          </aside>
        </div>
        {error && <div className="bureau-error" role="alert"><div><strong>这一步还没完成</strong><p>{error}</p></div><IconButton icon={<X size={18} />} aria-label="收起提示" onClick={() => setError('')} /></div>}
        <footer className="bureau-footer"><span>物品的故事由 AI 创作，纯属虚构。</span><span>发现 → 盘问 → 连起线索 → 揭晓</span></footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Capability setup (Setup.tsx)                                               */
/* ------------------------------------------------------------------------ */

type SurfaceProps = ModelConfigAIConfigSurfaceProps;
type AIConfigIntent = NonNullable<SurfaceProps['capabilities']>[number];
type EffectiveSelection = NonNullable<SurfaceProps['effectiveSelections']>[number];
type ListOptions = NonNullable<SurfaceProps['listOptions']>;
type OptionsResult = Awaited<ReturnType<ListOptions>>;
type Overwrite = NonNullable<SurfaceProps['onOverwrite']>;
const CONTRACTS = ['vision.locate', 'text.generate', 'audio.synthesize'];
const DEMO_CLOUD_CONNECTOR_REF = 'demo-connector:odd-bureau';
const DEMO_IMPLEMENTATION = { implementationId: 'demo.local', driverId: 'demo', driverDialect: 'demo/local/v1' } as const;
const LOCAL_LABELS: Record<string, string> = { 'vision.locate': '本机视觉定位', 'text.generate': '本机文字模型', 'audio.synthesize': '本机语音合成' };
const CLOUD_LABELS: Record<string, string> = { 'vision.locate': '云端视觉定位', 'text.generate': '云端文字模型', 'audio.synthesize': '云端语音合成' };
const localLoadout = (capability: string) => ({ loadoutRef: `demo-loadout:${capability}`, label: LOCAL_LABELS[capability] ?? capability, capabilityContract: capability, implementation: DEMO_IMPLEMENTATION, implementationSupportedFeatures: [], configuredFeatures: [], textBehaviors: [], state: 'ready' as const, reasons: [] });
const cloudConnector = () => ({ connectorRef: DEMO_CLOUD_CONNECTOR_REF, label: 'Nimi Cloud', provider: 'demo', state: 'ready' as const, reasons: [] });
const cloudTarget = (capability: string) => ({ connectorRef: DEMO_CLOUD_CONNECTOR_REF, label: CLOUD_LABELS[capability] ?? capability, capabilityContract: capability, implementation: DEMO_IMPLEMENTATION, providerModelTarget: { model: `demo-${capability}` }, supportedFeatures: [], state: 'ready' as const, reasons: [] });
const effectiveSelectionsFor = (intents: readonly AIConfigIntent[]): EffectiveSelection[] => intents.map((intent) => ({
  capabilityContract: intent.capabilityContract,
  state: 'ready',
  resource: intent.route.oneofKind === 'cloud' ? { oneofKind: 'cloud', cloud: { connector: cloudConnector(), target: cloudTarget(intent.capabilityContract) } } : { oneofKind: 'local', local: localLoadout(intent.capabilityContract) },
  reasons: [],
}));

function Setup({ onBack }: { onBack: () => void }) {
  const [intents, setIntents] = useState<AIConfigIntent[]>(() => [
    { capabilityContract: 'vision.locate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } },
    { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } },
    // 让物品开口 (audio.synthesize) starts unconfigured, as the app's setup copy says it is optional.
  ]);
  const [revision, setRevision] = useState('1');
  const listOptions = useCallback<ListOptions>(async (query): Promise<OptionsResult> => {
    switch (query.kind) {
      case 'cloud-connectors': return { kind: 'cloud-connectors', options: [cloudConnector()], truncated: false };
      case 'cloud-targets': return { kind: 'cloud-targets', options: query.connectorRef === DEMO_CLOUD_CONNECTOR_REF ? [cloudTarget(query.capabilityContract)] : [], truncated: false };
      case 'local-loadouts': return { kind: 'local-loadouts', options: [localLoadout(query.capabilityContract)], truncated: false };
      case 'preset-voices': return { kind: 'preset-voices', options: [{ voiceId: 'demo-voice-zh', name: '桌边旁白', supportedLangs: ['zh'] }], truncated: false };
    }
  }, []);
  const overwrite = useCallback<Overwrite>(async (input) => {
    const next = input.capabilities.map((intent) => ({ ...intent, requiredFeatures: [...intent.requiredFeatures] }));
    const nextRevision = String(Number(revision) + 1);
    setIntents(next); setRevision(nextRevision);
    return { outcome: 'committed', config: { capabilities: next }, revision: nextRevision };
  }, [revision]);
  const configured = ['vision.locate', 'text.generate'].every((id) => intents.some((c) => c.capabilityContract === id));
  return (
    <main className="setup-page" data-density="regular">
      <Button className="quiet-button" leadingIcon={<ArrowLeft size={16} />} onClick={onBack}>回到现场</Button>
      <h1>给游乐场接通 AI</h1><p>这些玩法需要「看见物品」和「创作玩法」两项能力。「让物品开口」可选，稍后也能开启。</p>
      <div className="setup-surface">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId: 'nimi.odd-bureau' }}
          capabilityContracts={CONTRACTS}
          capabilities={intents}
          revision={revision}
          effectiveSelections={effectiveSelectionsFor(intents)}
          listOptions={listOptions}
          onOverwrite={overwrite}
          language="zh"
          copy={{
            title: '奇物局的能力', description: '只为这间事务所选择能力，不会改变 Nimi 中其他 App 的设置。',
            backLabel: '返回能力总览', activeModelLabel: '使用的模型', activeModelHint: '选择本机或云端能力',
            detailTitle: (label) => `${label}设置`, activeModelConfiguredLabel: '已配置', activeModelSetupPendingLabel: '需要准备',
            configuredSummary: '能力已配置', emptySummary: '尚未选择模型',
            modelPickerTitle: '选择能力来源', modelPickerSearchPlaceholder: '搜索模型', modelPickerLoadingLabel: '正在读取模型…', modelPickerEmptyLabel: '还没有可用的模型',
            configuredLabel: '已配置', notConfiguredLabel: '尚未配置', localLabel: '本机', cloudLabel: '云端', routeLabel: '能力来源',
            saveLocalLabel: '使用本机模型', saveCloudLabel: '使用此云端模型', savingLabel: '正在保存…', clearLabel: '清除此项配置', cancelLabel: '取消', confirmSelectionLabel: '确认选择',
            advancedLabel: '高级选项', advancedHint: '调整此能力的参数', retryLabel: '重试', technicalDetailsLabel: '技术详情',
            defaultsLabel: '默认参数', defaultsPlaceholder: '留空以使用模型默认值。', defaultsUnsetLabel: '未设置', defaultsTrueLabel: '是', defaultsFalseLabel: '否', defaultsListPlaceholder: '每行一项', defaultsLocalEffectivePlaceholder: (value) => `未设置 · 本机默认 ${value}`, defaultsCloudEffectivePlaceholder: '未设置 · 使用服务默认值', defaultsRandomValue: '随机',
            localChoiceDescription: '使用 Nimi 当前选择的本机模型。', localSelectedLabel: '本机当前选择', localMissingLabel: '本机尚未为此能力选择模型。', localBrokenLabel: '本机选中的模型需要处理。', localUnavailableLabel: '暂时无法读取本机模型。', localMismatchLabel: (features) => `本机模型尚不支持：${features}`, openMachineLabel: '管理本机模型',
            cloudConnectorPickerLabel: '选择已连接的服务', cloudConnectorPickerPlaceholder: '选择一个服务', cloudNoConnectorsLabel: '尚未连接云端服务',
            cloudConnectorSelectionRequired: '先选择一个已连接的服务，再选择模型。', cloudNoticeLabel: '通过云端处理', cloudNoticeDescription: '文字内容会发送到所选服务，并可能产生该服务的费用。', cloudImplementationLabel: '云端服务', cloudTargetLabel: '云端模型', cloudConnectorLabel: '已连接的服务', cloudLoadFailed: '暂时无法读取云端模型，请重试。',
            loadFailed: '暂时无法读取能力设置。', saveFailed: '能力设置没有保存成功。', conflictLabel: '配置已在别处更新', conflictDescription: '请检查最新配置，再保存你的选择。', clearingLabel: '正在清除…', selectionRequiredLabel: '请选择模型', blockedLabel: '需要处理', unavailableLabel: '暂不可用', mismatchLabel: '能力不匹配',
            capabilityLabel: (id) => (id === 'vision.locate' ? '看见物品' : id === 'text.generate' ? '创作玩法' : '让物品开口'),
            capabilityDescription: (id) => (id === 'vision.locate' ? '必需 · 找出照片里的角色和它们的位置' : id === 'text.generate' ? '必需 · 创作器件规则、角色诉求、故事和提议' : '可选 · 把物品的台词读给你听'),
          }}
        />
      </div>
      {configured && <Button className="setup-return" trailingIcon={<ArrowRight size={17} />} onClick={onBack}>配置好了，回去开玩</Button>}
    </main>
  );
}

/* ------------------------------------------------------------------------ */
/* Playground root (Playground.tsx)                                           */
/* ------------------------------------------------------------------------ */

export function DemoOddBureauPreview({ content }: { content: HeroDemoOddBureauPreview }) {
  const photo = content.photo;
  const [route, setRoute] = useState<'home' | 'round' | 'setup' | 'mystery'>('home');
  const [kind, setKind] = useState<PlayRound['kind']>('machine');
  const [save, setSave] = useState<PlaySave | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [found, setFound] = useState<Prop[]>([]);
  const [error, setError] = useState('');
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const setupBack = useRef<'home' | 'round' | 'mystery'>('home');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerId = useMemo(() => `demo-odd-bureau-arrow-${mintId()}`, []);
  const notice = useCallback((text: string) => {
    setNoticeText(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNoticeText(null), NOTICE_MS);
  }, []);
  useEffect(() => () => { operation.current?.abort(); if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const hostOnly = () => notice(content.demo.hostOnly);
  const voice = () => notice(content.demo.voice);
  function settings() { if (route !== 'setup') setupBack.current = route; setRoute('setup'); }
  function change(round: PlayRound) {
    if (!save || save.round.kind !== round.kind) return;
    setSave({ ...save, round });
  }
  async function begin() {
    if (busy || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setFound([]); setError(''); setStatus('正在认领照片里的物品…');
    try {
      const props: Prop[] = [];
      for (const prop of content.props) {
        await sleep(LOCATE_STEP_MS, controller.signal);
        props.push({ ...prop, box: { ...prop.box } });
        setFound([...props]);
      }
      setStatus(kind === 'machine' ? '给每件物品一条奇怪又讲理的规则…' : '听听大家为什么不肯开工…');
      await sleep(WRITE_MS, controller.signal);
      const round: PlayRound = kind === 'machine'
        ? { kind, plan: { ...content.machine, nodes: content.machine.nodes.map((n) => ({ ...n, melody: [...n.melody] })) }, state: initialMachine() }
        : { kind, plan: { ...content.strike, people: content.strike.people.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o })) })) }, state: { promises: [], journal: [], performance: null, curtain: 0 } };
      setSave({ id: mintId(), props, round });
      setRoute('round');
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); setStatus(''); } }
  }
  const unavailable = busy;
  const screen = route === 'round' && save ? `round-${save.round.kind}` : route;

  return (
    <div className="demo-odd-bureau-root" data-demo-odd-bureau-root="true" data-demo-owns-scroll="true" data-demo-interactive="true" data-odd-bureau-route={screen}>
      <AmbientBackground variant="mesh" className="app-shell" data-testid="nimi-app-shell">
        {noticeText && <div className="demo-odd-bureau-notice" role="status" data-demo-odd-bureau-notice="true"><span>{noticeText}</span><button type="button" onClick={() => setNoticeText(null)}>{content.demo.dismiss}</button></div>}
        {route === 'mystery' ? (
          <Mystery content={content} onExit={() => setRoute('home')} onSettings={settings} onVoice={voice} onHostOnly={hostOnly} />
        ) : (
          <div className="odd-bureau playground" data-density="expressive">
            <header className="bureau-header"><button type="button" className="wordmark" onClick={() => setRoute('home')} disabled={unavailable} aria-label="回到玩法选择"><Fingerprint size={33} strokeWidth={1.7} /><span>奇物局<span className="wordmark-en">ODD BUREAU</span></span></button><p className="header-motto">让日常，出一点意外。</p><div className="header-actions"><button type="button" className="mystery-link" disabled={unavailable} onClick={() => setRoute('mystery')}><Search size={15} />照片探案</button><IconButton className="help-button" icon={<Settings2 size={20} />} aria-label="能力设置" disabled={unavailable} onClick={settings} /></div></header>
            {route === 'setup' ? (
              <Setup onBack={() => setRoute(setupBack.current)} />
            ) : route === 'round' && save ? (
              <main className="bureau-main playground-main">
                <div className="play-heading"><div><span className="activity-name">{save.round.kind === 'machine' ? <AudioLines size={17} /> : <MessageCircle size={17} />} {save.round.kind === 'machine' ? '怪机器' : '罢工谈判'}</span><h1>{save.round.plan.title}</h1>{save.round.kind === 'machine' && <p>{save.round.plan.invitation}</p>}</div><Button className="quiet-button" leadingIcon={<ArrowLeft size={16} />} onClick={() => setRoute('home')}>换个玩法</Button></div>
                {save.round.kind === 'machine'
                  ? <MachineGame key={save.id} photo={photo} objects={save.props} round={save.round} onChange={change} markerId={markerId} />
                  : <StrikeGame key={save.id} content={content} photo={photo} objects={save.props} round={save.round} onChange={change} onRestart={() => setRoute('home')} onVoice={voice} markerId={markerId} />}
              </main>
            ) : (
              <main className="bureau-main playground-main">
                <div className="intro-line"><div><h1>这张桌子，<br />有点<span className="trouble-word">想法</span>。</h1><p>把身边的物品，变成你能亲手改变的小世界。</p></div><Sparkles className="lobby-spark" size={36} /></div>
                <div className="play-layout playground-lobby">
                  <PhotoStage photo={photo} objects={busy ? found : []} badges={Object.fromEntries(found.map((p) => [p.id, '已找到']))} instruction="同一张照片，可以有不一样的玩法" markerId={markerId}>
                    {busy && <div className="play-preparing" role="status" aria-live="polite"><Fingerprint size={38} /><h2>{status}</h2><p>{found.length ? `${found.map((p) => p.label).join('、')} 已经到场。` : '先看看照片里都有谁。'}</p><Button className="cancel-key" onClick={() => operation.current?.abort()}>取消，照片留着</Button></div>}
                  </PhotoStage>
                  <aside className="activity-panel lobby-panel">
                    <h2>今天，怎么闹？</h2><p className="lobby-description">每件物品都会有自己的本领和脾气。<br />这次由你来改变局面。</p>
                    <div className="activity-choices" role="group" aria-label="选择玩法">
                      <button type="button" className={kind === 'machine' ? 'selected' : ''} aria-pressed={kind === 'machine'} disabled={unavailable} onClick={() => setKind('machine')}><AudioLines size={26} /><span><strong>怪机器</strong><b>把滴答装进杯子。</b><small>连起物品，听听你的发明。</small></span><ArrowRight size={18} /></button>
                      <button type="button" className={kind === 'strike' ? 'selected' : ''} aria-pressed={kind === 'strike'} disabled={unavailable} onClick={() => setKind('strike')}><MessageCircle size={26} /><span><strong>罢工谈判</strong><b>这张桌子不干了。</b><small>谈条件、许承诺，把故事会办起来。</small></span><ArrowRight size={18} /></button>
                    </div>
                    <div className="lobby-cta">
                      <Button className="primary-key" trailingIcon={<ArrowRight size={19} />} disabled={unavailable} onClick={() => void begin()}>{busy ? '正在让物品登场…' : kind === 'machine' ? '用这张照片，造台怪机器' : '用这张照片，谈一场罢工'}</Button>
                      <Button className="upload-key" leadingIcon={<ImagePlus size={17} />} disabled={unavailable} onClick={hostOnly}>换成我的照片</Button>
                      {save && <button type="button" className="resume-play" disabled={unavailable} onClick={() => setRoute('round')}>继续上次的{save.round.kind === 'machine' ? '怪机器' : '故事会'}<ArrowRight size={14} /></button>}
                    </div>
                    <p className="lobby-footnote">先用这张试玩照片体验。<br />自己的杯子、书、灯，也能成为主角。</p>
                  </aside>
                </div>
              </main>
            )}
            {error && <div className="play-notices"><div className="bureau-error" role="alert"><p>{error}</p><IconButton icon={<X size={17} />} aria-label="收起错误" onClick={() => setError('')} /></div></div>}
            <footer className="bureau-footer playground-footer"><span>照片是舞台，想象有自己的规则。</span><span>POWERED BY NIMI</span></footer>
          </div>
        )}
      </AmbientBackground>
    </div>
  );
}
