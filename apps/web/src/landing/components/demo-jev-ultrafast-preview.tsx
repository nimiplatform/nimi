import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { ArrowUpRight, Check, MousePointer2, Play, RotateCcw, Square } from 'lucide-react';
import type { JevUltrafastPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice } from './demo-third-party-shared.js';

/** Replica of jev_ultrafast/static/index.html's task, browser, choice and history panels. */
export function DemoJevUltrafastPreview({ content }: { content: JevUltrafastPreviewContent }) {
  const { previewLang, t } = useAppPreviewLocale();
  const [goal, setGoal] = useState<string>(() => content.goal);
  const [started, setStarted] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [step, setStep] = useState(0);
  const [targets, setTargets] = useState(true);
  const [stopped, setStopped] = useState(false);
  const current = content.steps[step]!;
  const begin = () => {
    setStarted(true);
    setStopped(false);
    setStep(0);
    setChosen(false);
  };
  return (
    <div
      className="tp-preview jev-ultrafast-preview"
      data-demo-jev-ultrafast-root
      lang={previewLang}
    >
      <header className="ju-header">
        <strong>
          {t('jevUltrafast.header.browser')}
          <span>{t('jevUltrafast.header.use')}</span>
          <i>{'×'}</i>
          {t('jevUltrafast.header.nimi')}
        </strong>
        <span>
          <i className="ju-dot" />
          {t('jevUltrafast.header.jevUltrafast')}
        </span>
      </header>
      <main className="ju-main">
        <div className="ju-intro">
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
        <form
          className="ju-task"
          onSubmit={(event) => {
            event.preventDefault();
            begin();
          }}
        >
          <label htmlFor="ju-demo-goal">{t('jevUltrafast.main.giveItATask')}</label>
          <div className="ju-url">
            <span>{t('jevUltrafast.main.startUrl')}</span>
            <code>{t('jevUltrafast.main.httpsExampleCom')}</code>
            <span className="tp-chip">{t('jevUltrafast.main.savedExample')}</span>
          </div>
          <div className="ju-task-row">
            <textarea
              id="ju-demo-goal"
              value={goal}
              onChange={(event) => {
                setGoal(event.target.value);
              }}
              maxLength={600}
              rows={2}
            />
            <PreviewButton primary type="submit" disabled={!goal.trim()}>
              {t('jevUltrafast.main.start')}
              <ArrowUpRight size={17} />
            </PreviewButton>
          </div>
        </form>
        <div className="ju-toolbar">
          <span role="status">
            <i className="ju-dot" />
            {!started
              ? t('jevUltrafast.main.readyToExploreTheExample')
              : stopped
                ? t('jevUltrafast.main.exampleStopped')
                : step === 1
                  ? t('jevUltrafast.main.destinationReachedExample')
                  : t('jevUltrafast.main.examplePageObserved')}
          </span>
          <div>
            <label>
              <input
                type="checkbox"
                checked={targets}
                onChange={(event) => {
                  setTargets(event.target.checked);
                }}
              />
              {t('jevUltrafast.main.targets')}
            </label>
            <PreviewButton
              disabled={!started || stopped || step === 1}
              onClick={() => setChosen(true)}
            >
              {t('jevUltrafast.main.chooseNext')}
            </PreviewButton>
            <PreviewButton
              disabled={!chosen || stopped || step === 1}
              onClick={() => {
                setStep(1);
                setChosen(true);
              }}
            >
              {t('jevUltrafast.main.executeChoice')}
            </PreviewButton>
            {started && !stopped && step === 0 ? (
              <PreviewButton
                aria-label={t('jevUltrafast.main.stopExample')}
                onClick={() => setStopped(true)}
              >
                <Square size={13} />
                {t('jevUltrafast.main.stop')}
              </PreviewButton>
            ) : (
              <PreviewButton
                aria-label={t('jevUltrafast.main.resetExample')}
                onClick={() => {
                  setStarted(false);
                  setChosen(false);
                  setStopped(false);
                  setStep(0);
                }}
              >
                <RotateCcw size={14} />
              </PreviewButton>
            )}
          </div>
        </div>
        <div className="ju-workspace">
          <section className="ju-browser">
            <div className="ju-browser-bar">
              <span className="ju-traffic">
                <i />
                <i />
                <i />
              </span>
              <span>
                {started ? current.url : t('jevUltrafast.browser.dedicatedAutomationBrowser')}
              </span>
              <b>{t('jevUltrafast.browser.sample')}</b>
            </div>
            <div className="ju-viewport">
              {!started ? (
                <div className="ju-empty">
                  <MousePointer2 size={34} />
                  <h2>{t('jevUltrafast.browser.watchTheDecisionHappen')}</h2>
                  <p>
                    {t('jevUltrafast.browser.exploreASavedPageItsAvailableActions')}
                    <br />
                    {t('jevUltrafast.browser.andTheNextChoice')}
                  </p>
                  <PreviewButton primary onClick={begin}>
                    <Play size={15} />
                    {t('jevUltrafast.browser.exploreExample')}
                  </PreviewButton>
                </div>
              ) : (
                <div className={`ju-example-domain${step === 1 ? ' ju-example-domain--iana' : ''}`}>
                  <h2>{current.page}</h2>
                  <p>
                    {step === 0
                      ? t('jevUltrafast.browser.thisDomainIsForUseInIllustrative')
                      : t('jevUltrafast.browser.asDescribedInRfc2606AndRfc')}
                  </p>
                  {step === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(true);
                        setStep(1);
                      }}
                    >
                      {targets && <b className="ju-target">{'1'}</b>}
                      {t('jevUltrafast.browser.moreInformation')}
                    </button>
                  ) : (
                    <span className="ju-completed">
                      <Check size={16} />
                      {t('jevUltrafast.browser.exampleDestination')}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="ju-browser-footer">
              {t('jevUltrafast.browser.isolatedAutomationTab')}
              <span>{t('jevUltrafast.browser.savedPageNoLiveBrowser')}</span>
            </div>
          </section>
          <aside className="ju-choice">
            <h2>{t('jevUltrafast.choice.nextAction')}</h2>
            {started && chosen ? (
              <>
                <span className="ju-action">{current.action}</span>
                <h3>{current.target}</h3>
                <p>{current.detail}</p>
                <dl>
                  <dt>{t('jevUltrafast.choice.source')}</dt>
                  <dd>{t('jevUltrafast.choice.savedExample')}</dd>
                  <dt>{t('jevUltrafast.choice.target')}</dt>
                  <dd>
                    {step === 0
                      ? t('jevUltrafast.choice.link1')
                      : t('jevUltrafast.choice.goalReached')}
                  </dd>
                </dl>
              </>
            ) : (
              <>
                <MousePointer2 size={26} />
                <h3>
                  {started
                    ? t('jevUltrafast.choice.pageObserved')
                    : t('jevUltrafast.choice.waitingForAPage')}
                </h3>
                <p>
                  {started
                    ? t('jevUltrafast.choice.chooseNextToInspectTheExampleDecision')
                    : t('jevUltrafast.choice.startTheExampleToInspectItsAction')}
                </p>
              </>
            )}
          </aside>
        </div>
        {started && (
          <section className="ju-history">
            <h2>{t('jevUltrafast.history.stepHistory')}</h2>
            <div>
              <span>{'1'}</span>
              <p>{t('jevUltrafast.history.observeExampleCom')}</p>
              <code>
                {step === 0
                  ? t('jevUltrafast.history.observe')
                  : t('jevUltrafast.history.clickMoreInformation')}
              </code>
            </div>
            {step === 1 && (
              <div>
                <span>{'2'}</span>
                <p>{t('jevUltrafast.history.openTheInformationPage')}</p>
                <code>{t('jevUltrafast.history.done')}</code>
              </div>
            )}
          </section>
        )}
      </main>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
