import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  Check,
  FileText,
  Film,
  FolderOpen,
  History,
  Mic,
  Plus,
  Settings,
  SlidersHorizontal,
  Subtitles,
} from 'lucide-react';
import type { MoneyPrinterPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice, PreviewSteps } from './demo-third-party-shared.js';

/** Landing-owned port of MoneyPrinterTurbo/src/production/Studio's paper-and-green workbench. */
export function DemoMoneyPrinterPreview({ content }: { content: MoneyPrinterPreviewContent }) {
  const { previewLang, t } = useAppPreviewLocale();
  const navigationLabels: Record<string, string> = {
    创作: t('moneyPrinter.navigation.create'),
    制作记录: t('moneyPrinter.navigation.productionHistory'),
    'AI 配置': t('moneyPrinter.navigation.aiConfiguration'),
    应用设置: t('moneyPrinter.rail.appSettings'),
  };
  const [view, setView] = useState('创作');
  const [topic, setTopic] = useState<string>(() => content.subject);
  const [script, setScript] = useState<string>(() => content.script);
  const [aspect, setAspect] = useState('9:16');
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subtitles, setSubtitles] = useState(true);
  return (
    <div className="tp-preview moneyprinter-preview" data-demo-moneyprinter-root lang={previewLang}>
      <div className="mpt-layout">
        <aside className="mpt-rail">
          <div className="mpt-brand">
            <Film size={28} />
            <strong>
              {t('moneyPrinter.rail.moneyPrinter')}
              <small>{t('moneyPrinter.rail.turboForNimi')}</small>
            </strong>
          </div>
          <nav aria-label={t('moneyPrinter.rail.primaryNavigation')}>
            {[
              { label: '创作', Icon: Plus },
              { label: '制作记录', Icon: History },
              { label: 'AI 配置', Icon: SlidersHorizontal },
              { label: '应用设置', Icon: Settings },
            ].map(({ label, Icon }) => (
              <button
                type="button"
                aria-current={view === label ? 'page' : undefined}
                onClick={() => setView(label)}
                key={label}
              >
                <Icon size={17} />
                {navigationLabels[label] ?? label}
              </button>
            ))}
          </nav>
          <p className="mpt-rail-bottom">
            {t('moneyPrinter.rail.startWithAStory')}
            <br />
            <span>{t('moneyPrinter.rail.staticDemoWorkspace')}</span>
          </p>
        </aside>
        <div className="mpt-body">
          <header className="mpt-topbar">
            <div>
              <h1>
                {view === '创作'
                  ? t('moneyPrinter.topbar.newVideo')
                  : (navigationLabels[view] ?? view)}
              </h1>
              <p>
                {aspect} {t('moneyPrinter.topbar.1RecordFinalVideo')}
              </p>
            </div>
            {view === '创作' && (
              <div>
                <PreviewButton onClick={() => setSaved(true)}>
                  <FolderOpen size={15} />
                  {saved
                    ? t('moneyPrinter.topbar.sampleParametersKept')
                    : t('moneyPrinter.topbar.saveCreativeParameters')}
                </PreviewButton>
                <PreviewButton
                  primary
                  disabled={!topic.trim() || !script.trim()}
                  onClick={() => {
                    setResult(true);
                    setStage(4);
                  }}
                >
                  <Film size={16} />
                  {t('moneyPrinter.topbar.createVideo')}
                </PreviewButton>
              </div>
            )}
          </header>
          {view === '创作' ? (
            <div className="mpt-workspace">
              <main className="mpt-editor">
                <section>
                  <h2>
                    <FileText size={18} />
                    {t('moneyPrinter.editor.script')}
                  </h2>
                  <label>
                    {t('moneyPrinter.editor.videoTopic')}
                    <input
                      value={topic}
                      maxLength={200}
                      onChange={(event) => {
                        setTopic(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t('moneyPrinter.editor.manualScript')}
                    <textarea
                      rows={5}
                      value={script}
                      maxLength={2000}
                      onChange={(event) => {
                        setScript(event.target.value);
                      }}
                    />
                  </label>
                  <div className="tp-inline">
                    <PreviewButton onClick={() => setScript(content.script)}>
                      {t('moneyPrinter.editor.restoreSampleScript')}
                    </PreviewButton>
                    <span>
                      {script.length} {t('moneyPrinter.editor.characters')}
                    </span>
                  </div>
                </section>
                <section>
                  <h2>
                    <Film size={18} />
                    {t('moneyPrinter.editor.visualsAndMedia')}
                  </h2>
                  <div
                    className="mpt-aspects"
                    role="group"
                    aria-label={t('moneyPrinter.editor.outputFormat')}
                  >
                    {['9:16', '16:9', '1:1'].map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={aspect === value}
                        onClick={() => setAspect(value)}
                      >
                        <i style={{ aspectRatio: value.replace(':', '/') }} />
                        {value}
                      </button>
                    ))}
                  </div>
                  <label>
                    {t('moneyPrinter.editor.searchKeywords')}
                    <input defaultValue={content.terms} />
                  </label>
                  <ol className="mpt-materials">
                    {content.materials.map((file, index) => (
                      <li key={file}>
                        <span>{index + 1}</span>
                        <Film size={15} />
                        <span>{file}</span>
                        <small>{t('moneyPrinter.editor.sampleMedia')}</small>
                      </li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h2>
                    <Mic size={18} />
                    {t('moneyPrinter.editor.dub')}
                  </h2>
                  <div className="tp-fields">
                    <label>
                      {t('moneyPrinter.editor.voice')}
                      <select defaultValue="温暖叙述者">
                        <option value="温暖叙述者">{t('moneyPrinter.editor.warmNarrator')}</option>
                        <option value="明亮旁白">{t('moneyPrinter.editor.brightVoiceover')}</option>
                      </select>
                    </label>
                    <label>
                      {t('moneyPrinter.editor.speed')}
                      <select defaultValue="自然">
                        <option value="自然">{t('moneyPrinter.editor.natural')}</option>
                        <option value="舒缓">{t('moneyPrinter.editor.soothing')}</option>
                        <option value="轻快">{t('moneyPrinter.editor.light')}</option>
                      </select>
                    </label>
                  </div>
                </section>
                <section>
                  <h2>
                    <Subtitles size={18} />
                    {t('moneyPrinter.editor.subtitles')}
                  </h2>
                  <label className="tp-check">
                    <input
                      type="checkbox"
                      checked={subtitles}
                      onChange={(event) => {
                        setSubtitles(event.target.checked);
                      }}
                    />
                    {t('moneyPrinter.editor.enableSubtitles')}
                  </label>
                </section>
              </main>
              <aside className="mpt-result">
                <h2>{t('moneyPrinter.result.productionAndPreview')}</h2>
                <PreviewSteps steps={content.stages} active={stage} onSelect={setStage} />
                <div className="mpt-poster" style={{ aspectRatio: aspect.replace(':', '/') }}>
                  <img
                    src="/demo/storybook/harbor.jpg"
                    alt={t('moneyPrinter.result.sampleHarborScene')}
                  />
                  <div>
                    {subtitles && <p>{t('moneyPrinter.result.leaveALittleTimeForTheBreeze')}</p>}
                    <span>
                      {result
                        ? t('moneyPrinter.result.sampleFinalVideo')
                        : t('moneyPrinter.result.visualPreviewSampleMedia')}
                    </span>
                  </div>
                </div>
                <p className="mpt-result-caption">
                  {result ? (
                    <>
                      <Check size={15} />
                      {t('moneyPrinter.result.savedProductionExampleOpened')}
                    </>
                  ) : (
                    t('moneyPrinter.result.chooseAFormatAdjustTheScriptAnd')
                  )}
                </p>
                {result && (
                  <div className="mpt-artifacts">
                    <strong>{t('moneyPrinter.result.sampleOutput')}</strong>
                    <span>{t('moneyPrinter.result.finalMp40018')}</span>
                    <span>{t('moneyPrinter.result.subtitleSrtBilingualSubtitles')}</span>
                    <p>{t('moneyPrinter.result.thisPreviewDoesNotGenerateOrDownload')}</p>
                  </div>
                )}
              </aside>
            </div>
          ) : view === '制作记录' ? (
            <main className="mpt-simple">
              <h2>{t('moneyPrinter.simple.savedTasks')}</h2>
              <button
                type="button"
                className="mpt-history-row"
                onClick={() => {
                  setView('创作');
                  setResult(true);
                  setStage(4);
                }}
              >
                <Film size={21} />
                <span>
                  {content.subject}
                  <small>{t('moneyPrinter.simple.sampleProductionRecord91618')}</small>
                </span>
                <Check size={17} />
                {t('moneyPrinter.simple.view')}
              </button>
            </main>
          ) : (
            <main className="mpt-simple">
              <h2>{navigationLabels[view]}</h2>
              <p>
                {view === 'AI 配置'
                  ? t('moneyPrinter.simple.inTheFullAppChooseTextVoice')
                  : t('moneyPrinter.simple.manageMediaSubtitleStylesAndOutputPreferences')}
              </p>
              <label>
                {t('moneyPrinter.simple.sampleOutputLanguage')}
                <select defaultValue="中文">
                  <option value="中文">{t('moneyPrinter.simple.chinese')}</option>
                  <option value="English">{t('moneyPrinter.simple.english')}</option>
                </select>
              </label>
              <PreviewButton onClick={() => setView('创作')}>
                {t('moneyPrinter.simple.backToCreation')}
              </PreviewButton>
            </main>
          )}
        </div>
      </div>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
