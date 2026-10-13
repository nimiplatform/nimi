import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { ArrowRight, Check, FileText, Music2, SlidersHorizontal, Star } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton, PreviewWaveform } from './demo-third-party-shared.js';
import { PreviewTabs, RemainingPreview } from './demo-remaining-shared.js';

/** Overtone's paper composer, blue direction choices, take library and persistent player rail. */
export function DemoOvertonePreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [prompt, setPrompt] = useState(() =>
    pData('一段适合雨后散步的音乐，轻盈、温暖，带一点城市的节奏。'),
  );
  const [direction, setDirection] = useState('雨后慢行');
  const [stage, setStage] = useState('探索方向');
  const [takes, setTakes] = useState(false);
  const [favorite, setFavorite] = useState(0);
  const [compare, setCompare] = useState(false);
  const [lyrics, setLyrics] = useState(() =>
    pData(
      '[Verse]\n街角的灯，映着雨的余温\n脚步轻轻，把忙碌留给黄昏\n\n[Chorus]\n让风慢一点，让心远一点',
    ),
  );
  const [settings, setSettings] = useState(false);
  const [soundImagery, setSoundImagery] = useState(() =>
    pData('雨后的街道，轻快的脚步，一点温暖的灯光'),
  );
  const [duration, setDuration] = useState('30 秒');
  const [creationMode, setCreationMode] = useState('纯音乐');
  const directions = [
    {
      name: '雨后慢行',
      genre: 'Lo-fi / Jazz',
      description: '柔和键盘、轻鼓与留白，像一次不赶时间的散步。',
    },
    {
      name: '霓虹回声',
      genre: 'Indie / Electronic',
      description: '干净的合成器与轻快律动，让城市在耳边亮起来。',
    },
    {
      name: '窗边午后',
      genre: 'Acoustic / Folk',
      description: '原声吉他与温暖人声，安静但不单薄。',
    },
  ];
  return (
    <RemainingPreview content={content} kind="overtone">
      <header className="ot-demo-masthead">
        <div>
          <Music2 size={27} />
          <strong>{pText('OVERTONE')}</strong>
          <span>{pText('把灵感，变成声音。')}</span>
        </div>
        <PreviewButton onClick={() => setSettings(!settings)}>
          <SlidersHorizontal size={16} />
          {pText('创作设置')}
        </PreviewButton>
      </header>
      {settings && (
        <div className="ot-demo-settings">
          <label>
            {pText('音轨时长')}
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value={'30 秒'}>{pText('30 秒')}</option>
              <option value={'60 秒'}>{pText('60 秒')}</option>
            </select>
          </label>
          <label>
            {pText('创作模式')}
            <select value={creationMode} onChange={(e) => setCreationMode(e.target.value)}>
              <option value={'纯音乐'}>{pText('纯音乐')}</option>
              <option value={'包含歌词'}>{pText('包含歌词')}</option>
            </select>
          </label>
          <p>{pText('静态预览中的候选不会随模型配置变化。')}</p>
        </div>
      )}
      <div className="ot-demo-workspace">
        <main className="ot-demo-composer">
          <PreviewTabs
            items={['探索方向', '写成一首歌']}
            value={stage}
            onChange={setStage}
            label={pText('创作阶段')}
          />
          {stage === '探索方向' ? (
            <>
              <h1>{pText('你想听见什么？')}</h1>
              <div className="ot-demo-prompt">
                <textarea
                  aria-label={pText('音乐灵感')}
                  rows={3}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                  }}
                />
                <div>
                  <span>
                    <Music2 size={14} />
                    {pText('从一句灵感开始')}
                  </span>
                  <PreviewButton primary disabled={!prompt.trim()} onClick={() => setTakes(true)}>
                    {pText('查看示例方向')}
                    <ArrowRight size={16} />
                  </PreviewButton>
                </div>
              </div>
              <div className="rp-section-heading">
                <h2>{pText('三个方向，听见不同可能')}</h2>
                <span>{pText('预设示例')}</span>
              </div>
              <div className="ot-demo-directions">
                {directions.map((d) => (
                  <button
                    type="button"
                    key={d.name}
                    aria-pressed={direction === d.name}
                    onClick={() => {
                      setDirection(d.name);
                      setTakes(true);
                    }}
                  >
                    <span>{pText(d.genre)}</span>
                    <h3>{pText(d.name)}</h3>
                    <p>{pText(d.description)}</p>
                    <strong>
                      {pText(direction === d.name ? pText('当前方向') : pText('沿这个方向探索'))}
                      <ArrowRight size={14} />
                    </strong>
                  </button>
                ))}
              </div>
              <section className="ot-demo-notebook">
                <h2>
                  <FileText size={18} />
                  {pText('创作笔记')}
                </h2>
                <label>
                  {pText('声音意象')}
                  <input
                    value={soundImagery}
                    onChange={(e) => {
                      setSoundImagery(e.target.value);
                    }}
                  />
                </label>
              </section>
            </>
          ) : (
            <>
              <h1>{pText('把灵感写成一首歌')}</h1>
              <p className="tp-muted">
                {pText('方向：')}
                {pText(direction)} {pText(' · 示例歌曲结构')}
              </p>
              <label>
                {pText('歌词')}
                <textarea
                  aria-label={pText('歌曲歌词')}
                  rows={10}
                  value={lyrics}
                  onChange={(e) => {
                    setLyrics(e.target.value);
                  }}
                />
              </label>
              <div className="ot-demo-song-sections">
                {['Intro', 'Verse', 'Chorus', 'Outro'].map((x) => (
                  <span key={x}>{pText(x)}</span>
                ))}
              </div>
              <PreviewButton primary onClick={() => setTakes(true)}>
                {pText('查看示例候选')}
              </PreviewButton>
            </>
          )}
        </main>
        <aside className="ot-demo-takes">
          <div className="rp-section-heading">
            <h2>{pText('候选音轨')}</h2>
            <span>{pText(takes ? '2' : '0')}</span>
          </div>
          {takes ? (
            <>
              {['轻盈版本', '更温暖的版本'].map((name, i) => (
                <article key={name}>
                  <div>
                    <span>
                      {pText('TAKE ')}
                      {pText(String(i + 1).padStart(2, '0'))}
                    </span>
                    <button
                      type="button"
                      aria-label={pText(`收藏${name}`)}
                      aria-pressed={favorite === i}
                      onClick={() => setFavorite(i)}
                    >
                      <Star size={16} fill={favorite === i ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <h3>
                    {pText(direction)} {pText(' · ')}
                    {pText(name)}
                  </h3>
                  <PreviewWaveform label={pText(`${name}音轨示意`)} />
                  <p>{pText('00:30 · 示例音轨，不含播放文件')}</p>
                </article>
              ))}
              <PreviewButton onClick={() => setCompare(!compare)}>
                {pText(compare ? pText('收起比较') : pText('A / B 比较'))}
              </PreviewButton>
              {compare && (
                <div className="ot-demo-compare">
                  <strong>{pText('A · 更轻盈')}</strong>
                  <p>{pText('节奏靠前，适合短片开场。')}</p>
                  <strong>{pText('B · 更温暖')}</strong>
                  <p>{pText('留白更多，适合旁白背景。')}</p>
                </div>
              )}
            </>
          ) : (
            <div className="rp-empty">
              <Music2 size={35} />
              <p>{pText('选择一个方向，探索示例候选。')}</p>
            </div>
          )}
        </aside>
      </div>
      <div className="ot-demo-player">
        <Music2 size={20} />
        <div>
          <strong>
            {pText(
              takes
                ? `${direction} · ${favorite === 0 ? pText('轻盈版本') : pText('更温暖的版本')}`
                : pText('还没有选择音轨'),
            )}
          </strong>
          <small>{pText('静态音轨示意')}</small>
        </div>
        <span className="ot-demo-track-line" />
        <span>{pText('00:00 / 00:30')}</span>
        {takes && <Check size={17} />}
      </div>
    </RemainingPreview>
  );
}
