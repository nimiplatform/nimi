import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useId, useState } from 'react';
import {
  Check,
  ChevronRight,
  FileVideo,
  Languages,
  Plus,
  SlidersHorizontal,
  Subtitles,
} from 'lucide-react';
import type { VideoLingoPreviewContent } from '../content/landing-content.third-party.js';
import {
  PreviewButton,
  PreviewNotice,
  PreviewSteps,
  PreviewWaveform,
} from './demo-third-party-shared.js';

/** Replica of VideoLingo/src-component's project library, stage controls and subtitle review. */
export function DemoVideoLingoPreview({ content }: { content: VideoLingoPreviewContent }) {
  const { previewLang, t } = useAppPreviewLocale();
  const settingsId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState('视频翻译');
  const [stage, setStage] = useState(2);
  const [title, setTitle] = useState<string>(content.project);
  const [target, setTarget] = useState('简体中文');
  const [polish, setPolish] = useState(true);
  const [translations, setTranslations] = useState<string[]>(
    content.subtitles.map((cue) => cue.target),
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [config, setConfig] = useState(false);
  const [voice, setVoice] = useState('温暖叙述者');
  return (
    <div className="tp-preview videolingo-preview" data-demo-videolingo-root lang={previewLang}>
      <div className="vl-demo-workspace">
        <header className="vl-demo-header">
          <div>
            <img src="/demo/videolingo-icon.png" alt={''} />
            <h1>{t('videoLingo.demoHeader.videoLingo')}</h1>
            <span className="tp-chip">{t('videoLingo.demoHeader.sampleWorkspace')}</span>
          </div>
          <PreviewButton onClick={() => setConfig(!config)}>
            <SlidersHorizontal size={15} />
            {t('videoLingo.demoHeader.aiConfiguration')}
          </PreviewButton>
        </header>
        <nav className="vl-demo-navigation" aria-label={t('videoLingo.demoNavigation.workspaces')}>
          {['视频翻译', '批量处理'].map((item) => (
            <PreviewButton key={item} primary={page === item} onClick={() => setPage(item)}>
              {item === '批量处理'
                ? t('videoLingo.navigation.batch')
                : t('videoLingo.demoNavigation.videoTranslation')}
            </PreviewButton>
          ))}
        </nav>
        {config && (
          <section className="vl-demo-config">
            <h3>{t('videoLingo.demoConfig.aiConfiguration')}</h3>
            <p>{t('videoLingo.demoConfig.theFullAppUsesNimiToChoose')}</p>
            <PreviewButton onClick={() => setConfig(false)}>
              {t('videoLingo.demoConfig.backToProject')}
            </PreviewButton>
          </section>
        )}
        {page === '批量处理' ? (
          <section className="vl-demo-batch">
            <h2>{t('videoLingo.demoBatch.batchMediaTasks')}</h2>
            <p>{t('videoLingo.demoBatch.theFullAppCanImportATask')}</p>
            <table>
              <thead>
                <tr>
                  <th>{t('videoLingo.demoBatch.projects')}</th>
                  <th>{t('videoLingo.demoBatch.sourceLanguage')}</th>
                  <th>{t('videoLingo.demoBatch.targetLanguage')}</th>
                  <th>{t('videoLingo.demoBatch.sampleStatus')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{content.project}</td>
                  <td>{t('videoLingo.demoBatch.english')}</td>
                  <td>{target}</td>
                  <td>{t('videoLingo.demoBatch.subtitlesReviewed')}</td>
                </tr>
                <tr>
                  <td>{t('videoLingo.demoBatch.aWalkThroughTheCity')}</td>
                  <td>{t('videoLingo.demoBatch.english')}</td>
                  <td>{t('videoLingo.demoBatch.simplifiedChinese')}</td>
                  <td>{t('videoLingo.demoBatch.notStarted')}</td>
                </tr>
              </tbody>
            </table>
            <PreviewButton onClick={() => setPage('视频翻译')}>
              {t('videoLingo.demoBatch.viewSampleProject')}
              <ChevronRight size={15} />
            </PreviewButton>
          </section>
        ) : (
          <div className="vl-demo-product">
            <aside className="vl-demo-library">
              <h2>{t('videoLingo.demoLibrary.projects')}</h2>
              <label>
                {t('videoLingo.demoLibrary.currentProject')}
                <select value={title} onChange={(event) => setTitle(event.target.value)}>
                  <option value={content.project}>{content.project}</option>
                  <option value="城市漫步 · 示例项目">
                    {t('videoLingo.demoLibrary.cityWalkSampleProject')}
                  </option>
                </select>
              </label>
              <PreviewButton
                onClick={() => {
                  setStage(0);
                  setExportOpen(false);
                }}
              >
                <Plus size={15} />
                {t('videoLingo.demoLibrary.newMediaTask')}
              </PreviewButton>
              <hr />
              <PreviewButton
                className="vl-demo-settings-toggle"
                aria-expanded={settingsOpen}
                aria-controls={settingsId}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                {t('videoLingo.demoLibrary.processingSettings')}
                {settingsOpen
                  ? t('videoLingo.demoLibrary.collapse')
                  : t('videoLingo.demoLibrary.expand')}
              </PreviewButton>
              <div
                id={settingsId}
                className="vl-demo-processing"
                data-mobile-expanded={settingsOpen}
              >
                <h3>{t('videoLingo.demoLibrary.processingSettings2')}</h3>
                <label>
                  {t('videoLingo.demoLibrary.source')}
                  <select defaultValue="English">
                    <option value="English">{t('videoLingo.demoLibrary.english')}</option>
                    <option value="自动检测">{t('videoLingo.demoLibrary.autoDetect')}</option>
                  </select>
                </label>
                <label>
                  {t('videoLingo.demoLibrary.target')}
                  <select value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="简体中文">
                      {t('videoLingo.demoLibrary.simplifiedChinese')}
                    </option>
                    <option value="繁體中文">
                      {t('videoLingo.demoLibrary.traditionalChinese')}
                    </option>
                    <option value="日本語">{t('videoLingo.demoLibrary.japanese')}</option>
                  </select>
                </label>
                <label className="tp-check">
                  <input
                    type="checkbox"
                    checked={polish}
                    onChange={(event) => {
                      setPolish(event.target.checked);
                    }}
                  />
                  {t('videoLingo.demoLibrary.faithfulTranslationThenReviewAndPolish')}
                </label>
                <p className="tp-muted">
                  {t(
                    'videoLingo.demoLibrary.sampleSubtitlesStayBilingualLanguageChoicesDemonstrate',
                  )}
                </p>
              </div>
            </aside>
            <main className="vl-demo-main">
              <div className="vl-demo-project-title">
                <div>
                  <h2>{title}</h2>
                  <p>
                    <FileVideo size={14} />
                    {content.file} {' · 00:09'}
                  </p>
                </div>
                <span className="tp-chip">{t('videoLingo.demoMain.sampleProject')}</span>
              </div>
              <PreviewSteps
                steps={content.stages}
                active={stage}
                onSelect={(index) => {
                  setStage(index);
                  setExportOpen(false);
                }}
              />
              {stage === 0 ? (
                <section className="vl-demo-stage">
                  <h3>{t('videoLingo.demoStage.aDownloadOrUploadMedia')}</h3>
                  <div className="vl-demo-import">
                    <FileVideo size={34} />
                    <strong>{content.file}</strong>
                    <p>{t('videoLingo.demoStage.savedSeasideClip9Seconds')}</p>
                    <PreviewButton primary onClick={() => setStage(1)}>
                      {t('videoLingo.demoStage.loadSampleMedia')}
                    </PreviewButton>
                  </div>
                </section>
              ) : stage === 1 ? (
                <section className="vl-demo-stage">
                  <h3>{t('videoLingo.demoStage.bTranscribeSpeech')}</h3>
                  <PreviewWaveform label={t('videoLingo.demoStage.sampleAudioTrackIllustration')} />
                  <p className="tp-muted">
                    {t('videoLingo.demoStage.savedTranscriptEnglish3Segments')}
                  </p>
                  {content.subtitles.map((cue) => (
                    <div className="vl-demo-recognition" key={cue.time}>
                      <code>{cue.time}</code>
                      <p>{cue.source}</p>
                    </div>
                  ))}
                  <PreviewButton primary onClick={() => setStage(2)}>
                    {t('videoLingo.demoStage.viewSampleTranslation')}
                  </PreviewButton>
                </section>
              ) : stage === 2 ? (
                <section className="vl-demo-stage">
                  <div className="vl-demo-section-title">
                    <h3>
                      <Languages size={18} />
                      {t('videoLingo.demoStage.translateAndPrepareSubtitles')}
                    </h3>
                    <PreviewButton onClick={() => setExportOpen(!exportOpen)}>
                      <Subtitles size={15} />
                      {exportOpen
                        ? t('videoLingo.demoStage.hideSrtExample')
                        : t('videoLingo.demoStage.viewSrtExample')}
                    </PreviewButton>
                  </div>
                  <p className="tp-muted">
                    {t('videoLingo.demoStage.compareTheOriginalAndTranslationSegmentBy')}
                  </p>
                  <div className="vl-demo-subtitle-head">
                    <span>{t('videoLingo.demoStage.originalEnglish')}</span>
                    <span>{t('videoLingo.demoStage.translationSimplifiedChineseSample')}</span>
                  </div>
                  {content.subtitles.map((cue, index) => (
                    <div className="vl-demo-subtitle" key={cue.time}>
                      <code>{cue.time}</code>
                      <p>{cue.source}</p>
                      <textarea
                        aria-label={t('videoLingo.demoStage.translationSegment', {
                          index1: index + 1,
                        })}
                        value={translations[index]}
                        rows={2}
                        onChange={(event) => {
                          setTranslations((previous) =>
                            previous.map((value, cueIndex) =>
                              cueIndex === index ? event.target.value : value,
                            ),
                          );
                        }}
                      />
                    </div>
                  ))}
                  {exportOpen && (
                    <pre
                      className="vl-demo-srt"
                      aria-label={t('videoLingo.demoStage.srtSubtitleExample')}
                    >
                      {content.subtitles
                        .map(
                          (cue, index) =>
                            `${index + 1}\n${cue.time.replace(' → ', ',000 --> ')},000\n${translations[index]}`,
                        )
                        .join('\n\n')}
                    </pre>
                  )}
                  <div className="tp-inline">
                    <span>
                      <Check size={14} />
                      {t('videoLingo.demoStage.editsStayInThisPreview')}
                    </span>
                    <PreviewButton primary onClick={() => setStage(3)}>
                      {t('videoLingo.demoStage.viewSampleDubbing')}
                      <ChevronRight size={15} />
                    </PreviewButton>
                  </div>
                </section>
              ) : (
                <section className="vl-demo-stage">
                  <h3>{t('videoLingo.demoStage.cDubbing')}</h3>
                  <label>
                    {t('videoLingo.demoStage.voice')}
                    <select value={voice} onChange={(event) => setVoice(event.target.value)}>
                      <option value="温暖叙述者">{t('videoLingo.demoStage.warmNarrator')}</option>
                      <option value="明亮旁白">{t('videoLingo.demoStage.brightVoiceover')}</option>
                    </select>
                  </label>
                  <div className="vl-demo-poster">
                    <img
                      src="/demo/storybook/harbor.jpg"
                      alt={t('videoLingo.demoStage.sampleHarborScene')}
                    />
                    <p>{translations[1]}</p>
                    <span>{t('videoLingo.demoStage.illustrativeDubbingAndSubtitleFrame')}</span>
                  </div>
                  <PreviewWaveform
                    label={t('videoLingo.demoStage.sampleDubbingTrackIllustration')}
                  />
                  <p className="tp-muted">
                    {voice} {t('videoLingo.demoStage.voiceAndBackgroundMix')}
                  </p>
                  <PreviewButton onClick={() => setStage(2)}>
                    {t('videoLingo.demoStage.backToSubtitleReview')}
                  </PreviewButton>
                </section>
              )}
            </main>
          </div>
        )}
      </div>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
