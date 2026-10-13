import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SVGProps,
} from 'react';
import type { HeroDemoShijingPreview } from '../content/landing-content.js';

/**
 * Interactive replica of the ShiJing 问镜 (consultation) tab. Mirrors the
 * app's shijing-tab.tsx composition — the flush history rail
 * (shijing-history-rail.tsx), the centered welcome hero + frosted composer
 * card with the 上下文焦点 bar (shijing-composer.tsx /
 * shijing-context-widgets.tsx), the 已有相关提问 recall tray, and the chat
 * thread with the composer pinned at the bottom — on the app's class names
 * over the ported shijing-ask-*.css. Answers are mock data; no Runtime AI runs.
 */

const ASK_THINK_MS = 1_400;

type AskContent = HeroDemoShijingPreview['ask'];
type AskTurn = {
  id: string;
  role: 'user' | 'ai';
  question?: string;
  pending?: boolean;
  followUp?: boolean;
};
type Session = {
  id: string;
  question: string;
  group: 'today' | 'week' | 'earlier';
  date: string;
  concerns: ReadonlyArray<string>;
};

type IconProps = SVGProps<SVGSVGElement>;

function ArrowUpIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 18V6" />
      <path d="M7 11l5-5 5 5" />
    </svg>
  );
}

function SearchIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function FilterIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function fill(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

export function DemoShijingAsk({ content }: { content: AskContent }) {
  const { pText, pData } = useAppPreviewLocale();
  const [question, setQuestion] = useState(() => pData(''));
  const [search, setSearch] = useState(() => pData(''));
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterConcerns, setFilterConcerns] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(true);
  const [threads, setThreads] = useState<Record<string, AskTurn[]>>({});
  const [localSessions, setLocalSessions] = useState<Session[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const filterRef = useRef<HTMLSpanElement>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  // Newest first: questions asked in this session sit above the seeded history.
  const sessions: Session[] = useMemo(
    () => [
      ...localSessions,
      ...content.history.map((entry) => ({ ...entry, concerns: entry.concerns ?? [] })),
    ],
    [content.history, localSessions],
  );
  const chatActive = !drafting && selected !== null;
  const lookup = search.trim().length > 0 ? search.trim() : chatActive ? '' : question.trim();
  const filtered = sessions.filter(
    (entry) =>
      (lookup.length === 0 || entry.question.includes(lookup)) &&
      (filterConcerns.length === 0 ||
        filterConcerns.some((concern) => entry.concerns.includes(concern))),
  );
  const groups = (['today', 'week', 'earlier'] as const)
    .map((group) => ({
      group,
      label: content.groups[group],
      items: filtered.filter((entry) => entry.group === group),
    }))
    .filter((entry) => entry.items.length > 0);
  const recall =
    search.trim().length === 0 && !chatActive && question.trim().length > 0
      ? sessions.filter((entry) => entry.question.includes(question.trim())).slice(0, 3)
      : [];

  const thread: AskTurn[] = selected
    ? (threads[selected] ?? [
        {
          id: `${selected}-q`,
          role: 'user',
          question: sessions.find((entry) => entry.id === selected)?.question ?? '',
        },
        { id: `${selected}-a`, role: 'ai' },
      ])
    : [];
  const pending = thread.some((turn) => turn.pending);
  const followUp = chatActive && !pending;
  const canAsk = question.trim().length > 0 && !pending;
  const submitLabel = pending
    ? followUp
      ? content.sending
      : content.generating
    : followUp
      ? content.send
      : content.generate;
  const submitTitle = followUp ? content.sendTitle : content.generateTitle;

  const finishAfterDelay = (id: string) => {
    timerRef.current = setTimeout(() => {
      setThreads((current) => ({
        ...current,
        [id]: (current[id] ?? []).map((turn) =>
          turn.pending ? { ...turn, pending: false } : turn,
        ),
      }));
    }, ASK_THINK_MS);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const body = question.trim();
    if (!body || pending) return;
    if (followUp && selected) {
      const id = selected;
      setThreads((current) => ({
        ...current,
        [id]: [
          ...(current[id] ?? thread),
          { id: `${id}-q-${Date.now()}`, role: 'user', question: body, followUp: true },
          { id: `${id}-a-${Date.now()}`, role: 'ai', pending: true, followUp: true },
        ],
      }));
      setQuestion('');
      finishAfterDelay(id);
      return;
    }
    const id = `ask-${Date.now()}`;
    setThreads((current) => ({
      ...current,
      [id]: [
        { id: `${id}-q`, role: 'user', question: body },
        { id: `${id}-a`, role: 'ai', pending: true },
      ],
    }));
    setLocalSessions((current) => [
      { id, question: body, group: 'today', date: content.justNow, concerns: [] },
      ...current,
    ]);
    setSelected(id);
    setDrafting(false);
    setQuestion('');
    finishAfterDelay(id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    if (canAsk) event.currentTarget.form?.requestSubmit();
  };

  const startNewQuestion = () => {
    setSelected(null);
    setDrafting(true);
    setQuestion('');
    setTimeout(() => composerRef.current?.focus(), 0);
  };

  const selectSession = (id: string) => {
    setSelected(id);
    setDrafting(false);
    setQuestion('');
  };

  const filterLabel =
    filterConcerns.length > 0
      ? fill(content.filterButtonActive, filterConcerns.length)
      : content.filterButton;

  const composer = (
    <form
      className="shijing-ask__composer"
      data-chat-composer={chatActive ? 'true' : 'false'}
      onSubmit={handleSubmit}
      aria-label={pText(content.composerAria)}
    >
      <h2 className="shijing-ask__composer-title">{pText(content.composerTitle)}</h2>
      <textarea
        ref={composerRef}
        className="shijing-ask__textarea"
        rows={2}
        value={question}
        onChange={(event) => {
          setQuestion(event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={pText(chatActive ? '' : content.placeholderLines.join('\n'))}
        aria-label={pText(content.questionAria)}
      />
      <div className="shijing-ask__toolbar">
        {chatActive ? null : (
          <section className="shijing-ctx" aria-label={pText(content.contextTitle)}>
            <div className="shijing-ctx__lead">
              <span className="shijing-ctx__icon" aria-hidden="true">
                {pText('✦')}
              </span>
              <div className="shijing-ctx__text">
                <p className="shijing-ctx__title">{pText(content.contextTitle)}</p>
                <p className="shijing-ctx__desc">{pText(content.contextDescription)}</p>
              </div>
            </div>
            <div className="shijing-ctx__focus">
              <ul className="shijing-ctx__chips">
                {content.concerns.length === 0 ? (
                  <li className="shijing-ctx__empty">{pText(content.contextEmpty)}</li>
                ) : (
                  content.concerns.map((concern) => (
                    <li key={concern} className="shijing-ctx__chip">
                      {pText('#')}
                      {pText(concern)}
                    </li>
                  ))
                )}
              </ul>
              <span className="shijing-ctx__editor-anchor">
                <button
                  type="button"
                  className="shijing-ctx__manage"
                  aria-haspopup="dialog"
                  aria-expanded={false}
                >
                  {pText('✎ ')}
                  {pText(content.contextManage)}
                </button>
              </span>
            </div>
          </section>
        )}
        <div className="shijing-ask__actions">
          <div className="shijing-ask__submit-wrap">
            <button
              type="submit"
              className="shijing-generating-button shijing-ask__submit"
              disabled={!canAsk}
              aria-busy={pending || undefined}
              data-busy={pending ? 'true' : 'false'}
              title={pText(submitTitle)}
            >
              {pending ? (
                <span className="shijing-generating-button__spinner" aria-hidden="true" />
              ) : (
                <span className="shijing-generating-button__icon" aria-hidden="true">
                  <ArrowUpIcon className="shijing-ask__submit-icon" />
                </span>
              )}
              <span className="shijing-generating-button__label shijing-ask__submit-text">
                {pText(submitLabel)}
              </span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  const result = chatActive ? (
    <article className="shijing-ask__result" aria-label={pText(content.resultAria)}>
      <ol className="shijing-ask__thread">
        {thread.map((turn) => (
          <li
            key={turn.id}
            className="shijing-ask__turn"
            data-role={turn.role}
            data-pending={turn.pending ? 'true' : undefined}
          >
            <span className="shijing-ask__turn-role">
              {pText(turn.role === 'user' ? content.roleUser : content.roleAi)}
            </span>
            <div className="shijing-ask__turn-body" aria-live={turn.pending ? 'polite' : undefined}>
              {turn.pending ? (
                <>
                  <span className="shijing-ask__thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>{pText(content.thinking)}</span>
                </>
              ) : turn.role === 'ai' ? (
                turn.followUp ? (
                  <div className="shijing-ask__answer shijing-ask__answer--plain">
                    {content.followUpAnswer.map((paragraph) => (
                      <p key={paragraph}>{pText(paragraph)}</p>
                    ))}
                  </div>
                ) : (
                  <div className="shijing-ask__answer">
                    <h3 className="shijing-ask__answer-title">{pText(content.answer.title)}</h3>
                    <p className="shijing-ask__answer-conclusion">
                      {pText(content.answer.conclusion)}
                    </p>
                    <div className="shijing-ask__answer-cards">
                      {content.answer.cards.map((card) => (
                        <article key={card.title} className="shijing-ask__answer-card">
                          <h4 className="shijing-ask__answer-card-title">{pText(card.title)}</h4>
                          <p className="shijing-ask__answer-risk" data-risk={card.risk}>
                            <span className="shijing-ask__answer-field-label">
                              {pText(content.fields.riskLevel)}
                            </span>
                            <span>{pText(card.risk)}</span>
                          </p>
                          <p className="shijing-ask__answer-field">
                            <span className="shijing-ask__answer-field-label">
                              {pText(content.fields.why)}
                            </span>
                            <span>{pText(card.why)}</span>
                          </p>
                          <p className="shijing-ask__answer-field">
                            <span className="shijing-ask__answer-field-label">
                              {pText(content.fields.suggestion)}
                            </span>
                            <span>{pText(card.suggestion)}</span>
                          </p>
                          <p className="shijing-ask__answer-field">
                            <span className="shijing-ask__answer-field-label">
                              {pText(content.fields.avoid)}
                            </span>
                            <span>{pText(card.avoid)}</span>
                          </p>
                        </article>
                      ))}
                    </div>
                    <p className="shijing-ask__answer-summary">{pText(content.answer.summary)}</p>
                  </div>
                )
              ) : (
                turn.question
              )}
            </div>
            {turn.role === 'ai' && !turn.pending && !turn.followUp ? (
              <small className="shijing-ask__turn-cite">
                {pText(fill(content.citedFormat, content.answer.cited))}
              </small>
            ) : null}
          </li>
        ))}
      </ol>
    </article>
  ) : null;

  return (
    <section
      className="shijing-tab shijing-shijing shijing-ask"
      data-mirror-kind="shijing"
      aria-label={pText(content.title)}
    >
      <div className="shijing-ask__layout">
        <aside className="shijing-ask__rail" aria-label={pText(content.railAria)}>
          <div className="shijing-ask__rail-head">
            <button
              type="button"
              className="shijing-ask__new-question"
              aria-label={pText(content.newQuestionAria)}
              aria-current={drafting && selected === null ? 'true' : undefined}
              onClick={startNewQuestion}
            >
              <span aria-hidden="true">{pText('+')}</span>
              {pText(content.newQuestion)}
            </button>
            <div className="shijing-ask__search">
              <div className="shijing-ask__search-row">
                <div className="shijing-ask__search-input">
                  <SearchIcon className="shijing-ask__search-icon" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.currentTarget.value);
                    }}
                    placeholder={pText(content.searchPlaceholder)}
                    aria-label={pText(content.searchPlaceholder)}
                  />
                </div>
                <span className="shijing-ask__filter" ref={filterRef}>
                  <button
                    type="button"
                    className="shijing-ask__filter-button"
                    aria-label={pText(filterLabel)}
                    title={pText(filterLabel)}
                    aria-expanded={filterOpen}
                    aria-haspopup="menu"
                    data-active={filterConcerns.length > 0 ? 'true' : 'false'}
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <FilterIcon className="shijing-ask__filter-icon" />
                  </button>
                  {filterOpen ? (
                    <div
                      className="shijing-ask__filter-menu"
                      role="menu"
                      aria-label={pText(content.filterMenuAria)}
                    >
                      <button
                        type="button"
                        className="shijing-ask__filter-option"
                        role="menuitemcheckbox"
                        aria-checked={filterConcerns.length === 0}
                        onClick={() => setFilterConcerns([])}
                      >
                        <span>{pText(content.filterAll)}</span>
                      </button>
                      {content.concerns.map((concern) => (
                        <button
                          key={concern}
                          type="button"
                          className="shijing-ask__filter-option"
                          role="menuitemcheckbox"
                          aria-checked={filterConcerns.includes(concern)}
                          onClick={() =>
                            setFilterConcerns((current) =>
                              current.includes(concern)
                                ? current.filter((item) => item !== concern)
                                : [...current, concern],
                            )
                          }
                        >
                          <span>{pText(concern)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </span>
              </div>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="shijing-ask__rail-empty">
              <span className="shijing-ask__rail-empty-icon" aria-hidden="true">
                {pText('✎')}
              </span>
              <p className="shijing-ask__rail-empty-title">
                {pText(sessions.length === 0 ? content.railEmptyTitle : content.emptySearch)}
              </p>
              <p className="shijing-ask__rail-empty-desc">{pText(content.railEmptyBody)}</p>
            </div>
          ) : (
            <div className="shijing-ask__sessions">
              {groups.map((group) => (
                <div key={group.group} className="shijing-ask__session-group">
                  <p className="shijing-ask__session-group-label">{pText(group.label)}</p>
                  <ul>
                    {group.items.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="shijing-ask__session"
                          aria-current={chatActive && selected === entry.id ? 'true' : undefined}
                          onClick={() => selectSession(entry.id)}
                        >
                          <span className="shijing-ask__session-q">{pText(entry.question)}</span>
                          <span className="shijing-ask__session-time">{pText(entry.date)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="shijing-ask__main" data-chat-active={chatActive ? 'true' : 'false'}>
          {chatActive ? (
            <>
              {pText(result)}
              {pText(composer)}
            </>
          ) : (
            <div className="shijing-ask__welcome">
              <header className="shijing-ask__hero">
                <h1 className="shijing-ask__title">
                  {pText(content.title)}
                  <span className="shijing-ask__title-dot" aria-hidden="true" />
                </h1>
                <p className="shijing-ask__subtitle">{pText(content.subtitle)}</p>
                <span className="shijing-ask__hero-rule" aria-hidden="true" />
              </header>
              {pText(composer)}
              {recall.length > 0 ? (
                <section className="shijing-recall" aria-label={pText(content.recallAria)}>
                  <div className="shijing-recall__lead">
                    <span className="shijing-recall__icon" aria-hidden="true">
                      {pText('+')}
                    </span>
                    <span className="shijing-recall__title">{pText(content.recallTitle)}</span>
                  </div>
                  <ul className="shijing-recall__list">
                    {recall.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="shijing-recall__item"
                          onClick={() => selectSession(entry.id)}
                        >
                          <span className="shijing-recall__question">{pText(entry.question)}</span>
                          <span className="shijing-recall__meta">
                            {pText(
                              entry.concerns.length > 0 ? entry.concerns.join(' / ') : entry.date,
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
