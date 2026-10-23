import { PreviewMessageError } from '../i18n/preview-messages.js';
import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { loadOddBureauFont } from '../../fonts.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AmbientBackground,
  Button,
  IconButton,
  TextField,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigAIConfigSurfaceProps,
} from '@nimiplatform/kit/features/model-config';
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
import type {
  HeroDemoOddBureauMoodId,
  HeroDemoOddBureauMystery,
  HeroDemoOddBureauPreview,
} from '../content/landing-content.js';
import {
  commitPromises,
  editMachinePath,
  findStrikeSolution,
  hitProp,
  initialMachine,
  interpretProposalLocally,
  machineChallenge,
  runMachine,
  simulateMachine,
  strikeReady,
  TASKS,
  type MachineRound,
  type Note,
  type PlayRound,
  type PromiseAction,
  type Prop,
  type StrikeOffer,
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

const createMysteryMoods = (t: PreviewTranslate) =>
  [
    {
      id: 'missing',
      name: t('oddBureau.workspace.aStrangeTheft'),
      hint: t('oddBureau.workspace.whoTookEveryoneSTreasure'),
    },
    {
      id: 'strike',
      name: t('oddBureau.workspace.aCollectiveStrike'),
      hint: t('oddBureau.workspace.someoneAlwaysStartsTheTrouble'),
    },
    {
      id: 'party',
      name: t('oddBureau.workspace.aSecretParty'),
      hint: t('oddBureau.workspace.whoSTheLifeOfThePartyWhen'),
    },
  ] as const;

const LOCATE_STEP_MS = 320;
const WRITE_MS = 1100;
const PROPOSAL_MS = 700;
const PERFORMANCE_MS = 1300;
const STREAM_TICK_MS = 28;
const NOTICE_MS = 6_000;
let seed = 0;
const mintId = () => `demo-${(seed += 1).toString(36)}`;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
function errorMessage(error: unknown, t: PreviewTranslate): string {
  return error instanceof PreviewMessageError
    ? t(error.key)
    : error instanceof Error
      ? error.message
      : t('oddBureau.errorMessage.thisActionDidNotCompleteTryAgain');
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
    if (context.state !== 'running') {
      this.stop();
      throw new PreviewMessageError('oddBureau.workspace.audioDidNotStartTryThePreview');
    }
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
        if (index === notes.length - 1)
          oscillator.onended = () => {
            if (this.context === context) {
              resolve(true);
              this.stop();
            } else resolve(false);
          };
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

function ObjectPortrait({
  prop,
  photo,
  className = '',
}: {
  prop: Prop;
  photo: Photo;
  className?: string;
}) {
  const b = prop.box;
  return (
    <svg
      className={`prop-portrait ${className}`}
      viewBox={`${b.x1 * photo.width} ${b.y1 * photo.height} ${(b.x2 - b.x1) * photo.width} ${(b.y2 - b.y1) * photo.height}`}
      role="img"
      aria-label={prop.label}
    >
      <image href={photo.src} width={photo.width} height={photo.height} />
    </svg>
  );
}

function PhotoStage({
  photo,
  objects,
  selected,
  path = [],
  badges = {},
  resting,
  active,
  flowing,
  onSelect,
  onConnect,
  instruction,
  children,
  markerId,
}: {
  photo: Photo;
  objects: Prop[];
  selected?: string | null;
  path?: string[];
  badges?: Record<string, string>;
  resting?: string | null;
  active?: string | null;
  flowing?: boolean;
  onSelect?: (id: string) => void;
  onConnect?: (from: string, to: string) => void;
  instruction: string;
  children?: ReactNode;
  markerId: string;
}) {
  const { t } = useAppPreviewLocale();
  const centers = path
    .map((id) => objects.find((p) => p.id === id))
    .filter((p): p is Prop => !!p)
    .map((p) => ({ x: (p.box.x1 + p.box.x2) * 500, y: (p.box.y1 + p.box.y2) * 500 }));
  return (
    <section className="play-scene" aria-label={t('oddBureau.photoStage.photoPlayground')}>
      <div className="scene-top">
        <span>
          <span className="live-dot" />
          {instruction}
        </span>
        <span>{photo.name}</span>
      </div>
      <div className="play-image-wrap">
        <div
          className="play-image-plane"
          style={
            {
              aspectRatio: `${photo.width}/${photo.height}`,
              '--photo-ratio': photo.width / photo.height,
            } as CSSProperties
          }
        >
          <img
            src={photo.src}
            alt={t('oddBureau.photoStage.photoStageAiCreatedSamplePhoto', {
              photoName: photo.name,
            })}
            draggable={false}
          />
          {!!centers.length && (
            <svg
              className={`play-wires ${flowing ? 'is-flowing' : ''}`}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#c7f6a8" />
                </marker>
              </defs>
              {centers.slice(1).map((to, i) => (
                <line
                  key={i}
                  x1={centers[i]!.x}
                  y1={centers[i]!.y}
                  x2={to.x}
                  y2={to.y}
                  markerEnd={`url(#${markerId})`}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
          {objects.map((prop, i) => (
            <button
              key={prop.id}
              type="button"
              className={`play-object ${selected === prop.id ? 'selected' : ''} ${path.includes(prop.id) ? 'connected' : ''} ${resting === prop.id ? 'resting' : ''} ${active === prop.id ? 'performing' : ''}`}
              style={{
                left: `${prop.box.x1 * 100}%`,
                top: `${prop.box.y1 * 100}%`,
                width: `${(prop.box.x2 - prop.box.x1) * 100}%`,
                height: `${(prop.box.y2 - prop.box.y1) * 100}%`,
              }}
              aria-label={t('oddBureau.photoStage.choose', {
                propLabel: prop.label,
                badgesPropId: badges[prop.id] ?? '物品',
              })}
              onClick={() => onSelect?.(prop.id)}
              disabled={!onSelect}
              draggable={!!onConnect}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/odd-bureau-object', prop.id);
                event.dataTransfer.effectAllowed = 'link';
              }}
              onDragOver={(event) => {
                if (onConnect) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'link';
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData('application/odd-bureau-object');
                if (from && objects.some((p) => p.id === from) && from !== prop.id)
                  onConnect?.(from, prop.id);
              }}
            >
              <span className="play-object-number">
                {path.includes(prop.id) ? path.indexOf(prop.id) + 1 : i + 1}
              </span>
              <span className="play-object-label">
                {prop.label}
                <small>{badges[prop.id]}</small>
              </span>
            </button>
          ))}
          {!objects.length && (
            <div className="sample-tag">
              {t('oddBureau.photoStage.aiCreatedSamplePhotoObjectsAppearWhen')}
            </div>
          )}
          {children}
        </div>
      </div>
      {!!objects.length && (
        <div className="play-cast" aria-label={t('oddBureau.photoStage.objectButtons')}>
          {objects.map((prop) => (
            <button
              key={prop.id}
              type="button"
              onClick={() => onSelect?.(prop.id)}
              disabled={!onSelect}
              className={selected === prop.id ? 'selected' : ''}
              aria-label={t('oddBureau.photoStage.choose2', { propLabel: prop.label })}
            >
              <ObjectPortrait prop={prop} photo={photo} />
              <span>{prop.label}</span>
              <small>{badges[prop.id] ?? ''}</small>
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
  const { t } = useAppPreviewLocale();
  const noteLabels = [
    t('oddBureau.notes.thump'),
    t('oddBureau.notes.ding'),
    t('oddBureau.notes.ring'),
    t('oddBureau.notes.pop'),
    t('oddBureau.notes.clang'),
  ];
  return (
    <div
      className="note-strip"
      role="img"
      aria-label={
        label
          ? label
          : notes
              .map((n) =>
                t('oddBureau.notes.beats', { note: noteLabels[n.pitch]!, beats: n.beats }),
              )
              .join(', ')
      }
    >
      {notes.map((n, i) => (
        <span
          key={i}
          className={`note note-${n.pitch}`}
          title={t('oddBureau.notes.beats', { note: noteLabels[n.pitch]!, beats: n.beats })}
        >
          <span>{noteLabels[n.pitch]!}</span>
          {n.beats > 1 && (
            <small>
              {'×'}
              {n.beats}
            </small>
          )}
        </span>
      ))}
      {!notes.length && <span className="empty-notes">{t('oddBureau.notes.noSoundYet')}</span>}
    </div>
  );
}

function MachineGame({
  photo,
  objects,
  round,
  onChange,
  markerId,
}: {
  photo: Photo;
  objects: Prop[];
  round: MachineRound;
  onChange: (round: MachineRound) => void;
  markerId: string;
}) {
  const { t } = useAppPreviewLocale();
  const operationCopy = {
    source: {
      name: t('oddBureau.machine.operations.source.name'),
      rule: t('oddBureau.machine.operations.source.rule'),
    },
    echo: {
      name: t('oddBureau.machine.operations.echo.name'),
      rule: t('oddBureau.machine.operations.echo.rule'),
    },
    reverse: {
      name: t('oddBureau.machine.operations.reverse.name'),
      rule: t('oddBureau.machine.operations.reverse.rule'),
    },
    raise: {
      name: t('oddBureau.machine.operations.raise.name'),
      rule: t('oddBureau.machine.operations.raise.rule'),
    },
    slow: {
      name: t('oddBureau.machine.operations.slow.name'),
      rule: t('oddBureau.machine.operations.slow.rule'),
    },
    store: {
      name: t('oddBureau.machine.operations.store.name'),
      rule: t('oddBureau.machine.operations.store.rule'),
    },
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const player = useRef<TonePlayer | null>(null);
  const playId = useRef(0);
  const latest = useRef(round);
  latest.current = round;
  if (!player.current) player.current = new TonePlayer();
  useEffect(
    () => () => {
      playId.current++;
      player.current?.stop();
    },
    [],
  );
  const { plan, state } = round;
  const goal = useMemo(() => machineChallenge(plan, objects), [plan, objects]);
  let preview: ReturnType<typeof simulateMachine> | null = null;
  let pathHint = t('oddBureau.machineGame.startWithASoundSourceThenAdd');
  try {
    preview = simulateMachine(plan, objects, state.path);
    pathHint = '';
  } catch (e) {
    if (state.path.length) pathHint = errorMessage(e, t);
  }
  const node = plan.nodes.find((n) => n.objectId === selected);
  const prop = objects.find((p) => p.id === selected);
  const label = (id: string) => objects.find((p) => p.id === id)!.label;
  function stop() {
    playId.current++;
    player.current?.stop();
    setPlaying(false);
  }
  async function listen(notes: readonly Note[]): Promise<boolean> {
    const id = ++playId.current;
    setPlaying(true);
    setError('');
    try {
      return await player.current!.play(notes);
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      if (playId.current === id) setPlaying(false);
    }
  }
  function select(id: string) {
    stop();
    setSelected(id);
    setError('');
    if (!state.path.length && plan.nodes.find((n) => n.objectId === id)?.op !== 'source') return;
    try {
      onChange({ ...round, state: { ...state, path: editMachinePath(plan, state.path, id) } });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }
  function connect(from: string, to: string) {
    stop();
    setError('');
    setSelected(to);
    try {
      const path = editMachinePath(plan, editMachinePath(plan, state.path, from), to);
      onChange({ ...round, state: { ...state, path } });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }
  function run() {
    setError('');
    try {
      const next = runMachine(plan, objects, state);
      onChange({ ...round, state: next });
      if (sound) void listen(next.lastRun!.notes);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }
  async function pour(id: string) {
    const notes = state.stored[id] ?? [];
    const completed = await listen(notes);
    if (completed) {
      const current = latest.current;
      onChange({
        ...current,
        state: { ...current.state, stored: { ...current.state.stored, [id]: [] } },
      });
    }
  }
  const deviceDetail = (
    <div className="device-detail">
      {node && prop ? (
        <>
          <div className="device-heading">
            <ObjectPortrait prop={prop} photo={photo} />
            <div>
              <h3>{prop.label}</h3>
              <span>{operationCopy[node.op].name}</span>
            </div>
          </div>
          <p className="character-line">
            {'“'}
            {node.line}
            {'”'}
          </p>
          <p className="fixed-rule">{operationCopy[node.op].rule}</p>
          {node.op === 'source' && (
            <Notes notes={node.melody.map((pitch) => ({ pitch, beats: 1 }))} />
          )}
        </>
      ) : (
        <>
          <h3>{t('oddBureau.machineGame.eachOfThemHasATrick')}</h3>
          <p>{t('oddBureau.machineGame.clickObjectsInThePhotoToSee')}</p>
        </>
      )}
    </div>
  );
  return (
    <div className="play-layout machine-game">
      <div className="play-left">
        <div className="mobile-machine-goal">
          <strong>
            {state.solved
              ? t('oddBureau.machineGame.challengeCompleteKeepInventingFreely')
              : t('oddBureau.machine.sendSound', { receiver: label(goal.receiver) })}
          </strong>
          <div>
            <Notes notes={goal.notes} />
            <button
              type="button"
              onClick={() => void listen(goal.notes)}
              aria-label={t('oddBureau.machineGame.previewTheTargetMelody')}
            >
              <Volume2 size={19} />
            </button>
          </div>
          <small>
            {t('oddBureau.machineGame.wireLengthBudgetForThisChallenge')}
            {goal.cost}
          </small>
        </div>
        <PhotoStage
          photo={photo}
          objects={objects}
          selected={selected}
          path={state.path}
          flowing={playing}
          badges={Object.fromEntries(plan.nodes.map((n) => [n.objectId, operationCopy[n.op].name]))}
          onSelect={select}
          onConnect={connect}
          instruction={t('oddBureau.machine.connectInstruction')}
          markerId={markerId}
        />
        <div className="mobile-device-detail" aria-live="polite">
          {deviceDetail}
        </div>
        <div className="route-bench">
          <div className="route-heading">
            <strong>{t('oddBureau.machineGame.myCircuit')}</strong>
            <button
              type="button"
              onClick={() => {
                stop();
                onChange({ ...round, state: { ...state, path: [] } });
              }}
              disabled={!state.path.length}
            >
              <RotateCcw size={14} />
              {t('oddBureau.machineGame.removeTheCircuit')}
            </button>
          </div>
          <div className="route-chips">
            {state.path.map((id, i) => (
              <span className="route-chip-wrap" key={id}>
                {i > 0 && <ChevronRight size={15} />}
                <span className="route-chip">
                  {label(id)}
                  <button
                    type="button"
                    aria-label={t('oddBureau.machineGame.removeFromTheCircuit', {
                      labelId: label(id),
                    })}
                    onClick={() => {
                      stop();
                      onChange({
                        ...round,
                        state: { ...state, path: state.path.filter((p) => p !== id) },
                      });
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              </span>
            ))}
            {!state.path.length && (
              <p>{t('oddBureau.machineGame.startWithAnObjectTaggedSoundSource')}</p>
            )}
          </div>
          {preview ? (
            <div className="run-preview">
              <div>
                <span>{t('oddBureau.machineGame.thisCircuitProduces')}</span>
                <Notes notes={preview.notes} />
              </div>
              <span className="wire-cost">
                {t('oddBureau.machineGame.wireLength')}
                {preview.cost}
                <small>
                  {t('oddBureau.machineGame.challengeBudget')}
                  {goal.cost}
                </small>
              </span>
            </div>
          ) : (
            <p className="path-hint">{pathHint}</p>
          )}
          <div className="machine-run-actions">
            <Button
              className="primary-key"
              leadingIcon={<Play size={18} />}
              onClick={run}
              disabled={!preview || playing}
            >
              {t('oddBureau.machineGame.startThisStrangeMachine')}
            </Button>
            <IconButton
              icon={playing ? <Square size={17} /> : <Volume2 size={18} />}
              aria-label={
                playing
                  ? t('oddBureau.machineGame.stopSound')
                  : sound
                    ? t('oddBureau.machineGame.muteRunningAudio')
                    : t('oddBureau.machineGame.enableRunningAudio')
              }
              onClick={playing ? stop : () => setSound((v) => !v)}
              className={`sound-key ${sound ? 'enabled' : ''}`}
            />
          </div>
        </div>
        {state.lastRun && (
          <div className="machine-trace" aria-label={t('oddBureau.machineGame.lastRun')}>
            <strong>{t('oddBureau.machineGame.theSoundJustPassedThroughHere')}</strong>
            {state.lastRun.trace.map((step) => (
              <div key={step.objectId}>
                <span>{label(step.objectId)}</span>
                <Notes notes={step.notes} />
              </div>
            ))}
          </div>
        )}
      </div>
      <aside className="activity-panel">
        <div className={`machine-goal ${state.solved ? 'solved' : ''}`}>
          <span className="goal-symbol">
            {state.solved ? <Check size={25} /> : <Volume2 size={25} />}
          </span>
          <h2>
            {state.solved
              ? t('oddBureau.machineGame.itWorkedInventSomethingElse')
              : t('oddBureau.machineGame.makeThisShortSoundFirst')}
          </h2>
          <p>
            {t('oddBureau.machineGame.sendInto')}
            <strong>{label(goal.receiver)}</strong>
            {t('oddBureau.machineGame.withWireLengthAtMost')}
            {goal.cost}
            {t('oddBureau.machineGame.label')}
          </p>
          <Notes notes={goal.notes} />
          <button type="button" className="text-action" onClick={() => void listen(goal.notes)}>
            {t('oddBureau.machineGame.listenToTheTargetMelody')}
            <Play size={13} />
          </button>
          {state.solved && (
            <p className="success-caption">
              {t('oddBureau.machineGame.targetCompleteTryAnotherCircuitAndSee')}
            </p>
          )}
        </div>
        {deviceDetail}
        <div className="sound-shelves">
          <h3>{t('oddBureau.machineGame.storedSound')}</h3>
          {plan.nodes
            .filter((n) => n.op === 'store')
            .map((n) => {
              const notes = state.stored[n.objectId] ?? [];
              return (
                <div className="sound-shelf" key={n.objectId}>
                  <div>
                    <strong>{label(n.objectId)}</strong>
                    <span>
                      {notes.length} {t('oddBureau.machineGame.32Notes')}
                    </span>
                  </div>
                  <Notes notes={notes} />
                  <div className="shelf-actions">
                    <button
                      type="button"
                      disabled={!notes.length || playing}
                      onClick={() => void pour(n.objectId)}
                    >
                      <Volume2 size={14} />
                      {t('oddBureau.machineGame.pourItOutAndListen')}
                    </button>
                    <button
                      type="button"
                      disabled={!notes.length || playing}
                      onClick={() =>
                        onChange({
                          ...round,
                          state: { ...state, stored: { ...state.stored, [n.objectId]: [] } },
                        })
                      }
                    >
                      <Trash2 size={14} />
                      {t('oddBureau.machineGame.clear')}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Strike game (StrikeGame.tsx)                                               */
/* ------------------------------------------------------------------------ */

function StrikeGame({
  content,
  photo,
  objects,
  round,
  onChange,
  onRestart,
  onVoice,
  markerId,
}: {
  content: HeroDemoOddBureauPreview;
  photo: Photo;
  objects: Prop[];
  round: StrikeRound;
  onChange: (round: StrikeRound) => void;
  onRestart: () => void;
  onVoice: () => void;
  markerId: string;
}) {
  const { t } = useAppPreviewLocale();
  const taskLabels = {
    story: t('oddBureau.tasks.writeStory'),
    reading: t('oddBureau.tasks.readAloud'),
    stage: t('oddBureau.tasks.setTheStage'),
  };
  const [selected, setSelected] = useState(objects[0]!.id);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<{ reply: string; actions: PromiseAction[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const proposalPanel = useRef<HTMLDivElement>(null);
  const { plan, state } = round;
  const current = commitPromises(plan, [], state.promises);
  const ready = strikeReady(current);
  const performance = state.performance;
  const deadlocked = useMemo(
    () => !findStrikeSolution(plan, state.promises),
    [plan, state.promises],
  );
  const person = plan.people.find((p) => p.objectId === selected)!;
  const prop = objects.find((p) => p.id === selected)!;
  const label = (id: string | null | undefined) =>
    objects.find((p) => p.id === id)?.label ?? t('oddBureau.strikeGame.nobodyYet');
  const describeAction = (action: PromiseAction) =>
    action.kind === 'rest'
      ? t('oddBureau.strikeGame.grantARest', { labelActionObjectId: label(action.objectId) })
      : action.kind === 'credit'
        ? t('oddBureau.strikeGame.giveTheSoleCreditTo', {
            labelActionObjectId: label(action.objectId),
          })
        : t('oddBureau.strikeGame.askTo', {
            name: label(action.objectId),
            task: taskLabels[action.task].toLowerCase(),
          });
  const describeOffer = (offer: StrikeOffer) =>
    [
      offer.needsCredit ? t('oddBureau.strikeGame.iNeedACredit') : '',
      offer.needsRest
        ? t('oddBureau.strikeGame.letRestFirst', { labelOfferNeedsRest: label(offer.needsRest) })
        : '',
    ]
      .filter(Boolean)
      .join('; ') || t('oddBureau.strikeGame.iMWillingToHelpDirectly');
  let preview: ReturnType<typeof commitPromises> | null = null;
  let proposalError = '';
  if (proposal?.actions.length) {
    try {
      preview = commitPromises(plan, state.promises, proposal.actions);
    } catch (e) {
      proposalError = errorMessage(e, t);
    }
  }
  const proposalEndsRound = preview ? !findStrikeSolution(plan, preview.promises) : false;
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (proposal) proposalPanel.current?.scrollIntoView({ block: 'nearest' });
  }, [proposal]);
  function propose(action: PromiseAction) {
    setError('');
    setProposal({
      reply: t('oddBureau.propose.reviewTheEffectsOfThisArrangementIt'),
      actions: [action],
    });
  }
  function confirm() {
    if (!proposal?.actions.length || !preview) return;
    const next = commitPromises(plan, state.promises, proposal.actions);
    onChange({
      ...round,
      state: {
        ...state,
        promises: next.promises,
        journal: [
          ...state.journal,
          ...proposal.actions.map((a) =>
            t('oddBureau.confirm.fulfilled', { describeActionA: describeAction(a) }),
          ),
        ].slice(-12),
      },
    });
    setProposal(null);
    setMessage('');
  }
  async function ask() {
    if (!message.trim() || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setProposal(null);
    try {
      await sleep(PROPOSAL_MS, controller.signal);
      setProposal(interpretProposalLocally(plan, objects, message.trim(), t));
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e, t));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function perform() {
    if (!ready || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      await sleep(PERFORMANCE_MS, controller.signal);
      onChange({
        ...round,
        state: { ...state, performance: [...content.performance], curtain: 0 },
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e, t));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const badges = Object.fromEntries(
    objects.map((p) => [
      p.id,
      current.rest === p.id
        ? t('oddBureau.strikeGame.grantedARest')
        : [
            ...TASKS.filter((t) => current.tasks[t] === p.id).map((t) => taskLabels[t]),
            ...(current.credit === p.id ? [t('oddBureau.strikeGame.credit')] : []),
          ].join(' · ') ||
          (performance
            ? t('oddBureau.strikeGame.audience')
            : t('oddBureau.strikeGame.waitingToNegotiate')),
    ]),
  );
  return (
    <div className="play-layout strike-game">
      <div className="play-left">
        <PhotoStage
          photo={photo}
          objects={objects}
          selected={selected}
          badges={badges}
          resting={current.rest}
          active={performance && state.curtain < 3 ? current.tasks.reading : null}
          onSelect={(id) => {
            if (!busy) setSelected(id);
          }}
          instruction={
            performance
              ? state.curtain === 3
                ? t('oddBureau.strikeGame.theStoryHasEndedEveryPromiseStill')
                : t('oddBureau.strikeGame.theStorytellingBegins')
              : t('oddBureau.strikeGame.chooseACompanionToHearWhatThey')
          }
          markerId={markerId}
        />
        <div className="promise-board">
          <div className="route-heading">
            <strong>{t('oddBureau.strikeGame.promisesMade')}</strong>
            <span>
              {state.promises.length} {t('oddBureau.strikeGame.promises')}
            </span>
          </div>
          {state.promises.length ? (
            <ol>
              {state.promises.map((a, i) => (
                <li key={i}>
                  <Check size={15} />
                  {describeAction(a)}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t('oddBureau.strikeGame.discussConditionsThenConfirmEveryPromiseIs')}</p>
          )}
        </div>
      </div>
      <aside className="activity-panel">
        <div className="strike-mission">
          <h2>
            {performance
              ? state.curtain === 3
                ? t('oddBureau.strikeGame.promisesKeptCurtainDown')
                : t('oddBureau.strikeGame.tonightSStorytelling')
              : t('oddBureau.strikeGame.makeTheStorytellingPossible')}
          </h2>
          <p>
            {performance
              ? t('oddBureau.strike.credits', {
                  credit: label(current.credit),
                  reader: label(current.tasks.reading),
                })
              : plan.situation}
          </p>
          <div className="allocation-row">
            <span>
              <Moon size={16} />
              {current.rest
                ? t('oddBureau.strike.resting', { name: label(current.rest) })
                : t('oddBureau.strikeGame.oneRestSlot')}
            </span>
            <span>
              <Feather size={16} />
              {current.credit
                ? t('oddBureau.strike.credited', { name: label(current.credit) })
                : t('oddBureau.strikeGame.oneCreditSlot')}
            </span>
          </div>
          <p className="strike-limits">{t('oddBureau.strikeGame.eachObjectCanDoAtMostTwo')}</p>
          <div className="task-slots">
            {TASKS.map((task) => (
              <div key={task} className={current.tasks[task] ? 'filled' : ''}>
                <span>{taskLabels[task]}</span>
                <strong>{label(current.tasks[task])}</strong>
                {current.tasks[task] && <Check size={14} />}
              </div>
            ))}
          </div>
        </div>
        {performance ? (
          <div className="performance">
            <p className="leave-note">
              <Moon size={16} />
              {label(current.rest)}
              {t('oddBureau.strikeGame.restEasyEveryArrangementFollowsTheAgreement')}
            </p>
            {state.curtain < 3 ? (
              <>
                <span className="act-number">
                  {label(current.tasks.story)}
                  {t('oddBureau.strikeGame.sTaleAct')}
                  {state.curtain + 1} {t('oddBureau.strikeGame.3')}
                </span>
                <p className="story-part">{performance[state.curtain]}</p>
                <Button
                  className="upload-key"
                  leadingIcon={<Volume2 size={17} />}
                  onClick={onVoice}
                >
                  {t('oddBureau.strikeGame.hearReadThisAct', {
                    labelCurrentTasksReading: label(current.tasks.reading),
                  })}
                </Button>
                <Button
                  className="primary-key"
                  trailingIcon={<ArrowRight size={18} />}
                  onClick={() =>
                    onChange({ ...round, state: { ...state, curtain: state.curtain + 1 } })
                  }
                >
                  {state.curtain === 2
                    ? t('oddBureau.strikeGame.curtainCall')
                    : t('oddBureau.strikeGame.nextAct')}
                </Button>
              </>
            ) : (
              <>
                <div className="curtain-check">
                  <Check size={35} />
                </div>
                <p className="story-part">
                  {t('oddBureau.strikeGame.someoneFoundRestAndSomeoneFinallyReceived')}
                </p>
                {performance.map((part, i) => (
                  <p className="recap-part" key={i}>
                    {part}
                  </p>
                ))}
              </>
            )}
          </div>
        ) : deadlocked ? (
          <div className="performance round-failed">
            <h2>{t('oddBureau.strikeGame.thisTimeTheShowCannotBegin')}</h2>
            <p className="story-part">
              {t('oddBureau.strikeGame.promisesAlreadyMadeStayInForceBut')}
            </p>
            <p>{t('oddBureau.strikeGame.reviewThePromisesOnTheLeftAnd')}</p>
            <Button className="primary-key" onClick={onRestart}>
              {t('oddBureau.strikeGame.startAnotherNegotiation')}
            </Button>
          </div>
        ) : (
          <>
            <div className="strike-person">
              <div className="device-heading">
                <ObjectPortrait prop={prop} photo={photo} />
                <div>
                  <h3>{prop.label}</h3>
                  <span>{person.persona}</span>
                </div>
              </div>
              <div className="allocation-actions">
                <Button
                  size="sm"
                  leadingIcon={<Moon size={14} />}
                  disabled={busy || !!current.rest}
                  onClick={() => propose({ kind: 'rest', objectId: selected })}
                >
                  {t('oddBureau.strikeGame.proposeARest')}
                </Button>
                <Button
                  size="sm"
                  leadingIcon={<Feather size={14} />}
                  disabled={busy || !!current.credit}
                  onClick={() => propose({ kind: 'credit', objectId: selected })}
                >
                  {t('oddBureau.strikeGame.proposeACredit')}
                </Button>
              </div>
              <div className="offer-list">
                {person.offers.map((offer) => (
                  <button
                    type="button"
                    key={offer.task}
                    disabled={busy || !!current.tasks[offer.task]}
                    onClick={() =>
                      propose({ kind: 'assign', objectId: selected, task: offer.task })
                    }
                  >
                    <span>
                      <strong>{taskLabels[offer.task]}</strong>
                      <small>{describeOffer(offer)}</small>
                    </span>
                    {current.tasks[offer.task] ? <Check size={16} /> : <ArrowRight size={16} />}
                  </button>
                ))}
              </div>
            </div>
            {proposal && (
              <div className="proposal-review" ref={proposalPanel}>
                <div>
                  <strong>{t('oddBureau.strikeGame.anUnspokenProposal')}</strong>
                  <button
                    type="button"
                    aria-label={t('oddBureau.strikeGame.withdrawProposal')}
                    onClick={() => setProposal(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <p>{proposal.reply}</p>
                {proposal.actions.length > 0 && (
                  <ol>
                    {proposal.actions.map((a, i) => (
                      <li key={i}>{describeAction(a)}</li>
                    ))}
                  </ol>
                )}
                {proposalError ? (
                  <p className="proposal-problem" role="status">
                    {proposalError}
                  </p>
                ) : (
                  preview && (
                    <p className="proposal-impact">
                      {t('oddBureau.strikeGame.afterConfirmation')}{' '}
                      {TASKS.filter((t) => preview!.tasks[t]).length}
                      {t('oddBureau.strikeGame.3JobsArrangedRest')}{' '}
                      {preview.rest
                        ? t('oddBureau.strikeGame.promised')
                        : t('oddBureau.strikeGame.available')}
                      {t('oddBureau.strikeGame.credit2')}{' '}
                      {preview.credit
                        ? t('oddBureau.strikeGame.promised')
                        : t('oddBureau.strikeGame.available')}
                      {t('oddBureau.strikeGame.label')}
                    </p>
                  )
                )}
                {proposalEndsRound && (
                  <p className="proposal-problem">
                    {t('oddBureau.strikeGame.thisPromiseMakesTheStorytellingImpossibleIn')}
                  </p>
                )}
                <Button className="primary-key" disabled={!preview || busy} onClick={confirm}>
                  {proposalEndsRound
                    ? t('oddBureau.strikeGame.acceptThisEnding')
                    : t('oddBureau.strikeGame.confirmThisPromise')}
                </Button>
              </div>
            )}
            {ready ? (
              <div className="ready-to-perform">
                <p>
                  <Check size={17} />
                  {t('oddBureau.strikeGame.everythingIsArrangedLetThemPerformThe')}
                </p>
                <Button
                  className="primary-key"
                  leadingIcon={<Play size={18} />}
                  disabled={busy}
                  onClick={() => void perform()}
                >
                  {busy
                    ? t('oddBureau.strikeGame.writingTonightSStory')
                    : t('oddBureau.strikeGame.beginTheStorytelling')}
                </Button>
              </div>
            ) : (
              <div className="proposal-composer">
                <label htmlFor="strike-proposal">
                  {t('oddBureau.strikeGame.orDescribeYourArrangementDirectly')}
                </label>
                <TextareaField
                  id="strike-proposal"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={400}
                  rows={2}
                  placeholder={t('oddBureau.strikeGame.forExampleLetOneCompanionRestThen')}
                  disabled={busy}
                />
                <Button
                  className="upload-key"
                  disabled={busy || !message.trim()}
                  onClick={() => void ask()}
                >
                  {busy
                    ? t('oddBureau.strikeGame.organizingYourProposal')
                    : t('oddBureau.strikeGame.askTheStewardToOrganizeTheProposal')}
                </Button>
              </div>
            )}
            {busy && (
              <button
                type="button"
                className="text-action cancel-proposal"
                onClick={() => request.current?.abort()}
              >
                {t('oddBureau.strikeGame.cancelThisGeneration')}
              </button>
            )}
          </>
        )}
        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Photo mystery (App.tsx OddBureau)                                          */
/* ------------------------------------------------------------------------ */

function Mystery({
  content,
  onExit,
  onSettings,
  onVoice,
  onHostOnly,
}: {
  content: HeroDemoOddBureauPreview;
  onExit: () => void;
  onSettings: () => void;
  onVoice: () => void;
  onHostOnly: () => void;
}) {
  const { t } = useAppPreviewLocale();
  const photo = content.photo;
  const [session, setSession] = useState<Session | null>(null);
  const [mood, setMood] = useState<HeroDemoOddBureauMoodId>('missing');
  const [stage, setStage] = useState<'locating' | 'writing' | null>(null);
  const [foundProps, setFoundProps] = useState<Prop[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'witness' | 'notebook'>('witness');
  const [question, setQuestion] = useState(() => '');
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
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    chatBottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [streaming, session?.messages, selected]);
  function updateSession(next: Session) {
    sessionRef.current = next;
    setSession(next);
  }

  async function startCase() {
    if (busy || operation.current) return;
    setError('');
    setAccusing(false);
    setConfirmAccusation(null);
    setShowHint(false);
    setSelected(null);
    setPanel('witness');
    setFoundProps([]);
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
      updateSession({
        id: mintId(),
        mood,
        props,
        mystery,
        discovered: [],
        evidence: [],
        messages: {},
        accusation: null,
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e, t));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setStage(null);
      }
    }
  }
  function discover(prop: Prop) {
    const current = sessionRef.current;
    if (!current || stage || talking) return;
    setError('');
    setQuestion('');
    setStreaming('');
    setShowHint(false);
    setMiss(false);
    if (accusing) {
      setConfirmAccusation(prop.id);
      return;
    }
    setSelected(prop.id);
    setPanel('witness');
    if (!current.discovered.includes(prop.id))
      updateSession({ ...current, discovered: [...current.discovered, prop.id] });
  }
  function collect(characterId: string) {
    const current = sessionRef.current;
    const character = current?.mystery.characters.find((c) => c.objectId === characterId);
    if (!current || !character || current.evidence.includes(characterId)) return;
    const messages = current.messages[characterId] ?? [];
    updateSession({
      ...current,
      evidence: [...current.evidence, characterId],
      messages: {
        ...current.messages,
        [characterId]: [
          ...messages,
          { who: 'player', text: t('oddBureau.collect.whatDidYouNoticeWhenItHappened') },
          { who: 'object', text: character.testimony },
        ],
      },
    });
  }
  async function ask(text = question) {
    const current = sessionRef.current;
    const character = current?.mystery.characters.find((c) => c.objectId === selected);
    const trimmed = text.trim();
    if (!current || !character || !trimmed || busy || current.accusation) return;
    setTalking(true);
    setError('');
    setStreaming('');
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
      updateSession({
        ...latest,
        messages: {
          ...latest.messages,
          [character.objectId]: [
            ...(latest.messages[character.objectId] ?? []).slice(-22),
            { who: 'player', text: trimmed },
            { who: 'object', text: answer },
          ],
        },
      });
      setQuestion('');
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e, t));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setTalking(false);
        setStreaming('');
      }
    }
  }
  function finishCase() {
    if (!session || !confirmAccusation || !canAccuse(session)) return;
    updateSession({ ...session, accusation: confirmAccusation });
    setAccusing(false);
    setConfirmAccusation(null);
    setSelected(null);
  }
  function newCase() {
    operation.current?.abort();
    setSession(null);
    sessionRef.current = null;
    setSelected(null);
    setError('');
    setQuestion('');
    setAccusing(false);
    setConfirmAccusation(null);
  }

  const character = session?.mystery.characters.find((c) => c.objectId === selected);
  const selectedProp = session?.props.find((p) => p.id === selected);
  const complete = !!session?.accusation;
  const culprit = session?.mystery.characters.find((c) => c.objectId === session.mystery.culpritId);
  const accused = session?.mystery.characters.find((c) => c.objectId === confirmAccusation);
  const nameOf = (id: string) => session?.props.find((p) => p.id === id)?.label ?? '';

  return (
    <div className="odd-bureau" data-density="expressive" data-odd-bureau-screen="mystery">
      <header className="bureau-header">
        <button
          type="button"
          className="wordmark"
          onClick={() => setShowHelp((value) => !value)}
          aria-label={t('oddBureau.mystery.oddBureauViewPlayOptions')}
        >
          <Fingerprint size={33} strokeWidth={1.7} />
          <span>
            {t('oddBureau.mystery.oddBureau')}
            <span className="wordmark-en">{t('oddBureau.mystery.oddBureau2')}</span>
          </span>
        </button>
        <Button className="quiet-button" onClick={onExit} disabled={busy}>
          {t('oddBureau.mystery.backToThePlayground')}
        </Button>
        <div className="header-actions">
          <span className="nimi-credit">{t('oddBureau.mystery.poweredByNimi')}</span>
          <IconButton
            className="help-button"
            icon={<Settings2 size={20} />}
            aria-label={t('oddBureau.mystery.capabilitySettings')}
            onClick={onSettings}
            disabled={busy}
          />
          <IconButton
            className="help-button"
            icon={<CircleHelp size={21} />}
            aria-label={t('oddBureau.mystery.howToPlay')}
            onClick={() => setShowHelp((value) => !value)}
          />
        </div>
      </header>
      {showHelp && (
        <div className="how-to">
          <div>
            <strong>{t('oddBureau.mystery.onePhotoOneAbsurdLittleMystery')}</strong>
            <p>{t('oddBureau.mystery.chooseAPhotoWithAtLeastThree')}</p>
            <p>{t('oddBureau.mystery.nimiLocatesTheObjectsVisuallyTextAnd')}</p>
          </div>
          <IconButton
            icon={<X size={18} />}
            aria-label={t('oddBureau.mystery.closePlayInstructions')}
            onClick={() => setShowHelp(false)}
          />
        </div>
      )}
      <main className={`bureau-main ${session ? 'in-case' : 'at-home'}`}>
        {!session && (
          <div className="intro-line">
            <div>
              <h1>
                {t('oddBureau.mystery.theObjectsInYourPhoto')}
                <br />
                {t('oddBureau.mystery.have')}
                <span className="trouble-word">{t('oddBureau.mystery.something')}</span>
                {t('oddBureau.mystery.toHide')}
              </h1>
              <p>{t('oddBureau.mystery.photographEverydayLifeLetObjectsSpeakAnd')}</p>
            </div>
            <div className="play-note">
              <span className="play-note-title">{t('oddBureau.mystery.openToday')}</span>
              <span>{t('oddBureau.mystery.absurdDeductionOnePhotoEndless')}</span>
              <MousePointer2 size={23} />
            </div>
          </div>
        )}
        {session && (
          <div className="case-heading">
            <div>
              <h1>{session.mystery.title}</h1>
              <p>{session.mystery.incident}</p>
            </div>
            <Button
              className="quiet-button"
              leadingIcon={<ArrowLeft size={16} />}
              onClick={newCase}
              disabled={busy}
            >
              {t('oddBureau.mystery.changeCase')}
            </Button>
          </div>
        )}
        <div className="arcade">
          <section className="scene-column" aria-label={t('oddBureau.mystery.photoScene')}>
            <div className="scene-top">
              <span>
                <span className="live-dot" />
                {session
                  ? complete
                    ? t('oddBureau.mystery.caseRevealed')
                    : t('oddBureau.mystery.investigationInProgress')
                  : t('oddBureau.mystery.itAllBeginsWithThisPhoto')}
              </span>
              <span>{photo.name}</span>
            </div>
            <div className={`photo-frame ${accusing ? 'accusing' : ''}`}>
              <div
                className="photo-plane"
                style={{ aspectRatio: `${photo.width}/${photo.height}` }}
                onClick={(event) => {
                  if (!session || busy || complete) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const prop = hitProp(
                    session.props,
                    (event.clientX - bounds.left) / bounds.width,
                    (event.clientY - bounds.top) / bounds.height,
                  );
                  if (prop) discover(prop);
                  else {
                    setMiss(true);
                    setShowHint(true);
                  }
                }}
              >
                <img
                  className="scene-photo"
                  src={photo.src}
                  alt={
                    session
                      ? t('oddBureau.mystery.sceneLabel', { photoName: photo.name })
                      : t('oddBureau.mystery.selectedPhotoLabel', { photoName: photo.name })
                  }
                  draggable={false}
                />
                {!session && !stage && (
                  <div className="sample-tag">
                    <ImagePlus size={14} />
                    {t('oddBureau.mystery.aiCreatedSamplePhotoOpenACase')}
                  </div>
                )}
                {session &&
                  !complete &&
                  session.props.map((prop, index) => {
                    const revealed = showHint || session.discovered.includes(prop.id) || accusing;
                    return (
                      <button
                        key={prop.id}
                        type="button"
                        className={`object-hit ${revealed ? 'revealed' : ''} ${selected === prop.id ? 'selected' : ''} ${session.evidence.includes(prop.id) ? 'has-evidence' : ''}`}
                        style={{
                          left: `${prop.box.x1 * 100}%`,
                          top: `${prop.box.y1 * 100}%`,
                          width: `${(prop.box.x2 - prop.box.x1) * 100}%`,
                          height: `${(prop.box.y2 - prop.box.y1) * 100}%`,
                        }}
                        aria-label={`${accusing ? t('oddBureau.mystery.accuse') : t('oddBureau.mystery.investigate')}${prop.label}`}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          discover(prop);
                        }}
                      >
                        <span className="hotspot-number">
                          {session.evidence.includes(prop.id) ? (
                            <Check size={15} />
                          ) : (
                            String(index + 1).padStart(2, '0')
                          )}
                        </span>
                        <span className="hotspot-label">{prop.label}</span>
                      </button>
                    );
                  })}
                {complete && (
                  <div className="scene-verdict">
                    <Fingerprint size={38} />
                    <span>
                      {session!.accusation === session!.mystery.culpritId
                        ? t('oddBureau.mystery.nicelySolved')
                        : t('oddBureau.mystery.theTruthLiesWithAnotherObject')}
                    </span>
                    <p>
                      {t('oddBureau.mystery.itWas')}
                      {nameOf(culprit?.objectId ?? '')}
                      {t('oddBureau.mystery.behindIt')}
                    </p>
                  </div>
                )}
                {stage && (
                  <div className="generation-overlay" role="status" aria-live="polite">
                    <div className="scan-mark">
                      <Search size={36} />
                    </div>
                    <h2>
                      {stage === 'locating'
                        ? t('oddBureau.mystery.quietWhoSAtTheScene')
                        : t('oddBureau.mystery.theObjectsAreGettingTheirStoriesStraight')}
                    </h2>
                    <p>
                      {stage === 'locating'
                        ? foundProps.length
                          ? t('oddBureau.mystery.locating', {
                              names: foundProps.map((prop) => prop.label).join('、'),
                            })
                          : t('oddBureau.mystery.findingObjectsToBringIntoPlayThe')
                        : t('oddBureau.mystery.weavingCharactersTestimonyAndACoherentExplanation')}
                    </p>
                    <Button className="cancel-key" onClick={() => operation.current?.abort()}>
                      {t('oddBureau.mystery.cancelCaseOpening')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="scene-bottom">
              <span>
                {session
                  ? accusing
                    ? t('oddBureau.mystery.chooseTheObjectYouSuspect')
                    : complete
                      ? t('oddBureau.mystery.theSamePhotoCanHoldAnotherMystery')
                      : miss
                        ? t('oddBureau.mystery.noCharactersHereYetHighlightedObjectsCan')
                        : t('oddBureau.mystery.tryClickingObjectsInThePhotoThey')
                  : t('oddBureau.mystery.aDeskALivingRoomABookshelf')}
              </span>
              {session && !complete && (
                <button
                  type="button"
                  className="hint-key"
                  onClick={() => {
                    setShowHint((v) => !v);
                    setMiss(false);
                  }}
                  disabled={busy}
                >
                  <Lightbulb size={15} />
                  {showHint ? t('oddBureau.mystery.hideHints') : t('oddBureau.mystery.canTFindIt')}
                </button>
              )}
            </div>
            {session && (
              <div
                className="cast-strip"
                aria-label={t('oddBureau.mystery.objectsToInvestigateAlsoSelectableByKeyboard')}
              >
                {session.props.map((prop, index) => {
                  const known = session.discovered.includes(prop.id) || complete;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      className={`cast-key ${selected === prop.id ? 'active' : ''}`}
                      onClick={() => discover(prop)}
                      disabled={busy || complete}
                      aria-label={t('oddBureau.mystery.investigate2', { propLabel: prop.label })}
                    >
                      <ObjectPortrait prop={prop} photo={photo} />
                      <span>
                        {known
                          ? prop.label
                          : t('oddBureau.mystery.objectNumber', { number: index + 1 })}
                      </span>
                      <small>
                        {session.evidence.includes(prop.id)
                          ? t('oddBureau.mystery.testimonyRecorded')
                          : known
                            ? t('oddBureau.mystery.keepQuestioning')
                            : t('oddBureau.mystery.notInterviewed')}
                      </small>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <aside
            className={`case-panel ${!session ? 'start-panel' : ''}`}
            aria-label={
              session
                ? t('oddBureau.mystery.investigationJournal')
                : t('oddBureau.mystery.startANewCase')
            }
          >
            {!session ? (
              <>
                <div className="welcome-stamp">
                  <Fingerprint size={43} strokeWidth={1.4} />
                  <span>
                    {t('oddBureau.mystery.oddObjectInvestigator')}
                    <br />
                    <b>{t('oddBureau.mystery.yourInvitation')}</b>
                  </span>
                  <Sparkles className="stamp-spark" size={19} />
                </div>
                <h2>{t('oddBureau.mystery.whatShallWeInvestigateToday')}</h2>
                <p className="panel-intro">
                  {t('oddBureau.mystery.theObjectsHaveLittleSecretsOfTheir')}
                  <br />
                  {t('oddBureau.mystery.chooseAStoryAndLetThemSlip')}
                </p>
                <div
                  className="mood-options"
                  role="group"
                  aria-label={t('oddBureau.mystery.chooseACaseStyle')}
                >
                  {createMysteryMoods(t).map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`mood-key ${mood === item.id ? 'active' : ''}`}
                      onClick={() => setMood(item.id)}
                      disabled={busy}
                      aria-pressed={mood === item.id}
                    >
                      <span className="mood-symbol">
                        {index === 0 ? <Search /> : index === 1 ? <AudioLines /> : <Sparkles />}
                      </span>
                      <span>
                        <b>{item.name}</b>
                        <small>{item.hint}</small>
                      </span>
                      <span className="mood-check">
                        {mood === item.id ? <Check size={15} /> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="start-actions">
                  <Button
                    className="primary-key"
                    leadingIcon={<Fingerprint size={22} />}
                    trailingIcon={<ArrowRight size={20} />}
                    onClick={() => void startCase()}
                    disabled={busy}
                  >
                    {stage
                      ? t('oddBureau.mystery.openingTheCase')
                      : t('oddBureau.mystery.useThisPhotoAndOpenTheCase')}
                  </Button>
                  <Button
                    className="upload-key"
                    leadingIcon={<ImagePlus size={18} />}
                    onClick={onHostOnly}
                    disabled={busy}
                  >
                    {t('oddBureau.mystery.useMyOwnPhoto')}
                  </Button>
                </div>
                <p className="first-play-note">
                  {t('oddBureau.mystery.firstVisitPlayWithThisPhoto')}
                  <br />
                  {t('oddBureau.mystery.noPromptOrStoryIdeaNeeded')}
                </p>
              </>
            ) : complete ? (
              <div className="reveal-panel">
                <div className="solved-mark">
                  <CheckCheck size={31} />
                </div>
                <h2>
                  {session.accusation === session.mystery.culpritId
                    ? t('oddBureau.mystery.everydayLifeIsnTSoSimple')
                    : t('oddBureau.mystery.thisTimeItFooledYou')}
                </h2>
                <p className="culprit-name">
                  {t('oddBureau.mystery.behindTheTrouble')}
                  <strong>{nameOf(culprit?.objectId ?? '')}</strong>
                </p>
                <p className="resolution">{session.mystery.resolution}</p>
                <div className="reasoning">
                  <h3>{t('oddBureau.mystery.connectTheseStatements')}</h3>
                  {session.mystery.decisiveEvidenceIds.map((id) => {
                    const c = session.mystery.characters.find((c) => c.objectId === id)!;
                    return (
                      <p key={id}>
                        <b>{nameOf(id)}</b>
                        <span>{c.testimony}</span>
                        {!session.evidence.includes(id) && (
                          <small>{t('oddBureau.mystery.thisTestimonyHasNotBeenCollectedIn')}</small>
                        )}
                      </p>
                    );
                  })}
                </div>
                <Button
                  className="primary-key"
                  trailingIcon={<ArrowRight size={19} />}
                  onClick={() => {
                    newCase();
                    void startCase();
                  }}
                  disabled={busy}
                >
                  {t('oddBureau.mystery.anotherCaseWithThisPhoto')}
                </Button>
                <Button className="upload-key" onClick={newCase}>
                  {t('oddBureau.mystery.openACaseWithANewPhoto')}
                </Button>
                <p className="fiction-note">
                  {t('oddBureau.mystery.thisIsAFictionalMysteryCreatedBy')}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="panel-tabs"
                  role="group"
                  aria-label={t('oddBureau.mystery.investigationPanel')}
                >
                  <button
                    type="button"
                    aria-pressed={panel === 'witness'}
                    onClick={() => setPanel('witness')}
                  >
                    {t('oddBureau.mystery.objectTestimony')}
                    <MessageCircle size={16} />
                  </button>
                  <button
                    type="button"
                    aria-pressed={panel === 'notebook'}
                    onClick={() => setPanel('notebook')}
                  >
                    {t('oddBureau.mystery.clueNotebook')}
                    <span>{session.evidence.length}</span>
                  </button>
                </div>
                <div className="panel-body">
                  {confirmAccusation && accused ? (
                    <div className="accusation-panel">
                      <Fingerprint size={44} />
                      <h2>
                        {t('oddBureau.mystery.itS')}
                        {nameOf(accused.objectId)}
                        {t('oddBureau.mystery.label')}
                      </h2>
                      <p>
                        {t('oddBureau.mystery.confirmToRevealTheTruthOfThis')}
                        <br />
                        {t('oddBureau.mystery.stillUnsureGoBackAndAskA')}
                      </p>
                      <Button className="primary-key" onClick={finishCase}>
                        {t('oddBureau.mystery.confirmAccusationAndRevealTheTruth')}
                      </Button>
                      <Button
                        className="upload-key"
                        onClick={() => {
                          setConfirmAccusation(null);
                          setAccusing(false);
                        }}
                      >
                        {t('oddBureau.mystery.investigateFurther')}
                      </Button>
                    </div>
                  ) : panel === 'notebook' ? (
                    <div className="notebook">
                      <h2>
                        {t('oddBureau.mystery.listenToTheirWords')}
                        <br />
                        {t('oddBureau.mystery.andWhatLiesBetweenThem')}
                      </h2>
                      {session.evidence.length ? (
                        session.evidence.map((id, index) => {
                          const c = session.mystery.characters.find((c) => c.objectId === id)!;
                          return (
                            <article className="evidence-note" key={id}>
                              <span className="evidence-number">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <div>
                                <h3>{c.clueTitle}</h3>
                                <p>{c.testimony}</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelected(id);
                                    setPanel('witness');
                                  }}
                                >
                                  {nameOf(id)}
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <div className="no-clues">
                          <Search size={32} />
                          <p>
                            {t('oddBureau.mystery.anEmptyPageIsFine')}
                            <br />
                            {t('oddBureau.mystery.chooseAnObjectAndAskWhatIt')}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : character && selectedProp ? (
                    <div className="witness">
                      <div className="witness-profile">
                        <ObjectPortrait prop={selectedProp} photo={photo} />
                        <div>
                          <h2>{selectedProp.label}</h2>
                          <p>{character.persona}</p>
                        </div>
                        <IconButton
                          className="voice-key"
                          icon={<Volume2 size={19} />}
                          aria-label={t('oddBureau.mystery.hearItsAccount')}
                          onClick={onVoice}
                          disabled={talking}
                        />
                      </div>
                      <div
                        className="conversation"
                        aria-label={t('oddBureau.mystery.conversationWith', {
                          selectedPropLabel: selectedProp.label,
                        })}
                      >
                        <p className="object-message">{character.greeting}</p>
                        {(session.messages[character.objectId] ?? []).map((message, index) => (
                          <p
                            key={index}
                            className={
                              message.who === 'player' ? 'player-message' : 'object-message'
                            }
                          >
                            {message.text}
                          </p>
                        ))}
                        {talking && (
                          <p className="object-message streaming" role="status">
                            {streaming || t('oddBureau.mystery.itSThinkingReadyToSpeak')}
                          </p>
                        )}
                        <div ref={chatBottom} />
                      </div>
                      {!session.evidence.includes(character.objectId) ? (
                        <button
                          type="button"
                          className="evidence-action"
                          onClick={() => collect(character.objectId)}
                          disabled={talking}
                        >
                          <Search size={18} />
                          <span>{t('oddBureau.mystery.askWhatItSawWhenTheIncident')}</span>
                          <ArrowRight size={17} />
                        </button>
                      ) : (
                        <div className="collected-tag">
                          <Check size={16} />
                          {t('oddBureau.mystery.keyTestimonyAddedToTheClueNotebook')}
                        </div>
                      )}
                      <div className="question-area">
                        <button
                          type="button"
                          className="suggested-question"
                          onClick={() => void ask(character.suggestedQuestion)}
                          disabled={talking}
                        >
                          {character.suggestedQuestion}
                          <ArrowRight size={14} />
                        </button>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void ask();
                          }}
                        >
                          <TextField
                            aria-label={t('oddBureau.mystery.questionThisObjectFreely')}
                            placeholder={t('oddBureau.mystery.orAskItDirectly')}
                            maxLength={350}
                            value={question}
                            onChange={(event) => {
                              setQuestion(event.target.value);
                            }}
                            disabled={talking}
                          />
                          <IconButton
                            className="send-key"
                            icon={talking ? <Square size={15} /> : <Send size={17} />}
                            aria-label={
                              talking
                                ? t('oddBureau.mystery.stopQuestioning')
                                : t('oddBureau.mystery.sendQuestion')
                            }
                            type={talking ? 'button' : 'submit'}
                            disabled={!talking && !question.trim()}
                            onClick={talking ? () => operation.current?.abort() : undefined}
                          />
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="case-opening">
                      <div className="opening-symbol">
                        <MessageCircle size={39} />
                      </div>
                      <h2>{t('oddBureau.mystery.theSceneIsYours')}</h2>
                      <p>{session.mystery.opening}</p>
                      <div className="opening-tip">
                        <MousePointer2 size={20} />
                        <span>
                          {t('oddBureau.mystery.clickTheObjectsInThePhoto')}
                          <br />
                          {t('oddBureau.mystery.andHearWhoseStoryDoesnTFit')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="accuse-bar">
                  <span>
                    {t('oddBureau.mystery.collected')}
                    <b>{session.evidence.length}</b> {' / '}
                    {session.props.length} {t('oddBureau.mystery.statements')}
                  </span>
                  <Button
                    className="accuse-key"
                    leadingIcon={<Fingerprint size={17} />}
                    onClick={() => {
                      setAccusing((v) => !v);
                      setConfirmAccusation(null);
                    }}
                    disabled={!canAccuse(session) || busy}
                  >
                    {accusing
                      ? t('oddBureau.mystery.cancelAccusation')
                      : t('oddBureau.mystery.iKnowWhoDidIt')}
                  </Button>
                  {!canAccuse(session) && (
                    <small>
                      {t('oddBureau.mystery.collectTwoStatementsBeforeMakingYourGuess')}
                    </small>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
        {error && (
          <div className="bureau-error" role="alert">
            <div>
              <strong>{t('oddBureau.mystery.thisStepIsNotComplete')}</strong>
              <p>{error}</p>
            </div>
            <IconButton
              icon={<X size={18} />}
              aria-label={t('oddBureau.mystery.hideHints')}
              onClick={() => setError('')}
            />
          </div>
        )}
        <footer className="bureau-footer">
          <span>{t('oddBureau.mystery.objectStoriesAreAiCreatedFiction')}</span>
          <span>{t('oddBureau.mystery.discoverQuestionConnectClues')}</span>
        </footer>
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
const DEMO_IMPLEMENTATION = {
  implementationId: 'demo.local',
  driverId: 'demo',
  driverDialect: 'demo/local/v1',
} as const;
const LOCAL_LABELS = (t: PreviewTranslate): Record<string, string> => ({
  'vision.locate': t('oddBureau.workspace.localVisualLocalization'),
  'text.generate': t('oddBureau.workspace.localTextModel'),
  'audio.synthesize': t('oddBureau.workspace.localSpeechSynthesis'),
});
const CLOUD_LABELS = (t: PreviewTranslate): Record<string, string> => ({
  'vision.locate': t('oddBureau.workspace.cloudVisualLocalization'),
  'text.generate': t('oddBureau.workspace.cloudTextModel'),
  'audio.synthesize': t('oddBureau.workspace.cloudSpeechSynthesis'),
});
const localLoadout = (capability: string, t: PreviewTranslate) => ({
  loadoutRef: `demo-loadout:${capability}`,
  label: LOCAL_LABELS(t)[capability] ?? capability,
  capabilityContract: capability,
  implementation: DEMO_IMPLEMENTATION,
  implementationSupportedFeatures: [],
  configuredFeatures: [],
  textBehaviors: [],
  state: 'ready' as const,
  reasons: [],
});
const cloudConnector = (t: PreviewTranslate) => ({
  connectorRef: DEMO_CLOUD_CONNECTOR_REF,
  label: t('oddBureau.workspace.nimiCloud'),
  provider: 'demo',
  state: 'ready' as const,
  reasons: [],
});
const cloudTarget = (capability: string, t: PreviewTranslate) => ({
  connectorRef: DEMO_CLOUD_CONNECTOR_REF,
  label: CLOUD_LABELS(t)[capability] ?? capability,
  capabilityContract: capability,
  implementation: DEMO_IMPLEMENTATION,
  providerModelTarget: { model: `demo-${capability}` },
  supportedFeatures: [],
  state: 'ready' as const,
  reasons: [],
});
const effectiveSelectionsFor = (
  intents: readonly AIConfigIntent[],
  t: PreviewTranslate,
): EffectiveSelection[] =>
  intents.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    state: 'ready',
    resource:
      intent.route.oneofKind === 'cloud'
        ? {
            oneofKind: 'cloud',
            cloud: {
              connector: cloudConnector(t),
              target: cloudTarget(intent.capabilityContract, t),
            },
          }
        : { oneofKind: 'local', local: localLoadout(intent.capabilityContract, t) },
    reasons: [],
  }));

function Setup({ onBack }: { onBack: () => void }) {
  const { t } = useAppPreviewLocale();
  const [intents, setIntents] = useState<AIConfigIntent[]>(() => [
    {
      capabilityContract: 'vision.locate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    },
    {
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    },
    // 让物品开口 (audio.synthesize) starts unconfigured, as the app's setup copy says it is optional.
  ]);
  const [revision, setRevision] = useState('1');
  const listOptions = useCallback<ListOptions>(async (query): Promise<OptionsResult> => {
    switch (query.kind) {
      case 'cloud-connectors':
        return { kind: 'cloud-connectors', options: [cloudConnector(t)], truncated: false };
      case 'cloud-targets':
        return {
          kind: 'cloud-targets',
          options:
            query.connectorRef === DEMO_CLOUD_CONNECTOR_REF
              ? [cloudTarget(query.capabilityContract, t)]
              : [],
          truncated: false,
        };
      case 'local-loadouts':
        return {
          kind: 'local-loadouts',
          options: [localLoadout(query.capabilityContract, t)],
          truncated: false,
        };
      case 'preset-voices':
        return {
          kind: 'preset-voices',
          options: [
            {
              voiceId: 'demo-voice-zh',
              name: t('oddBureau.setup.tabletopNarrator'),
              supportedLangs: ['zh'],
            },
          ],
          truncated: false,
        };
    }
  }, []);
  const overwrite = useCallback<Overwrite>(
    async (input) => {
      const next = input.capabilities.map((intent) => ({
        ...intent,
        requiredFeatures: [...intent.requiredFeatures],
      }));
      const nextRevision = String(Number(revision) + 1);
      setIntents(next);
      setRevision(nextRevision);
      return { outcome: 'committed', config: { capabilities: next }, revision: nextRevision };
    },
    [revision],
  );
  const configured = ['vision.locate', 'text.generate'].every((id) =>
    intents.some((c) => c.capabilityContract === id),
  );
  return (
    <main className="setup-page" data-density="regular">
      <Button className="quiet-button" leadingIcon={<ArrowLeft size={16} />} onClick={onBack}>
        {t('oddBureau.setup.backToTheScene')}
      </Button>
      <h1>{t('oddBureau.setup.connectAiToThePlayground')}</h1>
      <p>{t('oddBureau.setup.playNeedsObjectDetectionAndPlayCreation')}</p>
      <div className="setup-surface">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId: 'nimi.odd-bureau' }}
          capabilityContracts={CONTRACTS}
          capabilities={intents}
          revision={revision}
          effectiveSelections={effectiveSelectionsFor(intents, t)}
          listOptions={listOptions}
          onOverwrite={overwrite}
          language="zh"
          copy={{
            title: t('oddBureau.setup.oddBureauCapabilities'),
            description: t('oddBureau.setup.chooseCapabilitiesForThisBureauOnlyOther'),
            backLabel: t('oddBureau.setup.backToCapabilityOverview'),
            activeModelLabel: t('oddBureau.setup.modelInUse'),
            activeModelHint: t('oddBureau.setup.chooseALocalOrCloudCapability'),
            detailTitle: (label) => t('oddBureau.settings.capabilityTitle', { capability: label }),
            activeModelConfiguredLabel: t('oddBureau.setup.configured'),
            activeModelSetupPendingLabel: t('oddBureau.setup.needsPreparation'),
            configuredSummary: t('oddBureau.setup.capabilityConfigured'),
            emptySummary: t('oddBureau.setup.noModelSelected'),
            modelPickerTitle: t('oddBureau.setup.chooseCapabilitySource'),
            modelPickerSearchPlaceholder: t('oddBureau.setup.searchModels'),
            modelPickerLoadingLabel: t('oddBureau.setup.loadingModels'),
            modelPickerEmptyLabel: t('oddBureau.setup.noModelsAvailable'),
            configuredLabel: t('oddBureau.setup.configured'),
            notConfiguredLabel: t('oddBureau.setup.notConfigured'),
            localLabel: t('oddBureau.setup.onDevice'),
            cloudLabel: t('oddBureau.setup.cloud'),
            routeLabel: t('oddBureau.setup.capabilitySource'),
            saveLocalLabel: t('oddBureau.setup.useLocalModel'),
            saveCloudLabel: t('oddBureau.setup.useThisCloudModel'),
            savingLabel: t('oddBureau.setup.saving'),
            clearLabel: t('oddBureau.setup.clearThisConfiguration'),
            cancelLabel: t('oddBureau.setup.cancel'),
            confirmSelectionLabel: t('oddBureau.setup.confirmSelection'),
            advancedLabel: t('oddBureau.setup.advancedOptions'),
            advancedHint: t('oddBureau.setup.adjustThisCapabilitySParameters'),
            retryLabel: t('oddBureau.setup.retry'),
            technicalDetailsLabel: t('oddBureau.setup.technicalDetails'),
            defaultsLabel: t('oddBureau.setup.defaultParameters'),
            defaultsPlaceholder: t('oddBureau.setup.leaveBlankToUseModelDefaults'),
            defaultsUnsetLabel: t('oddBureau.setup.notSet'),
            defaultsTrueLabel: t('oddBureau.setup.yes'),
            defaultsFalseLabel: t('oddBureau.setup.no'),
            defaultsListPlaceholder: t('oddBureau.setup.oneItemPerLine'),
            defaultsLocalEffectivePlaceholder: (value) =>
              t('oddBureau.settings.localDefault', { model: value }),
            defaultsCloudEffectivePlaceholder: t('oddBureau.setup.notSetServiceDefault'),
            defaultsRandomValue: t('oddBureau.setup.random'),
            localChoiceDescription: t('oddBureau.setup.useNimiSCurrentlySelectedLocalModel'),
            localSelectedLabel: t('oddBureau.setup.currentLocalSelection'),
            localMissingLabel: t('oddBureau.setup.noLocalModelSelectedForThisCapability'),
            localBrokenLabel: t('oddBureau.setup.theSelectedLocalModelNeedsAttention'),
            localUnavailableLabel: t('oddBureau.setup.couldNotReadLocalModels'),
            localMismatchLabel: (features) =>
              t('oddBureau.settings.unsupportedFeatures', { features: features }),
            openMachineLabel: t('oddBureau.setup.manageLocalModels'),
            cloudConnectorPickerLabel: t('oddBureau.setup.chooseAConnectedService'),
            cloudConnectorPickerPlaceholder: t('oddBureau.setup.chooseAService'),
            cloudNoConnectorsLabel: t('oddBureau.setup.noCloudServicesConnected'),
            cloudConnectorSelectionRequired: t('oddBureau.setup.chooseAConnectedServiceThenAModel'),
            cloudNoticeLabel: t('oddBureau.setup.processInTheCloud'),
            cloudNoticeDescription: t('oddBureau.setup.textIsSentToTheSelectedService'),
            cloudImplementationLabel: t('oddBureau.setup.cloudService'),
            cloudTargetLabel: t('oddBureau.setup.cloudModel'),
            cloudConnectorLabel: t('oddBureau.setup.connectedServices'),
            cloudLoadFailed: t('oddBureau.setup.couldNotReadCloudModelsTryAgain'),
            loadFailed: t('oddBureau.setup.couldNotReadCapabilitySettings'),
            saveFailed: t('oddBureau.setup.capabilitySettingsCouldNotBeSaved'),
            conflictLabel: t('oddBureau.setup.configurationChangedElsewhere'),
            conflictDescription: t('oddBureau.setup.reviewTheLatestConfigurationBeforeSavingYour'),
            clearingLabel: t('oddBureau.setup.clearing'),
            selectionRequiredLabel: t('oddBureau.setup.chooseAModel'),
            blockedLabel: t('oddBureau.setup.needsAttention'),
            unavailableLabel: t('oddBureau.setup.unavailable'),
            mismatchLabel: t('oddBureau.setup.featureMismatch'),
            capabilityLabel: (id) =>
              id === 'vision.locate'
                ? t('oddBureau.setup.seeTheObjects')
                : id === 'text.generate'
                  ? t('oddBureau.setup.createThePlay')
                  : t('oddBureau.setup.giveObjectsAVoice'),
            capabilityDescription: (id) =>
              id === 'vision.locate'
                ? t('oddBureau.setup.requiredIdentifyTheObjectsAndTheir')
                : id === 'text.generate'
                  ? t('oddBureau.setup.requiredCreateDeviceRulesCharacterRequests')
                  : t('oddBureau.setup.optionalReadObjectDialogueAloud'),
          }}
        />
      </div>
      {configured && (
        <Button className="setup-return" trailingIcon={<ArrowRight size={17} />} onClick={onBack}>
          {t('oddBureau.setup.configuredBackToPlay')}
        </Button>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------------ */
/* Playground root (Playground.tsx)                                           */
/* ------------------------------------------------------------------------ */

export function DemoOddBureauPreview({ content }: { content: HeroDemoOddBureauPreview }) {
  useEffect(loadOddBureauFont, []);
  const { t } = useAppPreviewLocale();
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
  useEffect(
    () => () => {
      operation.current?.abort();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const hostOnly = () => notice(content.demo.hostOnly);
  const voice = () => notice(content.demo.voice);
  function settings() {
    if (route !== 'setup') setupBack.current = route;
    setRoute('setup');
  }
  function change(round: PlayRound) {
    if (!save || save.round.kind !== round.kind) return;
    setSave({ ...save, round });
  }
  async function begin() {
    if (busy || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFound([]);
    setError('');
    setStatus(t('oddBureau.begin.identifyingObjectsInThePhoto'));
    try {
      const props: Prop[] = [];
      for (const prop of content.props) {
        await sleep(LOCATE_STEP_MS, controller.signal);
        props.push({ ...prop, box: { ...prop.box } });
        setFound([...props]);
      }
      setStatus(
        kind === 'machine'
          ? t('oddBureau.begin.givingEachObjectAStrangeButConsistent')
          : t('oddBureau.begin.hearingWhyNobodyWantsToWork'),
      );
      await sleep(WRITE_MS, controller.signal);
      const round: PlayRound =
        kind === 'machine'
          ? {
              kind,
              plan: {
                ...content.machine,
                nodes: content.machine.nodes.map((n) => ({ ...n, melody: [...n.melody] })),
              },
              state: initialMachine(),
            }
          : {
              kind,
              plan: {
                ...content.strike,
                people: content.strike.people.map((p) => ({
                  ...p,
                  offers: p.offers.map((o) => ({ ...o })),
                })),
              },
              state: { promises: [], journal: [], performance: null, curtain: 0 },
            };
      setSave({ id: mintId(), props, round });
      setRoute('round');
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e, t));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
        setStatus('');
      }
    }
  }
  const unavailable = busy;
  const screen = route === 'round' && save ? `round-${save.round.kind}` : route;

  return (
    <div
      className="demo-odd-bureau-root"
      data-demo-odd-bureau-root="true"
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-odd-bureau-route={screen}
    >
      <AmbientBackground variant="mesh" className="app-shell" data-testid="nimi-app-shell">
        {noticeText && (
          <div className="demo-odd-bureau-notice" role="status" data-demo-odd-bureau-notice="true">
            <span>{noticeText}</span>
            <button type="button" onClick={() => setNoticeText(null)}>
              {content.demo.dismiss}
            </button>
          </div>
        )}
        {route === 'mystery' ? (
          <Mystery
            content={content}
            onExit={() => setRoute('home')}
            onSettings={settings}
            onVoice={voice}
            onHostOnly={hostOnly}
          />
        ) : (
          <div className="odd-bureau playground" data-density="expressive">
            <header className="bureau-header">
              <button
                type="button"
                className="wordmark"
                onClick={() => setRoute('home')}
                disabled={unavailable}
                aria-label={t('oddBureau.bureauHeader.backToPlaySelection')}
              >
                <Fingerprint size={33} strokeWidth={1.7} />
                <span>
                  {t('oddBureau.bureauHeader.oddBureau')}
                  <span className="wordmark-en">{t('oddBureau.bureauHeader.oddBureau2')}</span>
                </span>
              </button>
              <p className="header-motto">
                {t('oddBureau.bureauHeader.letTheEverydaySurpriseYou')}
              </p>
              <div className="header-actions">
                <button
                  type="button"
                  className="mystery-link"
                  disabled={unavailable}
                  onClick={() => setRoute('mystery')}
                >
                  <Search size={15} />
                  {t('oddBureau.bureauHeader.photoMystery')}
                </button>
                <IconButton
                  className="help-button"
                  icon={<Settings2 size={20} />}
                  aria-label={t('oddBureau.bureauHeader.capabilitySettings')}
                  disabled={unavailable}
                  onClick={settings}
                />
              </div>
            </header>
            {route === 'setup' ? (
              <Setup onBack={() => setRoute(setupBack.current)} />
            ) : route === 'round' && save ? (
              <main className="bureau-main playground-main">
                <div className="play-heading">
                  <div>
                    <span className="activity-name">
                      {save.round.kind === 'machine' ? (
                        <AudioLines size={17} />
                      ) : (
                        <MessageCircle size={17} />
                      )}{' '}
                      {save.round.kind === 'machine'
                        ? t('oddBureau.bureauMain.strangeMachine')
                        : t('oddBureau.bureauMain.strikeNegotiation')}
                    </span>
                    <h1>{save.round.plan.title}</h1>
                    {save.round.kind === 'machine' && <p>{save.round.plan.invitation}</p>}
                  </div>
                  <Button
                    className="quiet-button"
                    leadingIcon={<ArrowLeft size={16} />}
                    onClick={() => setRoute('home')}
                  >
                    {t('oddBureau.bureauMain.changePlayMode')}
                  </Button>
                </div>
                {save.round.kind === 'machine' ? (
                  <MachineGame
                    key={save.id}
                    photo={photo}
                    objects={save.props}
                    round={save.round}
                    onChange={change}
                    markerId={markerId}
                  />
                ) : (
                  <StrikeGame
                    key={save.id}
                    content={content}
                    photo={photo}
                    objects={save.props}
                    round={save.round}
                    onChange={change}
                    onRestart={() => setRoute('home')}
                    onVoice={voice}
                    markerId={markerId}
                  />
                )}
              </main>
            ) : (
              <main className="bureau-main playground-main">
                <div className="intro-line">
                  <div>
                    <h1>
                      {t('oddBureau.bureauMain.thisTable')}
                      <br />
                      {t('oddBureau.bureauMain.has')}
                      <span className="trouble-word">{t('oddBureau.bureauMain.ideas')}</span>
                      {t('oddBureau.bureauMain.label')}
                    </h1>
                    <p>{t('oddBureau.bureauMain.turnNearbyObjectsIntoALittleWorld')}</p>
                  </div>
                  <Sparkles className="lobby-spark" size={36} />
                </div>
                <div className="play-layout playground-lobby">
                  <PhotoStage
                    photo={photo}
                    objects={busy ? found : []}
                    badges={Object.fromEntries(
                      found.map((p) => [p.id, t('oddBureau.bureauMain.found')]),
                    )}
                    instruction={t('oddBureau.home.photoInstruction')}
                    markerId={markerId}
                  >
                    {busy && (
                      <div className="play-preparing" role="status" aria-live="polite">
                        <Fingerprint size={38} />
                        <h2>{status}</h2>
                        <p>
                          {found.length
                            ? t('oddBureau.home.arrivals', {
                                names: found.map((p) => p.label).join('、'),
                              })
                            : t('oddBureau.bureauMain.firstSeeWhoSInThePhoto')}
                        </p>
                        <Button className="cancel-key" onClick={() => operation.current?.abort()}>
                          {t('oddBureau.bureauMain.cancelAndKeepThePhoto')}
                        </Button>
                      </div>
                    )}
                  </PhotoStage>
                  <aside className="activity-panel lobby-panel">
                    <h2>{t('oddBureau.activityPanel.howShallWeCauseTroubleToday')}</h2>
                    <p className="lobby-description">
                      {t('oddBureau.activityPanel.everyObjectHasAbilitiesAndATemperament')}
                      <br />
                      {t('oddBureau.activityPanel.thisTimeYouChangeTheSituation')}
                    </p>
                    <div
                      className="activity-choices"
                      role="group"
                      aria-label={t('oddBureau.activityPanel.chooseAPlayMode')}
                    >
                      <button
                        type="button"
                        className={kind === 'machine' ? 'selected' : ''}
                        aria-pressed={kind === 'machine'}
                        disabled={unavailable}
                        onClick={() => setKind('machine')}
                      >
                        <AudioLines size={26} />
                        <span>
                          <strong>{t('oddBureau.activityPanel.strangeMachine')}</strong>
                          <b>{t('oddBureau.activityPanel.putATickTockInACup')}</b>
                          <small>
                            {t('oddBureau.activityPanel.connectObjectsAndHearYourInvention')}
                          </small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                      <button
                        type="button"
                        className={kind === 'strike' ? 'selected' : ''}
                        aria-pressed={kind === 'strike'}
                        disabled={unavailable}
                        onClick={() => setKind('strike')}
                      >
                        <MessageCircle size={26} />
                        <span>
                          <strong>{t('oddBureau.activityPanel.strikeNegotiation')}</strong>
                          <b>{t('oddBureau.activityPanel.thisTableIsOnStrike')}</b>
                          <small>
                            {t('oddBureau.activityPanel.negotiateMakePromisesAndGetTheStory')}
                          </small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    <div className="lobby-cta">
                      <Button
                        className="primary-key"
                        trailingIcon={<ArrowRight size={19} />}
                        disabled={unavailable}
                        onClick={() => void begin()}
                      >
                        {busy
                          ? t('oddBureau.activityPanel.bringingTheObjectsIntoPlay')
                          : kind === 'machine'
                            ? t('oddBureau.activityPanel.buildAStrangeMachineWithThisPhoto')
                            : t('oddBureau.activityPanel.negotiateAStrikeWithThisPhoto')}
                      </Button>
                      <Button
                        className="upload-key"
                        leadingIcon={<ImagePlus size={17} />}
                        disabled={unavailable}
                        onClick={hostOnly}
                      >
                        {t('oddBureau.activityPanel.useMyOwnPhoto')}
                      </Button>
                      {save && (
                        <button
                          type="button"
                          className="resume-play"
                          disabled={unavailable}
                          onClick={() => setRoute('round')}
                        >
                          {t('oddBureau.activityPanel.continueThePrevious')}
                          {save.round.kind === 'machine'
                            ? t('oddBureau.activityPanel.strangeMachine')
                            : t('oddBureau.activityPanel.storytelling')}
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                    <p className="lobby-footnote">
                      {t('oddBureau.activityPanel.startWithThisSamplePhoto')}
                      <br />
                      {t('oddBureau.activityPanel.yourOwnCupBookAndLampCan')}
                    </p>
                  </aside>
                </div>
              </main>
            )}
            {error && (
              <div className="play-notices">
                <div className="bureau-error" role="alert">
                  <p>{error}</p>
                  <IconButton
                    icon={<X size={17} />}
                    aria-label={t('oddBureau.workspace.hideError')}
                    onClick={() => setError('')}
                  />
                </div>
              </div>
            )}
            <footer className="bureau-footer playground-footer">
              <span>{t('oddBureau.bureauFooter.aPhotoIsTheStageImaginationHas')}</span>
              <span>{t('oddBureau.bureauFooter.poweredByNimi')}</span>
            </footer>
          </div>
        )}
      </AmbientBackground>
    </div>
  );
}
