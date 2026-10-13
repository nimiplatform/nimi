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

const SCENES = [
  {
    name: '启程',
    image: '/demo/storybook/train.jpg',
    text: '从一张车票开始，去听一听远方的声音。',
    duration: 6,
  },
  {
    name: '抵达海港',
    image: '/demo/storybook/harbor.jpg',
    text: '海风翻过旧码头，也翻开一个新的故事。',
    duration: 8,
  },
  {
    name: '留下片刻',
    image: '/demo/storybook/garden.jpg',
    text: '不必急着赶路，把这一刻留给自己。',
    duration: 6,
  },
];

/** OpenMontage's Backlot dark-room storyboard, cream screenplay and stage approval controls. */
export function DemoOpenMontagePreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [page, setPage] = useState('board');
  const [stage, setStage] = useState(3);
  const [selected, setSelected] = useState(0);
  const [script, setScript] = useState(() => pData(SCENES.map((s) => s.text)));
  const [brief, setBrief] = useState(() =>
    pData('为一次慢旅行制作一支短片。面向想暂时离开忙碌城市的观众，语气自然、温暖。'),
  );
  const [approved, setApproved] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <RemainingPreview content={content} kind="openmontage">
      <header className="om-masthead">
        <div>
          <Clapperboard size={25} />
          <strong>{pText('OPENMONTAGE')}</strong>
          <span>{pText('BACKLOT')}</span>
        </div>
        <nav aria-label={pText('制作导航')}>
          <button
            type="button"
            aria-pressed={page === 'library'}
            onClick={() => setPage('library')}
          >
            {pText('作品库')}
          </button>
          <button type="button" aria-pressed={page === 'board'} onClick={() => setPage('board')}>
            {pText('制作台')}
          </button>
          <button
            type="button"
            aria-label={pText('制作设置')}
            onClick={() => setSettings(!settings)}
          >
            <Settings2 size={17} />
          </button>
        </nav>
      </header>
      {settings && (
        <section className="om-settings">
          <label>
            {pText('示例流程')}
            <select defaultValue="旁白短片">
              <option value={'旁白短片'}>{pText('旁白短片')}</option>
              <option value={'已有素材剪辑'}>{pText('已有素材剪辑')}</option>
            </select>
          </label>
          <p>{pText('当前预览展示横向 720p 制作工作台；不运行媒体工具。')}</p>
        </section>
      )}
      <main className="om-main">
        {page === 'library' ? (
          <>
            <div className="rp-heading">
              <h1>{pText('你的制作现场')}</h1>
              <PreviewButton
                primary
                onClick={() => {
                  setPage('board');
                  setStage(0);
                }}
              >
                <Plus size={15} />
                {pText('新建示例项目')}
              </PreviewButton>
            </div>
            <button type="button" className="om-library-card" onClick={() => setPage('board')}>
              <img src="/demo/storybook/harbor.jpg" alt={pText('示例影片封面')} />
              <h2>{pText('把周末留给海风')}</h2>
              <p>{pText('3 个场景 · 20 秒 · 示例项目')}</p>
            </button>
          </>
        ) : (
          <>
            <div className="om-title">
              <div>
                <button type="button" onClick={() => setPage('library')}>
                  <ArrowLeft size={13} />
                  {pText('作品库')}
                </button>
                <h1>{pText('把周末留给海风')}</h1>
                <p>{pText('预设制作项目 · 横向 720p · 3 个场景')}</p>
              </div>
              <span className="om-status">
                {pText(approved ? pText('示例审阅已保留') : pText('示例方案 · 待审阅'))}
              </span>
            </div>
            <PreviewSteps
              steps={['材料', '方案', '剧本', '分镜', '制作', '成片']}
              active={stage}
              onSelect={setStage}
            />
            {stage < 2 ? (
              <section className="om-brief">
                <h2>{pText('从材料与意图开始')}</h2>
                <label>
                  {pText('表达的内容和观众')}
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
                    {pText('目标时长')}
                    <select defaultValue="20 秒">
                      <option value={'20 秒'}>{pText('20 秒')}</option>
                      <option value={'30 秒'}>{pText('30 秒')}</option>
                      <option value={'60 秒'}>{pText('60 秒')}</option>
                    </select>
                  </label>
                  <label>
                    {pText('画面形式')}
                    <select defaultValue="配图与素材混合">
                      <option value={'配图与素材混合'}>{pText('配图与素材混合')}</option>
                      <option value={'已有素材剪辑'}>{pText('已有素材剪辑')}</option>
                    </select>
                  </label>
                </div>
                <PreviewButton primary onClick={() => setStage(2)}>
                  {pText('查看预设剧本')}
                </PreviewButton>
              </section>
            ) : stage === 5 ? (
              <section className="om-final">
                <img src="/demo/storybook/harbor.jpg" alt={pText('示例成片画面')} />
                <div>
                  <h2>{pText('成片画面示意')}</h2>
                  <p>{pText('20 秒 · 1280 × 720')}</p>
                  <p>{pText('静态预览不生成或播放成片文件。')}</p>
                  <PreviewButton onClick={() => setStage(3)}>{pText('返回分镜')}</PreviewButton>
                </div>
              </section>
            ) : (
              <div className="om-workspace">
                <section className="om-script">
                  <div>
                    <FileText size={16} />
                    <span>
                      {pText('剧本 · 第 ')}
                      {pText(selected + 1)} {pText(' 场')}
                    </span>
                  </div>
                  <h2>{pText(SCENES[selected]!.name)}</h2>
                  <p className="om-scene-direction">
                    {pText('外景 · ')}
                    {pText(
                      selected === 0
                        ? pText('列车站台')
                        : selected === 1
                          ? pText('旧海港')
                          : pText('庭院'),
                    )}{' '}
                    {pText(' · 傍晚')}
                  </p>
                  <label>
                    {pText('旁白')}
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
                    {pText('预计时长：')}
                    {pText(SCENES[selected]!.duration)} {pText(' 秒 · 示例')}
                  </p>
                  <PreviewButton onClick={() => setApproved(true)}>
                    <Check size={14} />
                    {pText(approved ? pText('已保留本次示例审阅') : pText('保留本次示例审阅'))}
                  </PreviewButton>
                </section>
                <section className="om-board">
                  <div className="rp-section-heading">
                    <h2>
                      <Layers3 size={17} />
                      {pText('故事板')}
                    </h2>
                    <span>{pText('点击场景继续编辑')}</span>
                  </div>
                  <div className="om-scenes">
                    {SCENES.map((scene, i) => (
                      <button
                        type="button"
                        key={scene.name}
                        aria-label={pText(`审阅场景 ${i + 1}`)}
                        aria-pressed={selected === i}
                        onClick={() => setSelected(i)}
                      >
                        <div>
                          <img src={scene.image} alt={pText(`${scene.name}示例分镜`)} />
                          <span>
                            {pText('SC ')}
                            {pText(String(i + 1).padStart(2, '0'))} {pText(' · ')}
                            {pText(scene.duration)}
                            {pText('s')}
                          </span>
                        </div>
                        <h3>{pText(scene.name)}</h3>
                        <p>{script[i]}</p>
                      </button>
                    ))}
                  </div>
                  <section className="om-production">
                    <h2>{pText('制作决策')}</h2>
                    <div>
                      <span>{pText('声音与合成')}</span>
                      <strong>{pText('旁白短片 → 横向 720p')}</strong>
                    </div>
                    <div>
                      <span>{pText('状态')}</span>
                      <strong>{pText('预设示例，未提交生成任务')}</strong>
                    </div>
                    <PreviewButton primary onClick={() => setStage(5)}>
                      <Film size={15} />
                      {pText('查看成片示意')}
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
