import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  FileText,
  GraduationCap,
  House,
  Library,
  NotebookPen,
  Route,
  Settings,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import {
  PreviewHeading,
  PreviewNav,
  PreviewTabs,
  RemainingPreview,
} from './demo-remaining-shared.js';

/** DeepTutor's warm-paper learning workspace, capability chooser, reading and mastery views. */
export function DemoDeepTutorPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('home');
  const [mode, setMode] = useState('Chat');
  const [question, setQuestion] = useState(() =>
    pData('How does a Fourier transform describe sound?'),
  );
  const [asked, setAsked] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const nav = [
    { id: 'home', label: 'Home', Icon: House },
    { id: 'reading', label: 'Immersive Reading', Icon: BookOpen },
    { id: 'mastery', label: 'Mastery Path', Icon: Route },
    { id: 'space', label: 'Learning Space', Icon: Library },
    { id: 'settings', label: 'Settings', Icon: Settings },
  ];
  const explanation =
    'A sound signal changes over time. A Fourier transform describes it in terms of frequencies: which tones are present, how strong they are, and their phase. A pure tone gives one prominent frequency; a chord combines several.';
  return (
    <RemainingPreview content={content} kind="deeptutor">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={setView}
          footer={
            <>
              <span>{pText('Recent sessions')}</span>
              <button
                type="button"
                onClick={() => {
                  setView('home');
                  setAsked(true);
                }}
              >
                {pText('Understanding sound')}
              </button>
              <small>{pText('Sample learning workspace')}</small>
            </>
          }
        />
        <main className="rp-main rp-page">
          {view === 'home' ? (
            <>
              <header className="dt-topline">
                <span>
                  <GraduationCap size={17} />
                  {pText('Learning, one question at a time')}
                </span>
                <span className="rp-badge">{pText('Sample session')}</span>
              </header>
              {!asked ? (
                <div className="dt-welcome">
                  <GraduationCap size={42} />
                  <h1>{pText('What would you like to learn?')}</h1>
                  <p>{pText('Bring a question, a document, or a little curiosity.')}</p>
                  <div className="dt-starters">
                    {['Understand a concept', 'Work through a problem', 'Explore a reading'].map(
                      (x) => (
                        <button
                          type="button"
                          key={x}
                          onClick={() => {
                            setQuestion(
                              x === pText('Work through a problem')
                                ? pText('How do I find the derivative of x squared?')
                                : pText('How does a Fourier transform describe sound?'),
                            );
                            setMode(x === 'Work through a problem' ? 'Deep Solve' : 'Chat');
                          }}
                        >
                          {pText(x)}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ) : (
                <article className="dt-answer">
                  <div className="dt-question">{pText('Saved lesson: understanding sound')}</div>
                  <h2>{pText('A different way to look at a signal')}</h2>
                  <p>{pText(explanation)}</p>
                  <div
                    className="dt-frequency"
                    role="img"
                    aria-label={pText('Illustrative frequency spectrum')}
                  >
                    <i style={{ height: '28%' }} />
                    <i style={{ height: '80%' }} />
                    <i style={{ height: '42%' }} />
                    <i style={{ height: '18%' }} />
                    <i style={{ height: '9%' }} />
                  </div>
                  <div className="dt-study-steps">
                    <p>
                      <strong>{pText('Time domain')}</strong>{' '}
                      {pText(' — watch the waveform change.')}
                    </p>
                    <p>
                      <strong>{pText('Frequency domain')}</strong>{' '}
                      {pText(' — inspect the tones that make it up.')}
                    </p>
                  </div>
                  <small>
                    {pText('Prewritten lesson example; your input is not sent to a model.')}
                  </small>
                  <PreviewButton
                    onClick={() => {
                      setNotes((v) => (v.includes(explanation) ? v : [...v, explanation]));
                      setView('space');
                    }}
                  >
                    <NotebookPen size={15} />
                    {pText('Save example to notebook')}
                  </PreviewButton>
                </article>
              )}
              <div className="dt-composer">
                <PreviewTabs
                  items={['Chat', 'Deep Solve', 'Research', 'Quiz']}
                  value={mode}
                  onChange={setMode}
                  label={pText('Learning mode')}
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setAsked(true);
                    if (mode === 'Quiz') setView('mastery');
                  }}
                >
                  <textarea
                    aria-label={pText('Learning question')}
                    value={question}
                    rows={2}
                    onChange={(e) => {
                      setQuestion(e.target.value);
                    }}
                    placeholder={pText('Ask a question…')}
                  />
                  <button
                    type="submit"
                    aria-label={pText('Open saved lesson')}
                    disabled={!question.trim()}
                  >
                    <ArrowUp size={19} />
                  </button>
                </form>
                <div>
                  <FileText size={14} />
                  {pText('Signals and sound · sample source')}
                </div>
              </div>
            </>
          ) : view === 'reading' ? (
            <>
              <PreviewHeading
                title={pText('Immersive Reading')}
                description={pText('Read a source with a question in mind.')}
              />
              <div className="dt-reading">
                <article>
                  <span>{pText('Sample document · 1 / 3')}</span>
                  <h2>{pText('Listening to the shape of sound')}</h2>
                  <p>{pText(explanation)}</p>
                  <p>
                    {pText(
                      'The same signal can be represented in time or frequency. Each view answers a different question.',
                    )}
                  </p>
                </article>
                <aside>
                  <h3>{pText('Reading companion')}</h3>
                  <p>
                    {pText('What changes when you switch from a waveform to a frequency spectrum?')}
                  </p>
                  <PreviewButton
                    onClick={() => {
                      setView('home');
                      setAsked(true);
                    }}
                  >
                    {pText('Explore this concept')}
                  </PreviewButton>
                </aside>
              </div>
            </>
          ) : view === 'mastery' ? (
            <>
              <PreviewHeading
                title={pText('Mastery Path')}
                description={pText('Build understanding through small, connected steps.')}
              />
              <div className="dt-path">
                {['Signals in time', 'Frequency and amplitude', 'Combining simple waves'].map(
                  (x, i) => (
                    <div key={x}>
                      <span>{i === 0 ? <Check size={16} /> : i + 1}</span>
                      <h3>{pText(x)}</h3>
                      <small>{pText('Sample lesson')}</small>
                    </div>
                  ),
                )}
              </div>
              <section className="dt-quiz">
                <h2>{pText('Check your understanding')}</h2>
                <p>{pText('What does a frequency spectrum help you see?')}</p>
                {[
                  'The tones present in a signal',
                  'Only the length of a recording',
                  'The name of the speaker',
                ].map((x) => (
                  <button
                    type="button"
                    aria-pressed={answer === x}
                    key={x}
                    onClick={() => setAnswer(x)}
                  >
                    {pText(x)}
                  </button>
                ))}
                {answer && (
                  <p role="status">
                    {pText(
                      answer === 'The tones present in a signal'
                        ? 'Correct — it shows frequency content.'
                        : 'Try again. Think about which tones make up the sound.',
                    )}
                  </p>
                )}
              </section>
            </>
          ) : view === 'space' ? (
            <>
              <PreviewHeading
                title={pText('Learning Space')}
                description={pText('Keep the sources and notes that help an idea stay with you.')}
              />
              <div className="dt-space">
                <section>
                  <h2>
                    <FileText size={18} />
                    {pText('Sources')}
                  </h2>
                  <p>{pText('Signals and sound · Sample document')}</p>
                  <PreviewButton onClick={() => setView('reading')}>
                    {pText('Read source')}
                  </PreviewButton>
                </section>
                <section>
                  <h2>
                    <NotebookPen size={18} />
                    {pText('Notebook')}
                  </h2>
                  {notes.length ? (
                    notes.map((n, i) => <p key={i}>{pText(n)}</p>)
                  ) : (
                    <p>{pText('No notes yet. Save the example explanation from a lesson.')}</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <>
              <PreviewHeading
                title={pText('Settings')}
                description={pText(
                  'The installed App manages learning preferences and Nimi AI configuration here.',
                )}
              />
              <label>
                {pText('Example response style')}
                <select defaultValue="Step by step">
                  <option value={'Step by step'}>{pText('Step by step')}</option>
                  <option value={'Concise'}>{pText('Concise')}</option>
                </select>
              </label>
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
