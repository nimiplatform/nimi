import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { Activity, BookOpen, Bot, Layers3, Pause, Play, Settings2, Wallet } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewHeading, PreviewNav, RemainingPreview } from './demo-remaining-shared.js';

/** PolyAgent's teal operational desk. All markets and amounts below are fictional paper examples. */
export function DemoPolyagentPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('desk');
  const [running, setRunning] = useState(false);
  const [budget, setBudget] = useState(() => '100');
  const [selected, setSelected] = useState(0);
  const nav = [
    { id: 'desk', label: t('polyagent.workspace.workbench'), Icon: Activity },
    { id: 'positions', label: t('polyagent.workspace.positions'), Icon: Wallet },
    { id: 'orders', label: t('polyagent.workspace.orders'), Icon: Layers3 },
    { id: 'decisions', label: t('polyagent.workspace.researchAndDecisions'), Icon: BookOpen },
    { id: 'settings', label: t('polyagent.workspace.runSettings'), Icon: Settings2 },
  ];
  const markets = [
    {
      title: t('polyagent.workspace.sampleMarketAWillTheExhibition'),
      price: '0.72',
      volume: '1,200',
      status: t('polyagent.workspace.monitoring'),
    },
    {
      title: t('polyagent.workspace.sampleMarketBWillTheCommunity'),
      price: '0.64',
      volume: '860',
      status: t('polyagent.workspace.awaitingChecks'),
    },
    {
      title: t('polyagent.workspace.sampleMarketCWillTheNew'),
      price: '0.81',
      volume: '2,100',
      status: t('polyagent.workspace.constraintsUnmet'),
    },
  ];
  return (
    <RemainingPreview content={content} kind="polyagent">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={setView}
          footer={
            <>
              <Bot size={25} />
              <strong>{t('polyagent.workspace.sampleResearchAssistant')}</strong>
              <small>{t('polyagent.workspace.paperWorkspaceExperimental')}</small>
            </>
          }
        />
        <main className="rp-main rp-page">
          <PreviewHeading
            title={nav.find((x) => x.id === view)!.label}
            description={t('polyagent.main.turnMarketChangesIntoBoundedActions')}
          >
            <span className="pa-demo-mode">{t('polyagent.main.fictionalDataPaperTrading')}</span>
            <PreviewButton primary onClick={() => setRunning(!running)}>
              {running ? <Pause size={15} /> : <Play size={15} />}{' '}
              {running ? t('polyagent.main.pauseSample') : t('polyagent.main.runSample')}
            </PreviewButton>
          </PreviewHeading>
          {view === 'settings' ? (
            <section className="pa-demo-settings">
              <h2>{t('polyagent.demoSettings.setBoundariesBeforeStarting')}</h2>
              <label>
                {t('polyagent.demoSettings.paperFundingLimit')}
                <input
                  type="number"
                  min="0"
                  value={budget}
                  onChange={(e) => {
                    setBudget(e.target.value);
                  }}
                />
              </label>
              <label>
                {t('polyagent.demoSettings.researchAssistant')}
                <select defaultValue="示例研究助理">
                  <option value="示例研究助理">
                    {t('polyagent.demoSettings.sampleResearchAssistant')}
                  </option>
                </select>
              </label>
              <label>
                {t('polyagent.demoSettings.runMode')}
                <select value="paper" onChange={() => {}}>
                  <option value="paper">
                    {t('polyagent.demoSettings.staticSimulationNoTradingConnection')}
                  </option>
                </select>
              </label>
              <p>{t('polyagent.demoSettings.thisPreviewHasNoRealAccountsPrivate')}</p>
              <PreviewButton onClick={() => setView('desk')}>
                {t('polyagent.demoSettings.backToWorkbench')}
              </PreviewButton>
            </section>
          ) : view === 'desk' ? (
            <>
              <div className="pa-demo-status">
                <span className={running ? 'pa-demo-running' : ''} />
                <div>
                  <strong>
                    {running
                      ? t('polyagent.main.showingASampleRunningState')
                      : t('polyagent.main.samplePaused')}
                  </strong>
                  <p>{t('polyagent.main.thisStatusChangesOnlyOnThisPage')}</p>
                </div>
              </div>
              <div className="pa-demo-summary">
                <div>
                  <small>{t('polyagent.main.paperFundsAvailable')}</small>
                  <strong>
                    {Number(budget || 0).toFixed(2)} <span>{t('polyagent.main.usd')}</span>
                  </strong>
                </div>
                <div>
                  <small>{t('polyagent.main.paperPositions')}</small>
                  <strong>
                    {'1 '}
                    <span>{t('polyagent.main.records')}</span>
                  </strong>
                </div>
                <div>
                  <small>{t('polyagent.main.watchlist')}</small>
                  <strong>
                    {'3 '}
                    <span>{t('polyagent.main.fictionalMarkets')}</span>
                  </strong>
                </div>
              </div>
              <section className="pa-demo-markets">
                <div className="rp-section-heading">
                  <h2>{t('polyagent.demoMarkets.candidateMarkets')}</h2>
                  <span>{t('polyagent.demoMarkets.sampleSnapshot')}</span>
                </div>
                {markets.map((m, i) => (
                  <button
                    type="button"
                    key={m.title}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    <div>
                      <h3>{m.title}</h3>
                      <p>
                        {t('polyagent.demoMarkets.paperPrice')}
                        {m.price} {t('polyagent.demoMarkets.sampleVolume')}
                        {m.volume}
                      </p>
                    </div>
                    <span>{m.status}</span>
                  </button>
                ))}
              </section>
              <section className="pa-demo-decision">
                <h2>{markets[selected]!.title}</h2>
                <p>{t('polyagent.demoDecision.sampleResearchRecordCheckMarketRulesExpiry')}</p>
                <PreviewButton onClick={() => setView('decisions')}>
                  {t('polyagent.demoDecision.viewSampleResearchRecord')}
                </PreviewButton>
              </section>
            </>
          ) : view === 'decisions' ? (
            <section className="pa-demo-decision">
              <h2>{t('polyagent.demoDecision.keepTheFactsAndDecisionsFromThat')}</h2>
              <ol>
                <li>{t('polyagent.demoDecision.readTheFictionalSnapshotAndConfirmIts')}</li>
                <li>
                  {t('polyagent.demoDecision.checkStrategyConditionsFundingLimitsAndPerOrder')}
                </li>
                <li>{t('polyagent.demoDecision.sampleDecisionKeepObservingTakeNoReal')}</li>
              </ol>
              <p>{t('polyagent.demoDecision.aQuotedPriceIsNotAGuaranteed')}</p>
            </section>
          ) : (
            <section className="pa-demo-ledger">
              <h2>
                {view === 'orders'
                  ? t('polyagent.demoLedger.ordersAndFills')
                  : t('polyagent.demoLedger.currentPositions')}
              </h2>
              <div className="rp-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('polyagent.demoLedger.market')}</th>
                      <th>{t('polyagent.demoLedger.side')}</th>
                      <th>{t('polyagent.demoLedger.quantity')}</th>
                      <th>{t('polyagent.demoLedger.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{t('polyagent.demoLedger.sampleMarketA')}</td>
                      <td>{t('polyagent.demoLedger.yesSample')}</td>
                      <td>{'10'}</td>
                      <td>{t('polyagent.demoLedger.paperRecord')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>{t('polyagent.demoLedger.thisSavedLedgerDoesNotRepresentExchange')}</p>
            </section>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
