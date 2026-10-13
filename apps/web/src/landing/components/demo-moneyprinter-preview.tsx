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
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [view, setView] = useState('创作');
  const [topic, setTopic] = useState<string>(() => pData(content.subject));
  const [script, setScript] = useState<string>(() => pData(content.script));
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
              {pText('MoneyPrinter')}
              <small>{pText('Turbo for Nimi')}</small>
            </strong>
          </div>
          <nav aria-label={pText('主导航')}>
            {[
              { label: '创作', Icon: Plus },
              { label: '制作记录', Icon: History },
              { label: 'AI 配置', Icon: SlidersHorizontal },
              { label: '业务设置', Icon: Settings },
            ].map(({ label, Icon }) => (
              <button
                type="button"
                aria-current={view === label ? 'page' : undefined}
                onClick={() => setView(label)}
                key={label}
              >
                <Icon size={17} />
                {pText(label)}
              </button>
            ))}
          </nav>
          <p className="mpt-rail-bottom">
            {pText('从一个故事开始。')}
            <br />
            <span>{pText('静态演示工作区')}</span>
          </p>
        </aside>
        <div className="mpt-body">
          <header className="mpt-topbar">
            <div>
              <h1>{pText(view === '创作' ? pText('新视频') : view)}</h1>
              <p>
                {pText(aspect)} {pText(' · 1 条 · 到成片')}
              </p>
            </div>
            {view === '创作' && (
              <div>
                <PreviewButton onClick={() => setSaved(true)}>
                  <FolderOpen size={15} />
                  {pText(saved ? pText('示例参数已保留') : pText('保存创作参数'))}
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
                  {pText('制作视频')}
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
                    {pText('脚本')}
                  </h2>
                  <label>
                    {pText('视频主题')}
                    <input
                      value={topic}
                      maxLength={200}
                      onChange={(event) => {
                        setTopic(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {pText('手工脚本')}
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
                      {pText('恢复示例脚本')}
                    </PreviewButton>
                    <span>
                      {script.length} {pText(' 字')}
                    </span>
                  </div>
                </section>
                <section>
                  <h2>
                    <Film size={18} />
                    {pText('画面与素材')}
                  </h2>
                  <div className="mpt-aspects" role="group" aria-label={pText('输出画幅')}>
                    {['9:16', '16:9', '1:1'].map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={aspect === value}
                        onClick={() => setAspect(value)}
                      >
                        <i style={{ aspectRatio: value.replace(':', '/') }} />
                        {pText(value)}
                      </button>
                    ))}
                  </div>
                  <label>
                    {pText('搜索关键词')}
                    <input defaultValue={pText(content.terms)} />
                  </label>
                  <ol className="mpt-materials">
                    {content.materials.map((file, index) => (
                      <li key={file}>
                        <span>{pText(index + 1)}</span>
                        <Film size={15} />
                        <span>{pText(file)}</span>
                        <small>{pText('示例素材')}</small>
                      </li>
                    ))}
                  </ol>
                </section>
                <section>
                  <h2>
                    <Mic size={18} />
                    {pText('配音')}
                  </h2>
                  <div className="tp-fields">
                    <label>
                      {pText('声音')}
                      <select defaultValue="温暖叙述者">
                        <option value={'温暖叙述者'}>{pText('温暖叙述者')}</option>
                        <option value={'明亮旁白'}>{pText('明亮旁白')}</option>
                      </select>
                    </label>
                    <label>
                      {pText('语速')}
                      <select defaultValue="自然">
                        <option value={'自然'}>{pText('自然')}</option>
                        <option value={'舒缓'}>{pText('舒缓')}</option>
                        <option value={'轻快'}>{pText('轻快')}</option>
                      </select>
                    </label>
                  </div>
                </section>
                <section>
                  <h2>
                    <Subtitles size={18} />
                    {pText('字幕')}
                  </h2>
                  <label className="tp-check">
                    <input
                      type="checkbox"
                      checked={subtitles}
                      onChange={(event) => {
                        setSubtitles(event.target.checked);
                      }}
                    />
                    {pText('启用字幕')}
                  </label>
                </section>
              </main>
              <aside className="mpt-result">
                <h2>{pText('制作与预览')}</h2>
                <PreviewSteps steps={content.stages} active={stage} onSelect={setStage} />
                <div className="mpt-poster" style={{ aspectRatio: aspect.replace(':', '/') }}>
                  <img src="/demo/storybook/harbor.jpg" alt={pText('示例海港画面')} />
                  <div>
                    {subtitles && <p>{pText('留一点时间，给风和自己。')}</p>}
                    <span>{pText(result ? pText('示例成片') : pText('画面预览 · 示例素材'))}</span>
                  </div>
                </div>
                <p className="mpt-result-caption">
                  {result ? (
                    <>
                      <Check size={15} />
                      {pText('已打开预设制作记录')}
                    </>
                  ) : (
                    pText('选择画幅、调整文案，再探索示例成片。')
                  )}
                </p>
                {result && (
                  <div className="mpt-artifacts">
                    <strong>{pText('示例输出')}</strong>
                    <span>{pText('final.mp4 · 00:18')}</span>
                    <span>{pText('subtitle.srt · 双语字幕')}</span>
                    <p>{pText('此预览不生成或下载文件。')}</p>
                  </div>
                )}
              </aside>
            </div>
          ) : view === '制作记录' ? (
            <main className="mpt-simple">
              <h2>{pText('已保存的任务')}</h2>
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
                  {pText(content.subject)}
                  <small>{pText('示例制作记录 · 9:16 · 18 秒')}</small>
                </span>
                <Check size={17} />
                {pText('查看')}
              </button>
            </main>
          ) : (
            <main className="mpt-simple">
              <h2>{pText(view)}</h2>
              <p>
                {pText(
                  view === 'AI 配置'
                    ? pText('在完整 App 中，通过 Nimi 选择文案、配音和图像模型。')
                    : pText('素材、字幕样式与输出偏好在完整 App 的业务设置中管理。'),
                )}
              </p>
              <label>
                {pText('示例输出语言')}
                <select defaultValue="中文">
                  <option value={'中文'}>{pText('中文')}</option>
                  <option value={'English'}>{pText('English')}</option>
                </select>
              </label>
              <PreviewButton onClick={() => setView('创作')}>{pText('返回创作')}</PreviewButton>
            </main>
          )}
        </div>
      </div>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
