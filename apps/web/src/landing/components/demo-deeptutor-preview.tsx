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
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('home');
  const [mode, setMode] = useState('Chat');
  const [question, setQuestion] = useState(() =>
    t('deeptutor.workspace.howDoesAFourierTransformDescribeSound'),
  );
  const [asked, setAsked] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const nav = [
    { id: 'home', label: t('deeptutor.workspace.home'), Icon: House },
    { id: 'reading', label: t('deeptutor.workspace.immersiveReading'), Icon: BookOpen },
    { id: 'mastery', label: t('deeptutor.workspace.masteryPath'), Icon: Route },
    { id: 'space', label: t('deeptutor.workspace.learningSpace'), Icon: Library },
    { id: 'settings', label: t('deeptutor.workspace.settings'), Icon: Settings },
  ];
  const explanation = t('deeptutor.workspace.aSoundSignalChangesOverTimeA');
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
              <span>{t('deeptutor.workspace.recentSessions')}</span>
              <button
                type="button"
                onClick={() => {
                  setView('home');
                  setAsked(true);
                }}
              >
                {t('deeptutor.workspace.understandingSound')}
              </button>
              <small>{t('deeptutor.workspace.sampleLearningWorkspace')}</small>
            </>
          }
        />
        <main className="rp-main rp-page">
          {view === 'home' ? (
            <>
              <header className="dt-topline">
                <span>
                  <GraduationCap size={17} />
                  {t('deeptutor.topline.learningOneQuestionAtATime')}
                </span>
                <span className="rp-badge">{t('deeptutor.topline.sampleSession')}</span>
              </header>
              {!asked ? (
                <div className="dt-welcome">
                  <GraduationCap size={42} />
                  <h1>{t('deeptutor.main.whatWouldYouLikeToLearn')}</h1>
                  <p>{t('deeptutor.main.bringAQuestionADocumentOrA')}</p>
                  <div className="dt-starters">
                    {[
                      t('deeptutor.main.understandAConcept'),
                      'Work through a problem',
                      t('deeptutor.main.exploreAReading'),
                    ].map((x) => (
                      <button
                        type="button"
                        key={x}
                        onClick={() => {
                          setQuestion(
                            x === 'Work through a problem'
                              ? t('deeptutor.main.howDoIFindTheDerivativeOf')
                              : t('deeptutor.main.howDoesAFourierTransformDescribeSound'),
                          );
                          setMode(x === 'Work through a problem' ? 'Deep Solve' : 'Chat');
                        }}
                      >
                        {x === 'Work through a problem' ? t('deeptutor.home.solveProblem') : x}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <article className="dt-answer">
                  <div className="dt-question">
                    {t('deeptutor.main.savedLessonUnderstandingSound')}
                  </div>
                  <h2>{t('deeptutor.main.aDifferentWayToLookAtA')}</h2>
                  <p>{explanation}</p>
                  <div
                    className="dt-frequency"
                    role="img"
                    aria-label={t('deeptutor.main.illustrativeFrequencySpectrum')}
                  >
                    <i style={{ height: '28%' }} />
                    <i style={{ height: '80%' }} />
                    <i style={{ height: '42%' }} />
                    <i style={{ height: '18%' }} />
                    <i style={{ height: '9%' }} />
                  </div>
                  <div className="dt-study-steps">
                    <p>
                      <strong>{t('deeptutor.main.timeDomain')}</strong>{' '}
                      {t('deeptutor.main.watchTheWaveformChange')}
                    </p>
                    <p>
                      <strong>{t('deeptutor.main.frequencyDomain')}</strong>{' '}
                      {t('deeptutor.main.inspectTheTonesThatMake')}
                    </p>
                  </div>
                  <small>{t('deeptutor.main.prewrittenLessonExampleYourInputIsNot')}</small>
                  <PreviewButton
                    onClick={() => {
                      setNotes((v) => (v.includes(explanation) ? v : [...v, explanation]));
                      setView('space');
                    }}
                  >
                    <NotebookPen size={15} />
                    {t('deeptutor.main.saveExampleToNotebook')}
                  </PreviewButton>
                </article>
              )}
              <div className="dt-composer">
                <PreviewTabs
                  items={[
                    { value: 'Chat', label: t('deeptutor.main.chat') },
                    { value: 'Deep Solve', label: t('deeptutor.main.deepSolve') },
                    { value: 'Research', label: t('deeptutor.main.research') },
                    { value: 'Quiz', label: t('deeptutor.tabs.quiz') },
                  ]}
                  value={mode}
                  onChange={setMode}
                  label={t('deeptutor.main.learningMode')}
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setAsked(true);
                    if (mode === 'Quiz') setView('mastery');
                  }}
                >
                  <textarea
                    aria-label={t('deeptutor.main.learningQuestion')}
                    value={question}
                    rows={2}
                    onChange={(e) => {
                      setQuestion(e.target.value);
                    }}
                    placeholder={t('deeptutor.main.askAQuestion')}
                  />
                  <button
                    type="submit"
                    aria-label={t('deeptutor.main.openSavedLesson')}
                    disabled={!question.trim()}
                  >
                    <ArrowUp size={19} />
                  </button>
                </form>
                <div>
                  <FileText size={14} />
                  {t('deeptutor.main.signalsAndSoundSampleSource')}
                </div>
              </div>
            </>
          ) : view === 'reading' ? (
            <>
              <PreviewHeading
                title={t('deeptutor.main.immersiveReading')}
                description={t('deeptutor.main.readASourceWithAQuestionIn')}
              />
              <div className="dt-reading">
                <article>
                  <span>{t('deeptutor.main.sampleDocument13')}</span>
                  <h2>{t('deeptutor.main.listeningToTheShapeOfSound')}</h2>
                  <p>{explanation}</p>
                  <p>{t('deeptutor.main.theSameSignalCanBeRepresentedIn')}</p>
                </article>
                <aside>
                  <h3>{t('deeptutor.main.readingCompanion')}</h3>
                  <p>{t('deeptutor.main.whatChangesWhenYouSwitchFromA')}</p>
                  <PreviewButton
                    onClick={() => {
                      setView('home');
                      setAsked(true);
                    }}
                  >
                    {t('deeptutor.main.exploreThisConcept')}
                  </PreviewButton>
                </aside>
              </div>
            </>
          ) : view === 'mastery' ? (
            <>
              <PreviewHeading
                title={t('deeptutor.main.masteryPath')}
                description={t('deeptutor.main.buildUnderstandingThroughSmallConnectedSteps')}
              />
              <div className="dt-path">
                {[
                  t('deeptutor.main.signalsInTime'),
                  t('deeptutor.main.frequencyAndAmplitude'),
                  t('deeptutor.main.combiningSimpleWaves'),
                ].map((x, i) => (
                  <div key={x}>
                    <span>{i === 0 ? <Check size={16} /> : i + 1}</span>
                    <h3>{x}</h3>
                    <small>{t('deeptutor.main.sampleLesson')}</small>
                  </div>
                ))}
              </div>
              <section className="dt-quiz">
                <h2>{t('deeptutor.quiz.checkYourUnderstanding')}</h2>
                <p>{t('deeptutor.quiz.whatDoesAFrequencySpectrumHelpYou')}</p>
                {[
                  'The tones present in a signal',
                  t('deeptutor.quiz.onlyTheLengthOfARecording'),
                  t('deeptutor.quiz.theNameOfTheSpeaker'),
                ].map((x) => (
                  <button
                    type="button"
                    aria-pressed={answer === x}
                    key={x}
                    onClick={() => setAnswer(x)}
                  >
                    {x}
                  </button>
                ))}
                {answer && (
                  <p role="status">
                    {answer === 'The tones present in a signal'
                      ? t('deeptutor.quiz.correctItShowsFrequencyContent')
                      : t('deeptutor.quiz.tryAgainThinkAboutWhichTonesMake')}
                  </p>
                )}
              </section>
            </>
          ) : view === 'space' ? (
            <>
              <PreviewHeading
                title={t('deeptutor.main.learningSpace')}
                description={t('deeptutor.main.keepTheSourcesAndNotesThatHelp')}
              />
              <div className="dt-space">
                <section>
                  <h2>
                    <FileText size={18} />
                    {t('deeptutor.main.sources')}
                  </h2>
                  <p>{t('deeptutor.main.signalsAndSoundSampleDocument')}</p>
                  <PreviewButton onClick={() => setView('reading')}>
                    {t('deeptutor.main.readSource')}
                  </PreviewButton>
                </section>
                <section>
                  <h2>
                    <NotebookPen size={18} />
                    {t('deeptutor.main.notebook')}
                  </h2>
                  {notes.length ? (
                    notes.map((n, i) => <p key={i}>{n}</p>)
                  ) : (
                    <p>{t('deeptutor.main.noNotesYetSaveTheExampleExplanation')}</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <>
              <PreviewHeading
                title={t('deeptutor.main.settings')}
                description={t('deeptutor.main.theInstalledAppManagesLearningPreferencesAnd')}
              />
              <label>
                {t('deeptutor.main.exampleResponseStyle')}
                <select defaultValue="Step by step">
                  <option value="Step by step">{t('deeptutor.main.stepByStep')}</option>
                  <option value="Concise">{t('deeptutor.main.concise')}</option>
                </select>
              </label>
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
