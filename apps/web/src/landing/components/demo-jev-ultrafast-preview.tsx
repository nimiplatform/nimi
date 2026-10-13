import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { ArrowUpRight, Check, MousePointer2, Play, RotateCcw, Square } from 'lucide-react';
import type { JevUltrafastPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice } from './demo-third-party-shared.js';

/** Replica of jev_ultrafast/static/index.html's task, browser, choice and history panels. */
export function DemoJevUltrafastPreview({ content }: { content: JevUltrafastPreviewContent }) {
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [goal, setGoal] = useState<string>(() => pData(content.goal));
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
          {pText('browser')}
          <span>{pText('use')}</span>
          <i>{pText('×')}</i>
          {pText('Nimi')}
        </strong>
        <span>
          <i className="ju-dot" />
          {pText('Jev Ultrafast')}
        </span>
      </header>
      <main className="ju-main">
        <div className="ju-intro">
          <h1>{pText(content.title)}</h1>
          <p>{pText(content.description)}</p>
        </div>
        <form
          className="ju-task"
          onSubmit={(event) => {
            event.preventDefault();
            begin();
          }}
        >
          <label htmlFor="ju-demo-goal">{pText('Give it a task')}</label>
          <div className="ju-url">
            <span>{pText('Start URL')}</span>
            <code>{pText('https://example.com')}</code>
            <span className="tp-chip">{pText('Saved example')}</span>
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
              {pText('Start')}
              <ArrowUpRight size={17} />
            </PreviewButton>
          </div>
        </form>
        <div className="ju-toolbar">
          <span role="status">
            <i className="ju-dot" />
            {pText(
              !started
                ? 'Ready to explore the example'
                : stopped
                  ? 'Example stopped'
                  : step === 1
                    ? 'Destination reached · example'
                    : 'Example page observed',
            )}
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
              {pText('Targets')}
            </label>
            <PreviewButton
              disabled={!started || stopped || step === 1}
              onClick={() => setChosen(true)}
            >
              {pText('Choose next')}
            </PreviewButton>
            <PreviewButton
              disabled={!chosen || stopped || step === 1}
              onClick={() => {
                setStep(1);
                setChosen(true);
              }}
            >
              {pText('Execute choice')}
            </PreviewButton>
            {started && !stopped && step === 0 ? (
              <PreviewButton aria-label={pText('Stop example')} onClick={() => setStopped(true)}>
                <Square size={13} />
                {pText('Stop')}
              </PreviewButton>
            ) : (
              <PreviewButton
                aria-label={pText('Reset example')}
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
              <span>{pText(started ? current.url : 'Dedicated automation browser')}</span>
              <b>{pText('SAMPLE')}</b>
            </div>
            <div className="ju-viewport">
              {!started ? (
                <div className="ju-empty">
                  <MousePointer2 size={34} />
                  <h2>{pText('Watch the decision happen.')}</h2>
                  <p>
                    {pText('Explore a saved page, its available actions,')}
                    <br />
                    {pText('and the next choice.')}
                  </p>
                  <PreviewButton primary onClick={begin}>
                    <Play size={15} />
                    {pText('Explore example')}
                  </PreviewButton>
                </div>
              ) : (
                <div className={`ju-example-domain${step === 1 ? ' ju-example-domain--iana' : ''}`}>
                  <h2>{pText(current.page)}</h2>
                  <p>
                    {pText(
                      step === 0
                        ? 'This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.'
                        : 'As described in RFC 2606 and RFC 6761, a number of domains such as example.com and example.org are maintained for documentation purposes.',
                    )}
                  </p>
                  {step === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(true);
                        setStep(1);
                      }}
                    >
                      {targets && <b className="ju-target">{pText('1')}</b>}
                      {pText('More information…')}
                    </button>
                  ) : (
                    <span className="ju-completed">
                      <Check size={16} />
                      {pText('Example destination')}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="ju-browser-footer">
              {pText('Isolated automation tab')}
              <span>{pText('Saved page · no live browser')}</span>
            </div>
          </section>
          <aside className="ju-choice">
            <h2>{pText('Next action')}</h2>
            {started && chosen ? (
              <>
                <span className="ju-action">{pText(current.action)}</span>
                <h3>{pText(current.target)}</h3>
                <p>{pText(current.detail)}</p>
                <dl>
                  <dt>{pText('Source')}</dt>
                  <dd>{pText('Saved example')}</dd>
                  <dt>{pText('Target')}</dt>
                  <dd>{pText(step === 0 ? 'Link 1' : 'Goal reached')}</dd>
                </dl>
              </>
            ) : (
              <>
                <MousePointer2 size={26} />
                <h3>{pText(started ? 'Page observed' : 'Waiting for a page')}</h3>
                <p>
                  {pText(
                    started
                      ? 'Choose next to inspect the example decision.'
                      : 'Start the example to inspect its action sequence.',
                  )}
                </p>
              </>
            )}
          </aside>
        </div>
        {started && (
          <section className="ju-history">
            <h2>{pText('Step history')}</h2>
            <div>
              <span>{pText('1')}</span>
              <p>{pText('Observe example.com')}</p>
              <code>{pText(step === 0 ? 'OBSERVE' : 'CLICK → More information…')}</code>
            </div>
            {step === 1 && (
              <div>
                <span>{pText('2')}</span>
                <p>{pText('Open the information page')}</p>
                <code>{pText('DONE')}</code>
              </div>
            )}
          </section>
        )}
      </main>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
