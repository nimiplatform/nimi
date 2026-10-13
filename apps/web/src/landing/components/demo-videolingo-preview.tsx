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
  const { pText, previewLang } = useAppPreviewLocale();
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
            <img src="/demo/videolingo-icon.png" alt={pText('')} />
            <h1>{pText('VideoLingo')}</h1>
            <span className="tp-chip">{pText('示例工作区')}</span>
          </div>
          <PreviewButton onClick={() => setConfig(!config)}>
            <SlidersHorizontal size={15} />
            {pText('AI 配置')}
          </PreviewButton>
        </header>
        <nav className="vl-demo-navigation" aria-label={pText('工作区')}>
          {['视频翻译', '批量处理'].map((item) => (
            <PreviewButton key={item} primary={page === item} onClick={() => setPage(item)}>
              {pText(item)}
            </PreviewButton>
          ))}
        </nav>
        {config && (
          <section className="vl-demo-config">
            <h3>{pText('AI 配置')}</h3>
            <p>{pText('完整 App 通过 Nimi 选择语音识别、字幕翻译、声音创建和语音合成模型。')}</p>
            <PreviewButton onClick={() => setConfig(false)}>{pText('返回项目')}</PreviewButton>
          </section>
        )}
        {page === '批量处理' ? (
          <section className="vl-demo-batch">
            <h2>{pText('批量媒体任务')}</h2>
            <p>{pText('在完整 App 中，可从任务表导入并管理多个视频项目。')}</p>
            <table>
              <thead>
                <tr>
                  <th>{pText('项目')}</th>
                  <th>{pText('源语种')}</th>
                  <th>{pText('目标语种')}</th>
                  <th>{pText('示例状态')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{pText(content.project)}</td>
                  <td>{pText('English')}</td>
                  <td>{pText(target)}</td>
                  <td>{pText('字幕已校对')}</td>
                </tr>
                <tr>
                  <td>{pText('A walk through the city')}</td>
                  <td>{pText('English')}</td>
                  <td>{pText('简体中文')}</td>
                  <td>{pText('待开始')}</td>
                </tr>
              </tbody>
            </table>
            <PreviewButton onClick={() => setPage('视频翻译')}>
              {pText('查看示例项目')}
              <ChevronRight size={15} />
            </PreviewButton>
          </section>
        ) : (
          <div className="vl-demo-product">
            <aside className="vl-demo-library">
              <h2>{pText('项目')}</h2>
              <label>
                {pText('当前项目')}
                <select value={title} onChange={(event) => setTitle(event.target.value)}>
                  <option value={content.project}>{pText(content.project)}</option>
                  <option value={'城市漫步 · 示例项目'}>{pText('城市漫步 · 示例项目')}</option>
                </select>
              </label>
              <PreviewButton
                onClick={() => {
                  setStage(0);
                  setExportOpen(false);
                }}
              >
                <Plus size={15} />
                {pText('新媒体任务')}
              </PreviewButton>
              <hr />
              <PreviewButton
                className="vl-demo-settings-toggle"
                aria-expanded={settingsOpen}
                aria-controls={settingsId}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                {pText('处理设置 · ')}
                {pText(settingsOpen ? pText('收起') : pText('展开'))}
              </PreviewButton>
              <div
                id={settingsId}
                className="vl-demo-processing"
                data-mobile-expanded={settingsOpen}
              >
                <h3>{pText('处理设置')}</h3>
                <label>
                  {pText('源语言')}
                  <select defaultValue="English">
                    <option value={'English'}>{pText('English')}</option>
                    <option value={'自动检测'}>{pText('自动检测')}</option>
                  </select>
                </label>
                <label>
                  {pText('目标语言')}
                  <select value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value={'简体中文'}>{pText('简体中文')}</option>
                    <option value={'繁體中文'}>{pText('繁體中文')}</option>
                    <option value={'日本語'}>{pText('日本語')}</option>
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
                  {pText('忠实翻译后反思润色')}
                </label>
                <p className="tp-muted">{pText('示例字幕保持中英对照；语言选择仅演示配置。')}</p>
              </div>
            </aside>
            <main className="vl-demo-main">
              <div className="vl-demo-project-title">
                <div>
                  <h2>{pText(title)}</h2>
                  <p>
                    <FileVideo size={14} />
                    {pText(content.file)} {pText(' · 00:09')}
                  </p>
                </div>
                <span className="tp-chip">{pText('示例项目')}</span>
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
                  <h3>{pText('a. 下载或上传媒体')}</h3>
                  <div className="vl-demo-import">
                    <FileVideo size={34} />
                    <strong>{pText(content.file)}</strong>
                    <p>{pText('预设的海边短片 · 9 秒')}</p>
                    <PreviewButton primary onClick={() => setStage(1)}>
                      {pText('载入示例媒体')}
                    </PreviewButton>
                  </div>
                </section>
              ) : stage === 1 ? (
                <section className="vl-demo-stage">
                  <h3>{pText('b. 识别语音')}</h3>
                  <PreviewWaveform label={pText('示例音轨示意')} />
                  <p className="tp-muted">{pText('预设识别结果 · English · 3 段')}</p>
                  {content.subtitles.map((cue) => (
                    <div className="vl-demo-recognition" key={cue.time}>
                      <code>{pText(cue.time)}</code>
                      <p>{cue.source}</p>
                    </div>
                  ))}
                  <PreviewButton primary onClick={() => setStage(2)}>
                    {pText('查看示例翻译')}
                  </PreviewButton>
                </section>
              ) : stage === 2 ? (
                <section className="vl-demo-stage">
                  <div className="vl-demo-section-title">
                    <h3>
                      <Languages size={18} />
                      {pText('翻译与制作字幕')}
                    </h3>
                    <PreviewButton onClick={() => setExportOpen(!exportOpen)}>
                      <Subtitles size={15} />
                      {pText(exportOpen ? pText('收起 SRT 示例') : pText('查看 SRT 示例'))}
                    </PreviewButton>
                  </div>
                  <p className="tp-muted">
                    {pText('逐段核对原文与译文。你可以直接编辑示例字幕。')}
                  </p>
                  <div className="vl-demo-subtitle-head">
                    <span>{pText('原文 · English')}</span>
                    <span>{pText('译文 · 简体中文（示例）')}</span>
                  </div>
                  {content.subtitles.map((cue, index) => (
                    <div className="vl-demo-subtitle" key={cue.time}>
                      <code>{pText(cue.time)}</code>
                      <p>{cue.source}</p>
                      <textarea
                        aria-label={pText(`第 ${index + 1} 段译文`)}
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
                    <pre className="vl-demo-srt" aria-label={pText('SRT 字幕示例')}>
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
                      {pText('编辑仅在本次预览中保留')}
                    </span>
                    <PreviewButton primary onClick={() => setStage(3)}>
                      {pText('查看示例配音')}
                      <ChevronRight size={15} />
                    </PreviewButton>
                  </div>
                </section>
              ) : (
                <section className="vl-demo-stage">
                  <h3>{pText('c. 配音')}</h3>
                  <label>
                    {pText('声音')}
                    <select value={voice} onChange={(event) => setVoice(event.target.value)}>
                      <option value={'温暖叙述者'}>{pText('温暖叙述者')}</option>
                      <option value={'明亮旁白'}>{pText('明亮旁白')}</option>
                    </select>
                  </label>
                  <div className="vl-demo-poster">
                    <img src="/demo/storybook/harbor.jpg" alt={pText('示例海港画面')} />
                    <p>{translations[1]}</p>
                    <span>{pText('配音与字幕画面示意')}</span>
                  </div>
                  <PreviewWaveform label={pText('示例配音轨道示意')} />
                  <p className="tp-muted">
                    {pText(voice)} {pText(' · 配音与背景混合 · 示例结果')}
                  </p>
                  <PreviewButton onClick={() => setStage(2)}>{pText('返回字幕校对')}</PreviewButton>
                </section>
              )}
            </main>
          </div>
        )}
      </div>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
