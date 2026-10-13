import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Compass,
  Feather,
  FileText,
  Footprints,
  GitBranch,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { AmbientBackground, Button } from '@nimiplatform/kit/ui';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigAIConfigSurfaceProps,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import type {
  HeroDemoStorybookChoice,
  HeroDemoStorybookNode,
  HeroDemoStorybookPreview,
  HeroDemoStorybookStory,
} from '../content/landing-content.js';

/**
 * Interactive replica of the Storybook shell (nimiapp-storybook
 * src/storybook/ui): the 218px sidebar, the Play library (发现故事 / 我的足迹),
 * the reader with authored branching, checkpoints, the 我的故事线 journal and
 * the improv talk form, the Studio home + intake, and the settings page. The
 * markup mounts the app's own `sb-*` class names on the stylesheet ported in
 * demo-storybook.css. The authored library and runs are mock data from the
 * landing content; the Runtime-generated in-character replies are scripted.
 */

type Surface = 'play' | 'studio';
type LibraryFilter = 'all' | 'continue';
type PlayView = { screen: 'library'; filter: LibraryFilter } | { screen: 'run'; runId: string };
type StudioView = 'projects' | 'intake';

type TranscriptEntry = {
  seq: number;
  kind: 'enter-node' | 'choice' | 'free-text' | 'source-turn';
  detail: string;
  text?: string;
  nodeId: string;
};

type RunSnapshot = {
  currentNodeId: string;
  status: 'active' | 'ended';
  endingId?: string;
  connection: number;
  transcript: TranscriptEntry[];
};

type Checkpoint = { id: string; label: string; snapshot: RunSnapshot };

type DemoRun = RunSnapshot & {
  id: string;
  storyId: string;
  updatedAt: number;
  checkpoints: Checkpoint[];
  forkedFrom?: { runId: string; nodeId: string };
};

const IMPROV_REPLY_MS = 1400;
const NOTICE_MS = 6_000;
let seed = 0;
const mintId = (prefix: string) => `${prefix}-${(seed += 1).toString(36)}`;

/* ------------------------------------------------------------------------ */
/* Run helpers (mirror engine/run.ts + play-session.ts semantics)            */
/* ------------------------------------------------------------------------ */

function nodeOf(story: HeroDemoStorybookStory, nodeId: string): HeroDemoStorybookNode {
  return story.nodes.find((node) => node.id === nodeId) ?? story.nodes[0]!;
}

function appendEntry(
  transcript: TranscriptEntry[],
  entry: Omit<TranscriptEntry, 'seq'>,
): TranscriptEntry[] {
  return [...transcript, { ...entry, seq: (transcript.at(-1)?.seq ?? 0) + 1 }];
}

function startSnapshot(story: HeroDemoStorybookStory): RunSnapshot {
  const first = story.nodes[0]!;
  return {
    currentNodeId: first.id,
    status: 'active',
    connection: 0,
    transcript: appendEntry([], { kind: 'enter-node', detail: first.title, nodeId: first.id }),
  };
}

function applyChoice(
  story: HeroDemoStorybookStory,
  snapshot: RunSnapshot,
  choice: HeroDemoStorybookChoice,
): RunSnapshot {
  const from = nodeOf(story, snapshot.currentNodeId);
  const target = nodeOf(story, choice.targetNodeId);
  let transcript = appendEntry(snapshot.transcript, {
    kind: 'choice',
    detail: choice.label,
    nodeId: from.id,
  });
  transcript = appendEntry(transcript, {
    kind: 'enter-node',
    detail: target.title,
    nodeId: target.id,
  });
  return {
    currentNodeId: target.id,
    status: target.ending ? 'ended' : 'active',
    endingId: target.ending ? target.id : undefined,
    connection: snapshot.connection + (choice.trust ?? 0),
    transcript,
  };
}

function advance(
  run: DemoRun,
  story: HeroDemoStorybookStory,
  choice: HeroDemoStorybookChoice,
  now: number,
): DemoRun {
  const checkpoint: Checkpoint = {
    id: mintId('checkpoint'),
    label: choice.label,
    snapshot: {
      currentNodeId: run.currentNodeId,
      status: run.status,
      endingId: run.endingId,
      connection: run.connection,
      transcript: run.transcript,
    },
  };
  return {
    ...run,
    ...applyChoice(story, run, choice),
    updatedAt: now,
    checkpoints: [...run.checkpoints, checkpoint],
  };
}

function fork(run: DemoRun, checkpointId: string, now: number): DemoRun | null {
  const index = run.checkpoints.findIndex((point) => point.id === checkpointId);
  const point = run.checkpoints[index];
  if (!point) return null;
  return {
    id: mintId('run'),
    storyId: run.storyId,
    ...point.snapshot,
    updatedAt: now,
    checkpoints: run.checkpoints.slice(0, index),
    forkedFrom: { runId: run.id, nodeId: point.snapshot.currentNodeId },
  };
}

function beginStory(story: HeroDemoStorybookStory, now: number): DemoRun {
  return {
    id: mintId('run'),
    storyId: story.id,
    ...startSnapshot(story),
    updatedAt: now,
    checkpoints: [],
  };
}

function seedRuns(content: HeroDemoStorybookPreview, now: number): DemoRun[] {
  return content.runs.flatMap((seedRun) => {
    const story = content.stories.find((candidate) => candidate.id === seedRun.storyId);
    if (!story) return [];
    let run: DemoRun = { ...beginStory(story, now), id: seedRun.id };
    for (const choiceId of seedRun.path) {
      const choice = nodeOf(story, run.currentNodeId).choices.find(
        (candidate) => candidate.id === choiceId,
      );
      if (choice) run = advance(run, story, choice, now);
    }
    return [{ ...run, updatedAt: now - seedRun.minutesAgo * 60_000 }];
  });
}

function relativeDate(timestamp: number, now: number, locale: string): string {
  const elapsed = now - timestamp;
  if (!Number.isFinite(elapsed)) return '';
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsed < 60_000) return relative.format(0, 'second');
  if (elapsed < 3_600_000) return relative.format(-Math.floor(elapsed / 60_000), 'minute');
  if (elapsed < 86_400_000) return relative.format(-Math.floor(elapsed / 3_600_000), 'hour');
  return new Date(timestamp).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------------ */
/* Root                                                                       */
/* ------------------------------------------------------------------------ */

export function DemoStorybookPreview({ content }: { content: HeroDemoStorybookPreview }) {
  const { pText, pData } = useAppPreviewLocale();
  const [now] = useState(() => Date.now());
  const [surface, setSurface] = useState<Surface>('play');
  const [playView, setPlayView] = useState<PlayView>({ screen: 'library', filter: 'all' });
  const [studioView, setStudioView] = useState<StudioView>('projects');
  const [settings, setSettings] = useState(false);
  const [runs, setRuns] = useState<DemoRun[]>(() => pData((() => seedRuns(content, now))()));
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notice = useCallback((text: string) => {
    setNoticeText(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNoticeText(null), NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const reading = !settings && surface === 'play' && playView.screen === 'run';
  const library = (filter: LibraryFilter) => {
    setSettings(false);
    setSurface('play');
    setPlayView({ screen: 'library', filter });
  };
  const openSettings = () => setSettings(true);
  const openRun = (runId: string) => {
    setSettings(false);
    setSurface('play');
    setPlayView({ screen: 'run', runId });
  };
  const startStory = (story: HeroDemoStorybookStory) => {
    const run = beginStory(story, Date.now());
    setRuns((current) => [run, ...current]);
    openRun(run.id);
  };
  const updateRun = (next: DemoRun) =>
    setRuns((current) => current.map((run) => (run.id === next.id ? next : run)));
  const forkRun = (run: DemoRun, checkpointId: string) => {
    const next = fork(run, checkpointId, Date.now());
    if (!next) return;
    setRuns((current) => [next, ...current]);
    openRun(next.id);
  };

  const navActive = (target: 'all' | 'continue' | 'studio') => {
    if (settings) return false;
    if (target === 'studio') return surface === 'studio';
    return surface === 'play' && playView.screen === 'library' && playView.filter === target;
  };

  return (
    <div
      className="demo-storybook-root"
      data-demo-storybook-root="true"
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-storybook-surface={settings ? 'settings' : surface}
      data-storybook-screen={
        settings ? 'settings' : surface === 'play' ? playView.screen : studioView
      }
    >
      <AmbientBackground variant="mesh" className="app-shell">
        <main className="app-shell__body">
          <div className={`sb-app${reading ? ' sb-app--reading' : ''}`} data-testid="storybook-app">
            {!reading && (
              <aside className="sb-sidebar">
                <button
                  type="button"
                  className="sb-brand"
                  onClick={() => library('all')}
                  aria-label={pText('Storybook 书架')}
                >
                  <BookOpen size={27} strokeWidth={1.6} />
                  <span>
                    {pText('storybook')}
                    <span className="sb-brand-dot">{pText('.')}</span>
                  </span>
                </button>
                <div className="sb-sidebar-label">{pText('你的故事宇宙')}</div>
                <nav className="sb-nav" aria-label={pText('主导航')}>
                  <button
                    type="button"
                    className={navActive('all') ? 'is-active' : ''}
                    data-testid="surface-play"
                    onClick={() => library('all')}
                  >
                    <Compass size={19} />
                    {pText('发现故事')}
                  </button>
                  <button
                    type="button"
                    className={navActive('continue') ? 'is-active' : ''}
                    onClick={() => library('continue')}
                  >
                    <Footprints size={19} />
                    {pText('我的足迹')}
                  </button>
                  <div className="sb-nav-divider" />
                  <button
                    type="button"
                    className={navActive('studio') ? 'is-active' : ''}
                    data-testid="surface-studio"
                    onClick={() => {
                      setSettings(false);
                      setSurface('studio');
                    }}
                  >
                    <Feather size={19} />
                    {pText('创作间')}
                    <span className="sb-nav-note">{pText('Studio')}</span>
                  </button>
                </nav>
                <div className="sb-sidebar-note">
                  <span>{pText('故事没有唯一的读法。')}</span>
                  <p>
                    {pText('你走过的那条路，')}
                    <br />
                    {pText('才是你的故事。')}
                  </p>
                  <BookOpen size={22} strokeWidth={1} />
                </div>
                <div className="sb-sidebar-bottom">
                  <button type="button" className="sb-settings-link" onClick={openSettings}>
                    <Settings2 size={18} />
                    {pText('设置与 AI')}
                    <ArrowUpRight size={14} />
                  </button>
                  <span className="sb-connection">
                    <i className="is-connected" />
                    {pText(content.settings.accountName)}
                    <span>{pText('PRE-ALPHA')}</span>
                  </span>
                </div>
              </aside>
            )}
            <main className="sb-main">
              {settings ? (
                <SettingsPage content={content} onClose={() => setSettings(false)} />
              ) : surface === 'play' ? (
                playView.screen === 'library' ? (
                  <PlayHome
                    content={content}
                    filter={playView.filter}
                    runs={runs}
                    now={now}
                    onStart={startStory}
                    onResume={openRun}
                    onHostOnly={() => notice(content.demo.hostOnly)}
                  />
                ) : (
                  <PlayRun
                    key={playView.runId}
                    content={content}
                    run={runs.find((run) => run.id === playView.runId) ?? null}
                    runs={runs}
                    onUpdate={updateRun}
                    onFork={forkRun}
                    onRestart={startStory}
                    onExit={() => library('all')}
                    onOpenSettings={openSettings}
                  />
                )
              ) : studioView === 'projects' ? (
                <StudioHome
                  content={content}
                  now={now}
                  onNewProject={() => setStudioView('intake')}
                  onHostOnly={() => notice(content.demo.hostOnly)}
                />
              ) : (
                <StudioIntake
                  content={content}
                  onCancel={() => setStudioView('projects')}
                  onHostOnly={() => notice(content.demo.hostOnly)}
                />
              )}
            </main>
          </div>
          {noticeText && (
            <div className="demo-storybook-notice" role="status" data-demo-storybook-notice="true">
              <span>{pText(noticeText)}</span>
              <button type="button" onClick={() => setNoticeText(null)}>
                {pText(content.demo.dismiss)}
              </button>
            </div>
          )}
        </main>
      </AmbientBackground>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Play: library                                                              */
/* ------------------------------------------------------------------------ */

function PlayHome({
  content,
  filter,
  runs,
  now,
  onStart,
  onResume,
  onHostOnly,
}: {
  content: HeroDemoStorybookPreview;
  filter: LibraryFilter;
  runs: DemoRun[];
  now: number;
  onStart: (story: HeroDemoStorybookStory) => void;
  onResume: (runId: string) => void;
  onHostOnly: () => void;
}) {
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [query, setQuery] = useState(() => pData(''));
  const [genre, setGenre] = useState('全部');
  const stories = content.stories;
  const featured = stories[0];
  const storyOf = (run: DemoRun) => stories.find((story) => story.id === run.storyId);
  const activeRuns = runs.filter((run) => run.status === 'active');
  const q = query.trim().toLocaleLowerCase();
  const matchingRuns = (filter === 'continue' ? runs : activeRuns).filter((run) => {
    const story = storyOf(run);
    return (
      story &&
      [story.title, story.subtitle, ...story.cast.map((member) => member.name)]
        .join(' ')
        .toLocaleLowerCase()
        .includes(q)
    );
  });
  const genres = ['全部', ...new Set(stories.flatMap((story) => story.themes.slice(0, 1)))];
  const visible = stories.filter(
    (story) =>
      (genre === '全部' || story.themes.includes(genre)) &&
      `${story.title} ${story.subtitle}`.toLowerCase().includes(query.toLowerCase()),
  );
  const shownRuns = filter === 'continue' ? matchingRuns : matchingRuns.slice(0, 2);

  return (
    <div className="sb-library sb-page">
      <header className="sb-page-top">
        <span className="sb-eyebrow">
          {pText(
            filter === 'continue' ? 'THE PATHS YOU HAVE TAKEN' : 'A LITTLE ESCAPE, A DIFFERENT YOU',
          )}
        </span>
        <div className="sb-library-header-actions">
          <label className="sb-search">
            <Search size={15} />
            <input
              aria-label={pText('搜索角色、世界或作品')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={pText('搜索角色、世界或作品…')}
            />
          </label>
          <button type="button" className="sb-quiet-button" onClick={onHostOnly}>
            <Upload size={15} />
            {pText('导入角色或作品')}
          </button>
        </div>
      </header>
      <div className="sb-page-heading">
        <div>
          <h1>
            {pText(filter === 'continue' ? pText('那些走过的故事。') : pText('下一页，由你决定。'))}
          </h1>
          <p>
            {pText(
              filter === 'continue'
                ? pText('每一个选择，都为你留下了一条独一无二的路。')
                : pText('走进别人的世界，留下自己的故事。'),
            )}
          </p>
        </div>
        {filter === 'all' && (
          <span className="sb-library-count">
            {pText(stories.length.toString().padStart(2, '0'))}{' '}
            <span>{pText('个等待发生的世界')}</span>
          </span>
        )}
      </div>
      {filter === 'all' && (
        <section className="sb-import-invitation">
          <div>
            <span className="sb-eyebrow">{pText('YOUR CHARACTERS. YOUR WORLDS.')}</span>
            <h2>{pText('一张角色卡，就能开启新的可能。')}</h2>
            <p>{pText('带来喜欢的角色、世界资料，或一整套自己编排的体验。')}</p>
          </div>
          <button type="button" className="sb-primary" onClick={onHostOnly}>
            <Upload size={17} />
            {pText('带一个世界进来')}
          </button>
        </section>
      )}
      {filter === 'all' && featured && (
        <section className="sb-featured" style={{ backgroundImage: `url(${featured.cover})` }}>
          <div className="sb-featured-shade" />
          <div className="sb-featured-copy">
            <span className="sb-featured-kicker">
              <span />
              {pText('从这里开始 · STORY NO. 01')}
            </span>
            <div className="sb-featured-genre">{pText(featured.themes.join(' / '))}</div>
            <h2>{pText(featured.title)}</h2>
            <p>{pText(featured.subtitle)}</p>
            <div className="sb-featured-meta">
              <span>
                <BookOpen size={14} />
                {pText(featured.nodes.length)} {pText(' 个场景')}
              </span>
              <span>
                <GitBranch size={14} />
                {pText(featured.endings.length)} {pText(' 种结局')}
              </span>
            </div>
            <button
              type="button"
              className="sb-primary sb-primary--cream"
              onClick={() => onStart(featured)}
            >
              {pText('翻开故事')}
              <ArrowRight size={17} />
            </button>
          </div>
          <span className="sb-featured-caption">{pText(featured.role)}</span>
        </section>
      )}
      {(filter === 'continue' || activeRuns.length > 0) && (
        <section className="sb-footprints">
          <div className="sb-section-title">
            <h2>{pText(filter === 'continue' ? pText('你的故事足迹') : pText('故事还在等你'))}</h2>
            <span>
              {pText(
                filter === 'continue' ? `${matchingRuns.length} 段经历` : pText('接着上一次的选择'),
              )}
            </span>
          </div>
          {shownRuns.map((run) => {
            const story = storyOf(run);
            if (!story) return null;
            const node = nodeOf(story, run.currentNodeId);
            return (
              <button
                type="button"
                className="sb-resume"
                key={run.id}
                onClick={() => onResume(run.id)}
              >
                <img src={story.cover} alt={pText('')} />
                <span>
                  <strong>{pText(story.title)}</strong>
                  <small>
                    {pText(node.title)}
                    {pText(run.forkedFrom ? pText(' · 另一条路') : '')}
                  </small>
                </span>
                <span className="sb-resume-time">
                  {pText(relativeDate(run.updatedAt, now, previewLang))}
                </span>
                <span className="sb-resume-action">
                  {pText(run.status === 'ended' ? pText('回看结局') : pText('继续故事'))}
                  <ArrowRight size={16} />
                </span>
              </button>
            );
          })}
          {filter === 'continue' && q && runs.length > 0 && matchingRuns.length === 0 && (
            <p className="sb-muted" role="status">
              {pText('没有匹配的故事经历，换个名称试试。')}
            </p>
          )}
        </section>
      )}
      {filter === 'all' && (
        <section>
          <div className="sb-section-title">
            <h2>{pText('挑一个世界，暂住片刻')}</h2>
            <span>{pText('精选原创')}</span>
          </div>
          <div className="sb-library-tools">
            <div className="sb-filter-row" aria-label={pText('故事题材')}>
              {genres.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => setGenre(item)}
                  className={genre === item ? 'is-active' : ''}
                  aria-pressed={genre === item}
                >
                  {pText(item === '全部' ? pText('全部故事') : item)}
                </button>
              ))}
            </div>
          </div>
          <div className="sb-book-grid">
            {visible.map((story, index) => (
              <button
                type="button"
                className="sb-book"
                key={story.id}
                onClick={() => onStart(story)}
              >
                <div className={`sb-book-art sb-book-art--${index % 3}`}>
                  <img src={story.cover} alt={pText('')} />
                  <span className="sb-book-origin">{pText('STORYBOOK ORIGINAL')}</span>
                  <span className="sb-book-open">
                    <ArrowRight size={18} />
                  </span>
                </div>
                <div className="sb-book-body">
                  <div className="sb-book-themes">{pText(story.themes.join(' · '))}</div>
                  <h3>{pText(story.title)}</h3>
                  <p>{pText(story.subtitle)}</p>
                  <div className="sb-book-footer">
                    <span>
                      <GitBranch size={13} />
                      {pText(story.endings.length)} {pText(' 种结局')}
                    </span>
                    <span>{pText(story.role)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {visible.length === 0 && (
            <div className="sb-empty">
              <Search size={24} />
              <p>{pText('还没有找到这个故事，换一个词试试。')}</p>
            </div>
          )}
        </section>
      )}
      <footer className="sb-page-footer">
        <BookOpen size={14} />
        <span>{pText('你带来的世界，会因你的参与而不同。')}</span>
        <span>{pText('POWERED BY NIMI')}</span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Play: reader                                                               */
/* ------------------------------------------------------------------------ */

function PlayRun({
  content,
  run,
  runs,
  onUpdate,
  onFork,
  onRestart,
  onExit,
  onOpenSettings,
}: {
  content: HeroDemoStorybookPreview;
  run: DemoRun | null;
  runs: DemoRun[];
  onUpdate: (run: DemoRun) => void;
  onFork: (run: DemoRun, checkpointId: string) => void;
  onRestart: (story: HeroDemoStorybookStory) => void;
  onExit: () => void;
  onOpenSettings: () => void;
}) {
  const { pText, pData } = useAppPreviewLocale();
  const [freeText, setFreeText] = useState(() => pData(''));
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [talk, setTalk] = useState(false);
  const [fontSize, setFontSize] = useState(19);
  const [night, setNight] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const journal = useRef<HTMLDialogElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyIndex = useRef(0);
  const story = run
    ? (content.stories.find((candidate) => candidate.id === run.storyId) ?? null)
    : null;
  const node = run && story ? nodeOf(story, run.currentNodeId) : null;

  useEffect(() => {
    storyRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, [run?.currentNodeId]);
  useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    },
    [],
  );

  if (!run || !story || !node) {
    return (
      <div className="sb-page sb-empty">
        <BookOpen size={30} />
        <h2>{pText('这本故事暂时无法打开。')}</h2>
        <p>{pText('进度仍保存在本机，请重新导入完整故事文件。')}</p>
        <button type="button" className="sb-primary" onClick={onExit}>
          {pText('返回书架')}
        </button>
      </div>
    );
  }

  const choices = node.choices;
  const checkpoints = run.checkpoints;
  const currentTurnStart =
    run.transcript
      .slice()
      .reverse()
      .find((entry) => entry.kind === 'enter-node')?.seq ?? 0;
  const conversation = run.transcript.filter(
    (entry) =>
      entry.seq > currentTurnStart && (entry.kind === 'source-turn' || entry.kind === 'free-text'),
  );
  const ended = run.status === 'ended';
  const discovered = new Set(
    runs
      .filter((other) => other.storyId === run.storyId && other.status === 'ended')
      .map((other) => other.endingId),
  );
  const endingCount = story.endings.length;
  const progress = ended
    ? 100
    : Math.min(
        100,
        Math.round(
          (new Set(
            run.transcript
              .filter((entry) => entry.kind === 'enter-node')
              .map((entry) => entry.nodeId),
          ).size /
            story.nodes.length) *
            100,
        ),
      );

  function choose(choice: HeroDemoStorybookChoice) {
    if (busy) return;
    onUpdate(advance(run!, story!, choice, Date.now()));
    setNoticeText(null);
    setFreeText('');
    setTalk(false);
  }

  function sendFreeText() {
    const text = freeText.trim();
    if (!text || busy || ended) return;
    const speaker = node!.speaker || '故事的回应';
    const nodeId = node!.id;
    const withQuestion: DemoRun = {
      ...run!,
      updatedAt: Date.now(),
      transcript: appendEntry(run!.transcript, { kind: 'free-text', detail: '你', text, nodeId }),
    };
    onUpdate(withQuestion);
    setFreeText('');
    setNoticeText(null);
    setBusy(true);
    const reply = content.improvReplies[replyIndex.current % content.improvReplies.length] ?? '';
    replyIndex.current += 1;
    replyTimer.current = setTimeout(() => {
      onUpdate({
        ...withQuestion,
        updatedAt: Date.now(),
        transcript: appendEntry(withQuestion.transcript, {
          kind: 'source-turn',
          detail: speaker,
          text: reply,
          nodeId,
        }),
      });
      setBusy(false);
    }, IMPROV_REPLY_MS);
  }

  return (
    <div className={`sb-reader${night ? ' sb-reader--night' : ''}`}>
      <header className="sb-reader-bar">
        <button type="button" className="sb-quiet-button" onClick={onExit} disabled={busy}>
          <ArrowLeft size={17} />
          {pText('返回书架')}
        </button>
        <span className="sb-reader-book">
          <BookOpen size={16} />
          {pText(story.title)}
        </span>
        <div className="sb-reader-tools">
          <button
            type="button"
            className="sb-quiet-button"
            aria-expanded={showReading}
            onClick={() => setShowReading(!showReading)}
            aria-label={pText('阅读设置')}
          >
            {pText('Aa')}
          </button>
          <button
            type="button"
            className="sb-quiet-button"
            onClick={() => journal.current?.showModal()}
          >
            <GitBranch size={17} />
            <span>{pText('我的故事线')}</span>
            <span className="sb-count">{pText(checkpoints.length)}</span>
          </button>
        </div>
      </header>
      {showReading && (
        <div className="sb-reading-options">
          <span>{pText('字号')}</span>
          <button
            type="button"
            onClick={() => setFontSize(Math.max(16, fontSize - 1))}
            disabled={fontSize <= 16}
            aria-label={pText('缩小字号')}
          >
            {pText('A−')}
          </button>
          <span>{pText(fontSize)}</span>
          <button
            type="button"
            onClick={() => setFontSize(Math.min(25, fontSize + 1))}
            disabled={fontSize >= 25}
            aria-label={pText('放大字号')}
          >
            {pText('A+')}
          </button>
          <button type="button" aria-pressed={night} onClick={() => setNight(!night)}>
            {pText(night ? pText('切换日间') : pText('切换夜读'))}
          </button>
        </div>
      )}
      <div className="sb-reader-progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="sb-reader-layout">
        <aside className="sb-story-aside">
          <img src={story.cover} alt={pText('')} />
          <span className="sb-eyebrow">
            {pText(ended ? 'THE END, FOR NOW' : 'YOU ARE IN THE STORY')}
          </span>
          <h2>{pText(story.title)}</h2>
          <p>{pText(story.role)}</p>
          <div className="sb-story-tags">
            {story.themes.map((theme) => (
              <span key={theme}>{pText(theme)}</span>
            ))}
          </div>
          <div className="sb-state-card">
            <small>{pText('你留下的影响')}</small>
            <div>
              <span>{pText('与他人的联结')}</span>
              <strong>
                {pText(run.connection > 0 ? '+' : '')}
                {pText(run.connection)}
              </strong>
            </div>
            <p>
              <Check size={13} />
              {pText('进度已自动保存')}
            </p>
          </div>
        </aside>
        <article className="sb-story-paper" ref={storyRef} key={node.id}>
          <div className="sb-scene-meta">
            <span>
              {pText(
                ended
                  ? pText('属于你的结局')
                  : `第 ${String(checkpoints.length + 1).padStart(2, '0')} 幕`,
              )}
            </span>
            <span>
              {pText(
                ended
                  ? pText('这一页，写下了你的选择')
                  : node.speaker
                    ? `${node.speaker} 在场`
                    : pText('故事正在发生'),
              )}
            </span>
          </div>
          <h1>{pText(node.title)}</h1>
          <div className="sb-story-prose" style={{ fontSize }}>
            {node.text
              .split(/\n+/)
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index}>{pText(paragraph)}</p>
              ))}
          </div>
          {conversation.length > 0 && (
            <div className="sb-conversation">
              {conversation.map((entry) => (
                <div
                  key={entry.seq}
                  className={
                    entry.kind === 'free-text' ? 'sb-conversation-you' : 'sb-conversation-reply'
                  }
                >
                  <small>
                    {pText(entry.kind === 'free-text' ? pText('你轻声说') : entry.detail)}
                  </small>
                  <p>{entry.text}</p>
                </div>
              ))}
            </div>
          )}
          {ended ? (
            <div className="sb-ending">
              <span className="sb-ending-ornament">
                <GitBranch size={24} strokeWidth={1} />
              </span>
              <h2>{pText('这是你选择的故事。')}</h2>
              <p>
                {pText('你已抵达 ')}
                {pText(discovered.size)} {pText(' / ')}
                {pText(endingCount)} {pText(' 种结局。另一条路，会带你去哪里？')}
              </p>
              <div className="sb-ending-path">
                {run.transcript
                  .filter((entry) => entry.kind === 'choice')
                  .map((entry) => (
                    <span key={entry.seq}>{pText(entry.detail)}</span>
                  ))}
              </div>
              <div className="sb-actions">
                <button
                  type="button"
                  className="sb-primary"
                  onClick={() => journal.current?.showModal()}
                  disabled={!checkpoints.length}
                >
                  <GitBranch size={16} />
                  {pText('回到某个岔路')}
                </button>
                <button type="button" className="sb-quiet-button" onClick={() => onRestart(story)}>
                  <RotateCcw size={15} />
                  {pText('重新开始')}
                </button>
              </div>
            </div>
          ) : (
            <div className="sb-next">
              <div className="sb-choice-heading">
                <span>{pText('接下来，你会怎么做？')}</span>
                <small>{pText('选择，让故事发生')}</small>
              </div>
              <div className="sb-choices" data-testid="play-choices">
                {choices.map((choice, index) => (
                  <button
                    type="button"
                    key={choice.id}
                    className="sb-choice-btn"
                    disabled={busy}
                    onClick={() => choose(choice)}
                  >
                    <span className="sb-choice-number">
                      {pText(String(index + 1).padStart(2, '0'))}
                    </span>
                    <span>{pText(choice.label)}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
              <div className="sb-improv">
                <button
                  type="button"
                  className="sb-improv-toggle"
                  aria-expanded={talk}
                  onClick={() => setTalk(!talk)}
                >
                  <MessageCircle size={16} />
                  {pText('我想说点别的')}
                  <span>{pText('AI 即兴对话')}</span>
                  <ChevronDown size={15} />
                </button>
                {talk && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendFreeText();
                    }}
                  >
                    <label className="sb-sr-only" htmlFor="sb-freetext-input">
                      {pText('你想说的话')}
                    </label>
                    <textarea
                      id="sb-freetext-input"
                      maxLength={600}
                      value={freeText}
                      disabled={busy}
                      onChange={(event) => {
                        setFreeText(event.target.value);
                      }}
                      placeholder={pText('问一个选项里没有的问题，或者说句心里话…')}
                    />
                    <div>
                      <small>{pText('角色会回应你。故事仍由上方的选择推进。')}</small>
                      <button
                        type="submit"
                        aria-label={pText('发送对话')}
                        disabled={busy || !freeText.trim()}
                      >
                        {busy ? <Sparkles className="sb-pulse" size={18} /> : <Send size={18} />}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
          {busy && (
            <p role="status" className="sb-ai-wait">
              <Sparkles size={15} />
              {pText('故事里的人正在回应你…')}
            </p>
          )}
          {noticeText && (
            <div role="alert" className="sb-notice">
              <p>{pText(noticeText)}</p>
              <button type="button" className="sb-quiet-button" onClick={onOpenSettings}>
                <Settings2 size={14} />
                {pText('检查 AI 连接')}
              </button>
            </div>
          )}
          <footer className="sb-reader-note">
            {pText(
              ended
                ? pText('有些故事结束了，但留在心里的还在继续。')
                : pText('不必急。这个世界，会等你做出选择。'),
            )}
          </footer>
        </article>
      </div>
      <dialog
        ref={journal}
        className="sb-dialog sb-journal"
        onClick={(event) => {
          if (event.target === journal.current) journal.current.close();
        }}
      >
        <div className="sb-dialog-heading">
          <div>
            <span className="sb-eyebrow">{pText('EVERY CHOICE LEAVES A TRACE')}</span>
            <h2>{pText('我的故事线')}</h2>
          </div>
          <button
            type="button"
            className="sb-icon-button"
            aria-label={pText('关闭故事线')}
            onClick={() => journal.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className="sb-muted">
          {pText('回到某个选择，走一条新的路。原来的经历会留在「我的足迹」。')}
        </p>
        <div className="sb-timeline">
          {checkpoints.map((point, index) => (
            <div className="sb-timeline-step" key={point.id}>
              <span className="sb-timeline-dot">{pText(index + 1)}</span>
              <div>
                <small>{pText(nodeOf(story, point.snapshot.currentNodeId).title)}</small>
                <p>{pText(point.label)}</p>
                <button
                  type="button"
                  className="sb-quiet-button"
                  disabled={busy}
                  onClick={() => {
                    journal.current?.close();
                    onFork(run, point.id);
                  }}
                >
                  {pText('从这里走另一条路')}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ))}
          <div className="sb-timeline-step">
            <span className="sb-timeline-dot is-current">
              <BookOpen size={14} />
            </span>
            <div>
              <small>{pText('你在这里')}</small>
              <p>{pText(node.title)}</p>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Studio                                                                     */
/* ------------------------------------------------------------------------ */

function StudioHome({
  content,
  now,
  onNewProject,
  onHostOnly,
}: {
  content: HeroDemoStorybookPreview;
  now: number;
  onNewProject: () => void;
  onHostOnly: () => void;
}) {
  const { pText, previewLang } = useAppPreviewLocale();
  const project = content.studioProject;
  return (
    <div className="sb-page sb-studio-home">
      <header className="sb-page-top">
        <span className="sb-eyebrow">{pText('THE AUTHOR IN YOU')}</span>
        <span className="sb-muted">{pText('STUDIO')}</span>
      </header>
      <div className="sb-page-heading">
        <div>
          <h1>{pText('让想象，长出一个世界。')}</h1>
          <p>{pText('这里是你的创作间。一个念头，也能成为一场值得亲历的故事。')}</p>
        </div>
      </div>
      <section className="sb-studio-invite">
        <div>
          <span className="sb-eyebrow">{pText('YOUR WORDS. THEIR WORLD.')}</span>
          <h2>
            {pText('故事由你开始。')}
            <br />
            {pText('剩下的，我们一起想象。')}
          </h2>
          <p>
            {pText('带来角色、世界和想法，编排属于你的体验，')}
            <br />
            {pText('让每一次相遇，都有不同的可能。')}
          </p>
          <button type="button" className="sb-primary" onClick={onHostOnly}>
            <Plus size={18} />
            {pText('新建体验作品')}
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="sb-quiet-button sb-studio-secondary"
            onClick={onNewProject}
          >
            <FileText size={16} />
            {pText('从叙事文本改编')}
          </button>
        </div>
        <div className="sb-studio-art">
          <img src="/demo/storybook/garden.jpg" alt={pText('雨夜中亮着温暖灯光的故事小店')} />
          <span>
            <Feather size={16} />
            {pText('有些世界，还在等你写下第一句。')}
          </span>
        </div>
      </section>
      <div className="sb-section-title">
        <h2>{pText('我的创作')}</h2>
        <span>{pText('1 个故事')}</span>
      </div>
      <div className="sb-project-list">
        <button type="button" onClick={onHostOnly}>
          <span className="sb-project-icon">
            <BookOpen size={23} strokeWidth={1.3} />
          </span>
          <div>
            <h3>{pText(project.name)}</h3>
            <p>{pText(project.premise)}</p>
          </div>
          <span className="sb-status">{pText(project.status)}</span>
          <small>{pText(relativeDate(now - project.minutesAgo * 60_000, now, previewLang))}</small>
          <ArrowRight size={17} />
        </button>
      </div>
      <footer className="sb-page-footer">
        <Feather size={14} />
        <span>{pText('不需要懂代码。只需要有一个想讲的故事。')}</span>
      </footer>
    </div>
  );
}

function StudioIntake({
  content,
  onCancel,
  onHostOnly,
}: {
  content: HeroDemoStorybookPreview;
  onCancel: () => void;
  onHostOnly: () => void;
}) {
  const { pText, pData } = useAppPreviewLocale();
  const [name, setName] = useState(() => pData(''));
  const [text, setText] = useState(() => pData(''));
  const [direction, setDirection] = useState<string | null>(null);
  const saved = text.length > 0 || name.length > 0;
  return (
    <div className="sb-page sb-intake">
      <header className="sb-page-top">
        <button type="button" className="sb-quiet-button" onClick={onCancel}>
          <ArrowLeft size={16} />
          {pText('回到创作间')}
        </button>
        <span className="sb-eyebrow">{pText('FROM WORDS TO WORLDS')}</span>
      </header>
      <div className="sb-intake-heading">
        <span className="sb-intake-icon">
          <Feather size={26} strokeWidth={1.4} />
        </span>
        <h1>{pText('每个故事，都有另一种可能。')}</h1>
        <p>{pText('给我一段文字。我们一起把它变成一个可以走进去的世界。')}</p>
      </div>
      <div className="sb-intake-workspace">
        <section className="sb-writing-paper">
          <div className="sb-writing-top">
            <label htmlFor="sb-name" className="sb-sr-only">
              {pText('故事名称（可选）')}
            </label>
            <input
              id="sb-name"
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder={pText('给故事起个名字，也可以晚点再想')}
            />
            <button type="button" className="sb-quiet-button" onClick={onHostOnly}>
              <Upload size={14} />
              {pText('导入文字')}
            </button>
          </div>
          <label htmlFor="sb-text" className="sb-sr-only">
            {pText('故事原文')}
          </label>
          <textarea
            id="sb-text"
            value={text}
            maxLength={8000}
            onChange={(event) => {
              setText(event.target.value);
            }}
            placeholder={pText(
              '粘贴一篇短篇、一段你喜欢的文字，\n或者，只是一个突然冒出来的念头。\n\n那天，事情本来不应该这样发生……',
            )}
          />
          <div className="sb-writing-footer">
            <span>
              <FileText size={13} />
              {pText(saved ? pText('草稿已保存在本机') : pText('输入后自动保存到本机'))}
            </span>
            <span>
              {text.length.toLocaleString()} {pText(' / 8,000 字')}
            </span>
          </div>
        </section>
        <aside className="sb-intake-aside">
          <span className="sb-eyebrow">{pText('A LITTLE DIRECTION')}</span>
          <h3>{pText('想让故事往哪里走？')}</h3>
          <p>{pText('保留故事的灵魂，给体验一点方向。')}</p>
          <div className="sb-directions">
            {content.intakeDirections.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={direction === item}
                className={direction === item ? 'is-active' : ''}
                onClick={() => setDirection(item)}
              >
                {pText(item)}
              </button>
            ))}
          </div>
          <div className="sb-creation-steps">
            <div>
              <span>{pText('01')}</span>
              <p>
                <strong>{pText('读懂故事')}</strong>
                <small>{pText('提炼世界、人物与隐藏的冲突')}</small>
              </p>
            </div>
            <div>
              <span>{pText('02')}</span>
              <p>
                <strong>{pText('一起定方向')}</strong>
                <small>{pText('看一眼 AI 的提案，由你拍板')}</small>
              </p>
            </div>
            <div>
              <span>{pText('03')}</span>
              <p>
                <strong>{pText('让选择发生')}</strong>
                <small>{pText('编排分支与结局，亲自走进去')}</small>
              </p>
            </div>
          </div>
        </aside>
      </div>
      <div className="sb-intake-submit">
        <span>{pText('还没想好？从一个灵感开始')}</span>
        <button
          type="button"
          className="sb-primary"
          disabled={!text.trim()}
          onClick={onHostOnly}
          data-testid="studio-intake-submit"
        >
          <Sparkles size={17} />
          {pText('让故事开始生长')}
          <ArrowRight size={17} />
        </button>
      </div>
      <div className="sb-seed-grid">
        {content.intakeSeeds.map((item) => (
          <button
            type="button"
            key={item.label}
            onClick={() => {
              setText(item.text);
              setName(item.label);
            }}
          >
            <span>{pText(item.label)}</span>
            <p>{pText(item.text)}</p>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Settings (SessionSettings + StorybookAiModelConfigSection)                */
/* ------------------------------------------------------------------------ */

type SurfaceProps = ModelConfigAIConfigSurfaceProps;
type AIConfigIntent = NonNullable<SurfaceProps['capabilities']>[number];
type EffectiveSelection = NonNullable<SurfaceProps['effectiveSelections']>[number];
type ListOptions = NonNullable<SurfaceProps['listOptions']>;
type OptionsResult = Awaited<ReturnType<ListOptions>>;
type Overwrite = NonNullable<SurfaceProps['onOverwrite']>;

const TEXT_GENERATE = 'text.generate';
const DEMO_CLOUD_CONNECTOR_REF = 'demo-connector:storybook';
const DEMO_IMPLEMENTATION = {
  implementationId: 'demo-implementation',
  driverId: 'demo-driver',
  driverDialect: 'demo',
} as const;

// Mirrors nimiapp-storybook src/shell/ai/model-config-copy.ts.
const STORYBOOK_MODEL_CONFIG_COPY: ModelConfigCopy = {
  title: 'AI 模型',
  description: '为故事改编和角色对话选择 AI。',
  backLabel: '返回',
  activeModelLabel: '当前配置',
  activeModelHint: '选择故事创作使用的模型',
  activeModelConfiguredLabel: '已配置',
  activeModelSetupPendingLabel: '待配置',
  modelPickerTitle: '选择 Runtime 路由',
  modelPickerSearchPlaceholder: '搜索',
  modelPickerLoadingLabel: '正在加载…',
  modelPickerEmptyLabel: '没有可用选项',
  configuredSummary: '已保存 Runtime 路由意图。',
  emptySummary: '尚未配置文本生成。',
  routeLabel: '路由',
  localLabel: '本地',
  cloudLabel: '云端',
  saveLocalLabel: '使用本地 Runtime',
  saveCloudLabel: '保存云端意图',
  savingLabel: '正在保存…',
  advancedLabel: '高级意图',
  advancedHint: '这些值是可移植请求意图，不指定 provider 或 model。',
  requiredFeaturesLabel: '必需功能',
  requiredFeaturesPlaceholder: '每行一个',
  defaultsLabel: '生成默认值',
  defaultsPlaceholder: '{"temperature":0.7,"topP":1,"maxTokens":1024}',
  localChoiceDescription: 'Runtime 在执行时验证本机选择。',
  localSelectedLabel: '已选择本地 Runtime 意图',
  localMissingLabel: '需要在 Nimi 中配置本机模型',
  localBrokenLabel: '本机模型配置不可用',
  localUnavailableLabel: '当前无法读取本机模型配置',
  openMachineLabel: '在 Nimi 中配置',
  loadFailed: '无法读取 AI 配置。',
  saveFailed: '无法保存 AI 配置。',
  retryLabel: '重试',
  technicalDetailsLabel: '技术详情',
  unsupportedCapabilityLabel: '不支持的能力',
  notConfiguredLabel: '未配置',
  configuredLabel: '已配置',
  selectionRequiredLabel: '需要配置',
  blockedLabel: '受阻',
  mismatchLabel: '功能不匹配',
  cancelLabel: '取消',
  confirmSelectionLabel: '确认选择',
  capabilityLabel: (capabilityContract, fallback) =>
    capabilityContract === TEXT_GENERATE ? '叙事文本生成' : fallback,
  capabilityDescription: (capabilityContract, fallback) =>
    capabilityContract === TEXT_GENERATE ? '用于故事改编、分支编排和角色即兴对话。' : fallback,
};

function localLoadout(content: HeroDemoStorybookPreview) {
  return {
    loadoutRef: `demo-loadout:${TEXT_GENERATE}`,
    label: `${content.settings.modelLabel} · 本机`,
    capabilityContract: TEXT_GENERATE,
    implementation: DEMO_IMPLEMENTATION,
    implementationSupportedFeatures: [],
    configuredFeatures: [],
    textBehaviors: [],
    state: 'ready' as const,
    reasons: [],
  };
}

function cloudConnector() {
  return {
    connectorRef: DEMO_CLOUD_CONNECTOR_REF,
    label: 'Nimi Cloud',
    provider: 'demo',
    state: 'ready' as const,
    reasons: [],
  };
}

function cloudTarget(content: HeroDemoStorybookPreview) {
  return {
    connectorRef: DEMO_CLOUD_CONNECTOR_REF,
    label: `${content.settings.modelLabel} · 云端`,
    capabilityContract: TEXT_GENERATE,
    implementation: DEMO_IMPLEMENTATION,
    providerModelTarget: { model: 'demo-text-generate' },
    supportedFeatures: [],
    state: 'ready' as const,
    reasons: [],
  };
}

function effectiveSelectionsFor(
  intents: readonly AIConfigIntent[],
  content: HeroDemoStorybookPreview,
): EffectiveSelection[] {
  return intents.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    state: 'ready',
    resource:
      intent.route.oneofKind === 'cloud'
        ? {
            oneofKind: 'cloud',
            cloud: { connector: cloudConnector(), target: cloudTarget(content) },
          }
        : { oneofKind: 'local', local: localLoadout(content) },
    reasons: [],
  }));
}

function SettingsPage({
  content,
  onClose,
}: {
  content: HeroDemoStorybookPreview;
  onClose: () => void;
}) {
  const { pText, pData } = useAppPreviewLocale();
  const [intents, setIntents] = useState<AIConfigIntent[]>(() => [
    {
      capabilityContract: TEXT_GENERATE,
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    },
  ]);
  const [revision, setRevision] = useState('1');
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    },
    [],
  );

  const listOptions = useCallback<ListOptions>(
    async (query): Promise<OptionsResult> => {
      switch (query.kind) {
        case 'cloud-connectors':
          return { kind: 'cloud-connectors', options: [cloudConnector()], truncated: false };
        case 'cloud-targets':
          return {
            kind: 'cloud-targets',
            options: query.connectorRef === DEMO_CLOUD_CONNECTOR_REF ? [cloudTarget(content)] : [],
            truncated: false,
          };
        case 'local-loadouts':
          return { kind: 'local-loadouts', options: [localLoadout(content)], truncated: false };
        case 'preset-voices':
          return { kind: 'preset-voices', options: [], truncated: false };
      }
    },
    [content],
  );

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

  const recheck = () => {
    setChecking(true);
    checkTimer.current = setTimeout(() => setChecking(false), 900);
  };

  return (
    <div className="sb-page sb-settings-page">
      <div className="sb-dialog-heading">
        <div>
          <span className="sb-eyebrow">{pText('MAKE ROOM FOR IMAGINATION')}</span>
          <h2>{pText('设置与 AI')}</h2>
        </div>
        <button
          type="button"
          className="sb-icon-button"
          aria-label={pText('关闭设置')}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <section className="sb-session-card">
        <div>
          <span className="sb-connection-dot is-connected" />
          {pText('已连接 Nimi')}
        </div>
        <p>{pText(content.settings.accountNote)}</p>
        <Button tone="secondary" size="sm" loading={checking} onClick={recheck}>
          {pText('重新检查连接')}
        </Button>
      </section>
      <section id="storybook-ai-model-config" className="sb-ai-model-config" tabIndex={-1}>
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId: 'nimi.storybook' }}
          capabilityContracts={[TEXT_GENERATE]}
          capabilities={intents}
          revision={revision}
          effectiveSelections={effectiveSelectionsFor(intents, content)}
          listOptions={listOptions}
          onOverwrite={overwrite}
          copy={pData(STORYBOOK_MODEL_CONFIG_COPY)}
          className="sb-ai-model-config__hub"
          headerSlot={
            <p className="sb-ai-model-config__posture">
              {pText('配置由 Runtime 保存；Storybook 不持有 provider、model 或凭据。')}
            </p>
          }
        />
      </section>
    </div>
  );
}
