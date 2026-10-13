import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  FileText,
  Film,
  Layers3,
  Plus,
  Settings2,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton, PreviewSteps } from './demo-third-party-shared.js';
import { RemainingPreview } from './demo-remaining-shared.js';

const createSampleScenes = (t: PreviewTranslate) => [
  {
    name: t('openmontage.workspace.departure'),
    image: '/demo/storybook/train.jpg',
    text: t('openmontage.workspace.beginWithATicketAndListenFor'),
    duration: 6,
  },
  {
    name: t('openmontage.workspace.arrivingAtTheHarbor'),
    image: '/demo/storybook/harbor.jpg',
    text: t('openmontage.workspace.seaBreezeTurnsAPageOverThe'),
    duration: 8,
  },
  {
    name: t('openmontage.workspace.keepAMoment'),
    image: '/demo/storybook/garden.jpg',
    text: t('openmontage.workspace.noNeedToHurryKeepThisMoment'),
    duration: 6,
  },
];

/** OpenMontage's Backlot dark-room storyboard, cream screenplay and stage approval controls. */
export function DemoOpenMontagePreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [page, setPage] = useState('board');
  const [stage, setStage] = useState(3);
  const [selected, setSelected] = useState(0);
  const [script, setScript] = useState(() => createSampleScenes(t).map((s) => s.text));
  const [brief, setBrief] = useState(() =>
    t('openmontage.workspace.makeAShortFilmAboutSlowTravel'),
  );
  const [approved, setApproved] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <RemainingPreview content={content} kind="openmontage">
      <header className="om-masthead">
        <div>
          <Clapperboard size={25} />
          <strong>{t('openmontage.masthead.openmontage')}</strong>
          <span>{t('openmontage.masthead.backlot')}</span>
        </div>
        <nav aria-label={t('openmontage.masthead.productionNavigation')}>
          <button
            type="button"
            aria-pressed={page === 'library'}
            onClick={() => setPage('library')}
          >
            {t('openmontage.masthead.library')}
          </button>
          <button type="button" aria-pressed={page === 'board'} onClick={() => setPage('board')}>
            {t('openmontage.masthead.productionDesk')}
          </button>
          <button
            type="button"
            aria-label={t('openmontage.masthead.productionSettings')}
            onClick={() => setSettings(!settings)}
          >
            <Settings2 size={17} />
          </button>
        </nav>
      </header>
      {settings && (
        <section className="om-settings">
          <label>
            {t('openmontage.settings.sampleWorkflow')}
            <select defaultValue="旁白短片">
              <option value="旁白短片">{t('openmontage.settings.narratedShortFilm')}</option>
              <option value="已有素材剪辑">{t('openmontage.settings.editExistingMedia')}</option>
            </select>
          </label>
          <p>{t('openmontage.settings.thisPreviewShowsALandscape720pProduction')}</p>
        </section>
      )}
      <main className="om-main">
        {page === 'library' ? (
          <>
            <div className="rp-heading">
              <h1>{t('openmontage.main.yourProductionSpace')}</h1>
              <PreviewButton
                primary
                onClick={() => {
                  setPage('board');
                  setStage(0);
                }}
              >
                <Plus size={15} />
                {t('openmontage.main.newSampleProject')}
              </PreviewButton>
            </div>
            <button type="button" className="om-library-card" onClick={() => setPage('board')}>
              <img src="/demo/storybook/harbor.jpg" alt={t('openmontage.main.sampleFilmCover')} />
              <h2>{t('openmontage.main.leaveTheWeekendToTheSeaBreeze')}</h2>
              <p>{t('openmontage.main.3Scenes20SecondsSample')}</p>
            </button>
          </>
        ) : (
          <>
            <div className="om-title">
              <div>
                <button type="button" onClick={() => setPage('library')}>
                  <ArrowLeft size={13} />
                  {t('openmontage.main.library')}
                </button>
                <h1>{t('openmontage.main.leaveTheWeekendToTheSeaBreeze')}</h1>
                <p>{t('openmontage.main.savedProductionProjectLandscape720p')}</p>
              </div>
              <span className="om-status">
                {approved
                  ? t('openmontage.main.sampleReviewKept')
                  : t('openmontage.main.samplePlanAwaitingReview')}
              </span>
            </div>
            <PreviewSteps
              steps={[
                t('openmontage.main.materials'),
                t('openmontage.main.plan'),
                t('openmontage.main.screenplay'),
                t('openmontage.main.shots'),
                t('openmontage.main.production'),
                t('openmontage.main.finalVideo'),
              ]}
              active={stage}
              onSelect={setStage}
            />
            {stage < 2 ? (
              <section className="om-brief">
                <h2>{t('openmontage.brief.startWithMaterialAndIntent')}</h2>
                <label>
                  {t('openmontage.brief.messageAndAudience')}
                  <textarea
                    rows={5}
                    value={brief}
                    onChange={(e) => {
                      setBrief(e.target.value);
                      setApproved(false);
                    }}
                  />
                </label>
                <div className="tp-fields">
                  <label>
                    {t('openmontage.brief.targetDuration')}
                    <select defaultValue="20 秒">
                      <option value="20 秒">{t('openmontage.brief.20Seconds')}</option>
                      <option value="30 秒">{t('openmontage.brief.30Seconds')}</option>
                      <option value="60 秒">{t('openmontage.brief.60Seconds')}</option>
                    </select>
                  </label>
                  <label>
                    {t('openmontage.brief.visualFormat')}
                    <select defaultValue="配图与素材混合">
                      <option value="配图与素材混合">
                        {t('openmontage.brief.illustrationsMixedWithMedia')}
                      </option>
                      <option value="已有素材剪辑">
                        {t('openmontage.brief.editExistingMedia')}
                      </option>
                    </select>
                  </label>
                </div>
                <PreviewButton primary onClick={() => setStage(2)}>
                  {t('openmontage.brief.viewSavedScreenplay')}
                </PreviewButton>
              </section>
            ) : stage === 5 ? (
              <section className="om-final">
                <img
                  src="/demo/storybook/harbor.jpg"
                  alt={t('openmontage.final.sampleOutputScene')}
                />
                <div>
                  <h2>{t('openmontage.final.illustrativeFinalFrame')}</h2>
                  <p>{t('openmontage.final.20Seconds1280720')}</p>
                  <p>{t('openmontage.final.thisStaticPreviewDoesNotGenerateOr')}</p>
                  <PreviewButton onClick={() => setStage(3)}>
                    {t('openmontage.final.backToStoryboard')}
                  </PreviewButton>
                </div>
              </section>
            ) : (
              <div className="om-workspace">
                <section className="om-script">
                  <div>
                    <FileText size={16} />
                    <span>
                      {t('openmontage.script.screenplayScene')}
                      {selected + 1} {t('openmontage.script.label')}
                    </span>
                  </div>
                  <h2>{createSampleScenes(t)[selected]!.name}</h2>
                  <p className="om-scene-direction">
                    {t('openmontage.script.exterior')}
                    {selected === 0
                      ? t('openmontage.script.trainPlatform')
                      : selected === 1
                        ? t('openmontage.script.oldHarbor')
                        : t('openmontage.script.courtyard')}{' '}
                    {t('openmontage.script.evening')}
                  </p>
                  <label>
                    {t('openmontage.script.narrator')}
                    <textarea
                      rows={5}
                      value={script[selected]}
                      onChange={(e) => {
                        setScript((v) => v.map((x, i) => (i === selected ? e.target.value : x)));
                        setApproved(false);
                      }}
                    />
                  </label>
                  <p>
                    {t('openmontage.script.estimatedDuration')}
                    {createSampleScenes(t)[selected]!.duration} {t('openmontage.script.secondsSample')}
                  </p>
                  <PreviewButton onClick={() => setApproved(true)}>
                    <Check size={14} />
                    {approved
                      ? t('openmontage.script.sampleReviewKept')
                      : t('openmontage.script.keepThisSampleReview')}
                  </PreviewButton>
                </section>
                <section className="om-board">
                  <div className="rp-section-heading">
                    <h2>
                      <Layers3 size={17} />
                      {t('openmontage.board.storyboard')}
                    </h2>
                    <span>{t('openmontage.board.chooseASceneToContinueEditing')}</span>
                  </div>
                  <div className="om-scenes">
                    {createSampleScenes(t).map((scene, i) => (
                      <button
                        type="button"
                        key={scene.name}
                        aria-label={t('openmontage.board.reviewScene', { i1: i + 1 })}
                        aria-pressed={selected === i}
                        onClick={() => setSelected(i)}
                      >
                        <div>
                          <img
                            src={scene.image}
                            alt={t('openmontage.board.sampleShot', { sceneName: scene.name })}
                          />
                          <span>
                            {t('openmontage.board.sc')}
                            {String(i + 1).padStart(2, '0')} {' · '}
                            {scene.duration}
                            {t('openmontage.board.s')}
                          </span>
                        </div>
                        <h3>{scene.name}</h3>
                        <p>{script[i]}</p>
                      </button>
                    ))}
                  </div>
                  <section className="om-production">
                    <h2>{t('openmontage.production.productionDecisions')}</h2>
                    <div>
                      <span>{t('openmontage.production.voiceAndComposition')}</span>
                      <strong>{t('openmontage.production.narratedShortLandscape720p')}</strong>
                    </div>
                    <div>
                      <span>{t('openmontage.production.status')}</span>
                      <strong>
                        {t('openmontage.production.savedExampleNoGenerationTaskSubmitted')}
                      </strong>
                    </div>
                    <PreviewButton primary onClick={() => setStage(5)}>
                      <Film size={15} />
                      {t('openmontage.production.viewIllustrativeOutput')}
                    </PreviewButton>
                  </section>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </RemainingPreview>
  );
}
