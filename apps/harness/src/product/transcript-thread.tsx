import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat';
import { Button } from '@nimiplatform/kit/ui';
import {
  AlertCircle,
  ArrowDown,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  FileEdit,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  MessageSquareText,
  Plug,
  RotateCcw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../i18n.js';
import type { HarnessToolCall, HarnessView } from './harness-types.js';
import {
  groupTranscriptItems,
  parseToolCallOutcome,
  type AssistantStepItem,
  type TranscriptRenderGroup,
} from './transcript-format.js';

function toolIcon(name: string) {
  switch (name) {
    case 'read': return FileText;
    case 'write': return FilePlus;
    case 'edit': return FileEdit;
    case 'bash':
    case 'powershell': return Terminal;
    case 'glob':
    case 'grep': return Search;
    case 'web_fetch': return Globe;
    case 'find_nimi_reads':
    case 'find_nimi_integrations':
    case 'read_nimi_integration':
    case 'invoke_nimi_integration':
    case 'read_nimi_receipt': return Plug;
    default: return Wrench;
  }
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (typeof args.path === 'string' && args.path) return args.path;
  if (typeof args.command === 'string' && args.command) {
    const first = args.command.trim().split(/\r?\n/)[0] ?? '';
    return first.length > 84 ? first.slice(0, 84) + '…' : first;
  }
  if (typeof args.pattern === 'string' && args.pattern) {
    return args.path ? `${args.pattern} in ${String(args.path)}` : args.pattern;
  }
  if (typeof args.url === 'string' && args.url) return args.url;
  if (typeof args.operation === 'string' && args.operation) return args.operation;
  if (typeof args.filename === 'string' && args.filename) return args.filename;
  if (typeof args.query === 'string' && args.query) return args.query;
  if (typeof args.callId === 'string' && args.callId) return args.callId;
  const keys = Object.keys(args);
  if (!keys.length) return name;
  return keys.slice(0, 3).map(k => `${k}=${JSON.stringify(args[k])}`).join(', ').slice(0, 84);
}

function ThinkingDisclosure({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(streaming);
  const label = streaming ? t('transcript.thinkingStream') : t('transcript.thinking');
  return (
    <div className={`harness-thinking ${streaming ? 'harness-thinking--streaming' : ''}`}>
      <button
        type="button"
        className="harness-thinking__toggle"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Brain size={13} className={streaming ? 'harness-pulse' : ''} aria-hidden="true" />
        <span>{label}</span>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
      </button>
      {open && <div className="harness-thinking__body">{text}</div>}
    </div>
  );
}

function ToolCallRow({
  call,
  defaultExpanded,
  openFile,
}: {
  call: HarnessToolCall;
  defaultExpanded: boolean;
  openFile: (ref: string, opener: HTMLButtonElement) => void;
}) {
  const { t } = useI18n();
  const outcome = useMemo(() => parseToolCallOutcome(call), [call]);
  const [expanded, setExpanded] = useState(defaultExpanded && outcome.kind === 'default');
  const Icon = toolIcon(call.name);
  const summary = summarizeArgs(call.name, call.args);

  let statusTone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' = 'info';
  let statusLabel: string = t('transcript.toolStatus.done');
  let StatusIcon = CheckCircle2;

  if (call.status === 'running') {
    statusTone = 'info';
    statusLabel = t('transcript.toolStatus.running');
    StatusIcon = Loader2;
  } else if (call.status === 'waiting') {
    statusTone = 'warning';
    statusLabel = t('transcript.toolStatus.waiting');
    StatusIcon = Clock;
  } else if (call.status === 'done') {
    statusTone = 'success';
    statusLabel = t('transcript.toolStatus.done');
    StatusIcon = CheckCircle2;
  } else if (outcome.kind === 'changes-requested') {
    statusTone = 'warning';
    statusLabel = t('transcript.toolStatus.changesRequested');
    StatusIcon = RotateCcw;
  } else if (outcome.kind === 'declined') {
    statusTone = 'neutral';
    statusLabel = t('transcript.toolStatus.declined');
    StatusIcon = XCircle;
  } else if (outcome.kind === 'readonly-blocked') {
    statusTone = 'warning';
    statusLabel = t('transcript.toolStatus.readonlyBlocked');
    StatusIcon = AlertCircle;
  } else if (outcome.kind === 'expired') {
    statusTone = 'warning';
    statusLabel = t('transcript.toolStatus.expired');
    StatusIcon = Clock;
  } else {
    statusTone = 'danger';
    statusLabel = call.toolFailure
      ? t(`transcript.toolFailure.${call.toolFailure}` as const)
      : t('transcript.toolStatus.error');
    StatusIcon = AlertCircle;
  }

  const cardToneClass = outcome.kind === 'changes-requested' || outcome.kind === 'readonly-blocked' || outcome.kind === 'expired'
    ? 'harness-tool-card--revised'
    : outcome.kind === 'declined'
      ? 'harness-tool-card--declined'
      : `harness-tool-card--${call.status}`;

  return (
    <div className={`harness-tool-card ${cardToneClass}`}>
      <div className="harness-tool-card__header">
        <button
          type="button"
          className="harness-tool-card__trigger"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
        >
          <span className="harness-tool-card__chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="harness-tool-card__icon" aria-hidden="true"><Icon size={13} /></span>
          <code className="harness-tool-card__name">{call.name}</code>
          <span className="harness-tool-card__summary" title={summary}>{summary}</span>
          <span className={`harness-pill harness-pill--${statusTone}`}>
            <StatusIcon size={11} className={call.status === 'running' ? 'harness-spin' : ''} aria-hidden="true" />
            {statusLabel}
          </span>
        </button>
        {call.fileRef && (
          <button
            type="button"
            className="harness-tool-card__file-btn"
            title={call.fileRef}
            onClick={e => openFile(call.fileRef!, e.currentTarget)}
          >
            <FileCode2 size={12} aria-hidden="true" />
            <span>{call.toolFailure === 'interrupted' ? t('transcript.inspectFile') : t('transcript.openFile')}</span>
          </button>
        )}
      </div>

      {outcome.kind === 'changes-requested' && outcome.feedback && (
        <div className="harness-tool-feedback">
          <MessageSquareText size={13} className="harness-tool-feedback__icon" aria-hidden="true" />
          <span className="harness-tool-feedback__label">{t('transcript.feedbackLabel')}</span>
          <p className="harness-tool-feedback__text">{outcome.feedback}</p>
        </div>
      )}

      {outcome.kind === 'readonly-blocked' && outcome.detail && !expanded && (
        <div className="harness-tool-feedback">
          <AlertCircle size={13} className="harness-tool-feedback__icon" aria-hidden="true" />
          <p className="harness-tool-feedback__text">{outcome.detail}</p>
        </div>
      )}

      {expanded && (
        <div className="harness-tool-card__body">
          {call.toolFailure === 'interrupted' && (
            <p className="harness-tool-card__hint">{t('transcript.interruptedHint')}</p>
          )}
          {outcome.kind === 'default' && outcome.output ? (
            <pre className="harness-code-block">{outcome.output}</pre>
          ) : (
            <pre className="harness-code-block">{JSON.stringify(call.args, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

type SegmentBlock =
  | { kind: 'steps'; key: string; items: Exclude<AssistantStepItem, { kind: 'text' }>[] }
  | { kind: 'text'; key: string; text: string; streaming?: boolean };

function segmentTurnItems(items: AssistantStepItem[]): SegmentBlock[] {
  const blocks: SegmentBlock[] = [];
  for (const item of items) {
    if (item.kind === 'text') {
      blocks.push({ kind: 'text', key: item.key, text: item.text, streaming: item.streaming });
      continue;
    }
    const prev = blocks[blocks.length - 1];
    if (prev && prev.kind === 'steps') {
      prev.items.push(item);
    } else {
      blocks.push({ kind: 'steps', key: `steps-${item.key}`, items: [item] });
    }
  }
  return blocks;
}

function AssistantTurnBlock({
  turn,
  openFile,
}: {
  turn: Extract<TranscriptRenderGroup, { kind: 'assistant-turn' }>;
  openFile: (ref: string, opener: HTMLButtonElement) => void;
}) {
  const { t } = useI18n();
  const blocks = useMemo(() => segmentTurnItems(turn.items), [turn.items]);
  const lastIndex = turn.items.length - 1;
  const lastItemKey = lastIndex >= 0 ? turn.items[lastIndex].key : undefined;

  return (
    <article
      className={`harness-turn harness-turn--assistant ${turn.streaming ? 'harness-turn--streaming' : ''}`}
      data-role="assistant"
    >
      <header className="harness-turn__header">
        <span className="harness-turn__avatar" aria-hidden="true">
          <Sparkles size={12} />
        </span>
        <span className="harness-turn__author">{t('transcript.assistant')}</span>
        {turn.hasRedactedThinking && (
          <span className="harness-turn__meta">
            <Brain size={11} aria-hidden="true" />
            <span>{t('transcript.thinkingRedacted')}</span>
          </span>
        )}
        {turn.streaming && <span className="harness-live-dot" aria-hidden="true" />}
      </header>

      <div className="harness-turn__body">
        {blocks.map(block => {
          if (block.kind === 'text') {
            return (
              <div key={block.key} className="harness-msg__markdown">
                <ChatMarkdownRenderer content={block.text} />
              </div>
            );
          }
          return (
            <div key={block.key} className="harness-steps">
              {block.items.map(step => {
                if (step.kind === 'thinking') {
                  return <ThinkingDisclosure key={step.key} text={step.text} streaming={step.streaming} />;
                }
                if (step.kind === 'tool') {
                  const isUnresolvedTailError = step.key === lastItemKey && step.call.status === 'error';
                  return (
                    <ToolCallRow
                      key={step.key}
                      call={step.call}
                      defaultExpanded={isUnresolvedTailError}
                      openFile={openFile}
                    />
                  );
                }
                const entry = step.entry;
                return (
                  <div key={step.key} className="harness-tool-card harness-tool-card--done">
                    <div className="harness-tool-card__header">
                      <div className="harness-tool-card__trigger">
                        <code className="harness-tool-card__name">
                          {entry.toolFailure
                            ? t(`transcript.toolFailure.${entry.toolFailure}` as const)
                            : entry.toolName ?? t('transcript.viewOutput')}
                        </code>
                      </div>
                      {entry.fileRef && (
                        <button
                          type="button"
                          className="harness-tool-card__file-btn"
                          onClick={e => openFile(entry.fileRef!, e.currentTarget)}
                        >
                          <FileCode2 size={12} aria-hidden="true" />
                          <span>{entry.toolFailure === 'interrupted' ? t('transcript.inspectFile') : t('transcript.openFile')}</span>
                        </button>
                      )}
                    </div>
                    <div className="harness-tool-card__body">
                      {entry.toolFailure === 'invalid-arguments' ? (
                        <details>
                          <summary>{t('transcript.viewValidation')}</summary>
                          <pre className="harness-code-block">{entry.text}</pre>
                        </details>
                      ) : (
                        <pre className="harness-code-block">{entry.text}</pre>
                      )}
                      {entry.toolFailure === 'interrupted' && (
                        <p className="harness-tool-card__hint">{t('transcript.interruptedHint')}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function TranscriptThread({
  view,
  openFile,
  onBindWorkspace,
  onUseStarterPrompt,
}: {
  view: HarnessView;
  openFile: (ref: string, opener: HTMLButtonElement) => void;
  onBindWorkspace: () => void;
  onUseStarterPrompt?: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const viewport = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const panel = viewport.current;
    if (!panel || !content.current) return;
    const followLatest = () => {
      if (follow.current && panel.clientHeight) panel.scrollTop = panel.scrollHeight;
    };
    followLatest();
    const observer = new ResizeObserver(followLatest);
    observer.observe(content.current);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo(
    () => groupTranscriptItems(view.entries, view.partial, view.partialThinking),
    [view.entries, view.partial, view.partialThinking],
  );

  const starters = useMemo(() => [
    {
      id: 'summarize',
      icon: FolderOpen,
      title: t('transcript.starter.summarize.title'),
      desc: t('transcript.starter.summarize.desc'),
      prompt: t('transcript.starter.summarize.prompt'),
    },
    {
      id: 'review',
      icon: Search,
      title: t('transcript.starter.review.title'),
      desc: t('transcript.starter.review.desc'),
      prompt: t('transcript.starter.review.prompt'),
    },
    {
      id: 'doc',
      icon: FileText,
      title: t('transcript.starter.doc.title'),
      desc: t('transcript.starter.doc.desc'),
      prompt: t('transcript.starter.doc.prompt'),
    },
  ], [t]);

  return (
    <div className="harness-thread">
      <section
        ref={viewport}
        className="harness-transcript"
        aria-label={t('app.conversations')}
        onScroll={event => {
          const panel = event.currentTarget;
          if (!panel.clientHeight) return;
          follow.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 40;
          setAway(!follow.current);
        }}
      >
        <div ref={content} className="harness-transcript__inner">
          {groups.length === 0 && (
            <div className="harness-empty-thread">
              <div className="harness-empty-thread__mark" aria-hidden="true">
                <Sparkles size={22} />
              </div>
              <h2>{t('transcript.emptyTitle')}</h2>
              <p>{t('transcript.emptySubtitle')}</p>

              <div className="harness-empty-workspace">
                <div className="harness-empty-workspace__info">
                  <FolderOpen size={15} aria-hidden="true" />
                  <span>
                    {view.workspaceDir
                      ? t('transcript.workspaceBoundLabel', { name: view.workspaceLabel ?? view.workspaceDir })
                      : t('transcript.workspaceSandboxLabel')}
                  </span>
                </div>
                <Button tone="secondary" size="sm" onClick={onBindWorkspace}>
                  {view.workspaceDir ? t('transcript.switchFolderCta') : t('transcript.bindFolderCta')}
                </Button>
              </div>

              {onUseStarterPrompt && (
                <div className="harness-starter-grid">
                  {starters.map(item => {
                    const StarterIcon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="harness-starter-card"
                        onClick={() => onUseStarterPrompt(item.prompt)}
                      >
                        <span className="harness-starter-card__icon" aria-hidden="true">
                          <StarterIcon size={15} />
                        </span>
                        <strong>{item.title}</strong>
                        <span>{item.desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {groups.map((group, index) => {
            const prev = groups[index - 1];
            return (
              <Fragment key={group.key}>
                {index === 0 && group.fromHome && (
                  <div className="harness-divider"><span>{t('transcript.copiedFromHome')}</span></div>
                )}
                {!group.fromHome && prev?.fromHome && (
                  <div className="harness-divider"><span>{t('transcript.continuedInHarness')}</span></div>
                )}

                {group.kind === 'user' ? (
                  <article className="harness-msg harness-msg--user" data-role="user">
                    <div className="harness-msg__bubble">
                      <p className="harness-msg__plain">{group.entry.text}</p>
                    </div>
                  </article>
                ) : (
                  <AssistantTurnBlock turn={group} openFile={openFile} />
                )}
              </Fragment>
            );
          })}
        </div>
      </section>

      {away && (
        <div className="harness-jump">
          <Button
            size="sm"
            tone="secondary"
            leadingIcon={<ArrowDown size={14} />}
            onClick={() => {
              follow.current = true;
              setAway(false);
              if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
            }}
          >
            {t('transcript.jumpLatest')}
          </Button>
        </div>
      )}
    </div>
  );
}
