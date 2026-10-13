import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { ArrowRight, Check, FileText, Music2, SlidersHorizontal, Star } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton, PreviewWaveform } from './demo-third-party-shared.js';
import { PreviewTabs, RemainingPreview } from './demo-remaining-shared.js';

/** Overtone's paper composer, blue direction choices, take library and persistent player rail. */
export function DemoOvertonePreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [prompt, setPrompt] = useState(() => t('overtone.workspace.musicForAWalkAfterRainLight'));
  const [direction, setDirection] = useState(t('overtone.workspace.aWalkAfterRain'));
  const [stage, setStage] = useState('探索方向');
  const [takes, setTakes] = useState(false);
  const [favorite, setFavorite] = useState(0);
  const [compare, setCompare] = useState(false);
  const [lyrics, setLyrics] = useState(() =>
    t('overtone.workspace.verseStreetlightsHoldTheWarmthOfRain'),
  );
  const [settings, setSettings] = useState(false);
  const [soundImagery, setSoundImagery] = useState(() =>
    t('overtone.workspace.rainWashedStreetsLightFootstepsAndWarmLight'),
  );
  const [duration, setDuration] = useState('30 秒');
  const [creationMode, setCreationMode] = useState('纯音乐');
  const directions = [
    {
      name: t('overtone.workspace.aWalkAfterRain'),
      genre: 'Lo-fi / Jazz',
      description: t('overtone.workspace.softKeysLightDrumsAndRoomTo'),
    },
    {
      name: t('overtone.workspace.neonEchoes'),
      genre: 'Indie / Electronic',
      description: t('overtone.workspace.cleanSynthsAndALightGrooveBring'),
    },
    {
      name: t('overtone.workspace.afternoonByTheWindow'),
      genre: 'Acoustic / Folk',
      description: t('overtone.workspace.acousticGuitarAndWarmVocalsQuietBut'),
    },
  ];
  return (
    <RemainingPreview content={content} kind="overtone">
      <header className="ot-demo-masthead">
        <div>
          <Music2 size={27} />
          <strong>{t('overtone.demoMasthead.overtone')}</strong>
          <span>{t('overtone.demoMasthead.turnIdeasIntoSound')}</span>
        </div>
        <PreviewButton onClick={() => setSettings(!settings)}>
          <SlidersHorizontal size={16} />
          {t('overtone.demoMasthead.creativeSettings')}
        </PreviewButton>
      </header>
      {settings && (
        <div className="ot-demo-settings">
          <label>
            {t('overtone.workspace.trackDuration')}
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="30 秒">{t('overtone.workspace.30Seconds')}</option>
              <option value="60 秒">{t('overtone.workspace.60Seconds')}</option>
            </select>
          </label>
          <label>
            {t('overtone.workspace.creationMode')}
            <select value={creationMode} onChange={(e) => setCreationMode(e.target.value)}>
              <option value="纯音乐">{t('overtone.workspace.instrumental')}</option>
              <option value="包含歌词">{t('overtone.workspace.withLyrics')}</option>
            </select>
          </label>
          <p>{t('overtone.workspace.sampleCandidatesDoNotChangeWithModel')}</p>
        </div>
      )}
      <div className="ot-demo-workspace">
        <main className="ot-demo-composer">
          <PreviewTabs
            items={[
              { value: '探索方向', label: t('overtone.tabs.exploreDirections') },
              { value: '写成一首歌', label: t('overtone.demoComposer.writeASong') },
            ]}
            value={stage}
            onChange={setStage}
            label={t('overtone.demoComposer.creationStage')}
          />
          {stage === '探索方向' ? (
            <>
              <h1>{t('overtone.demoComposer.whatWouldYouLikeToHear')}</h1>
              <div className="ot-demo-prompt">
                <textarea
                  aria-label={t('overtone.demoComposer.musicIdea')}
                  rows={3}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                  }}
                />
                <div>
                  <span>
                    <Music2 size={14} />
                    {t('overtone.demoComposer.startWithAnIdea')}
                  </span>
                  <PreviewButton primary disabled={!prompt.trim()} onClick={() => setTakes(true)}>
                    {t('overtone.demoComposer.viewSampleDirections')}
                    <ArrowRight size={16} />
                  </PreviewButton>
                </div>
              </div>
              <div className="rp-section-heading">
                <h2>{t('overtone.demoComposer.threeDirectionsDifferentPossibilities')}</h2>
                <span>{t('overtone.demoComposer.savedExamples')}</span>
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
                    <span>{d.genre}</span>
                    <h3>{d.name}</h3>
                    <p>{d.description}</p>
                    <strong>
                      {direction === d.name
                        ? t('overtone.demoComposer.currentDirection')
                        : t('overtone.demoComposer.exploreThisDirection')}
                      <ArrowRight size={14} />
                    </strong>
                  </button>
                ))}
              </div>
              <section className="ot-demo-notebook">
                <h2>
                  <FileText size={18} />
                  {t('overtone.demoNotebook.creativeNotebook')}
                </h2>
                <label>
                  {t('overtone.demoNotebook.soundImagery')}
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
              <h1>{t('overtone.demoComposer.writeYourIdeaIntoASong')}</h1>
              <p className="tp-muted">
                {t('overtone.demoComposer.direction')}
                {direction} {t('overtone.demoComposer.sampleSongStructure')}
              </p>
              <label>
                {t('overtone.demoComposer.lyrics')}
                <textarea
                  aria-label={t('overtone.demoComposer.songLyrics')}
                  rows={10}
                  value={lyrics}
                  onChange={(e) => {
                    setLyrics(e.target.value);
                  }}
                />
              </label>
              <div className="ot-demo-song-sections">
                {[
                  t('overtone.demoComposer.intro'),
                  t('overtone.demoComposer.verse'),
                  t('overtone.demoComposer.chorus'),
                  t('overtone.demoComposer.outro'),
                ].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <PreviewButton primary onClick={() => setTakes(true)}>
                {t('overtone.demoComposer.viewSampleTakes')}
              </PreviewButton>
            </>
          )}
        </main>
        <aside className="ot-demo-takes">
          <div className="rp-section-heading">
            <h2>{t('overtone.demoTakes.candidateTracks')}</h2>
            <span>{takes ? '2' : '0'}</span>
          </div>
          {takes ? (
            <>
              {[t('overtone.demoTakes.lighterVersion'), t('overtone.demoTakes.warmerVersion')].map(
                (name, i) => (
                  <article key={name}>
                    <div>
                      <span>
                        {t('overtone.demoTakes.take')}
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <button
                        type="button"
                        aria-label={t('overtone.demoTakes.favorite', { name: name })}
                        aria-pressed={favorite === i}
                        onClick={() => setFavorite(i)}
                      >
                        <Star size={16} fill={favorite === i ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <h3>
                      {direction} {' · '}
                      {name}
                    </h3>
                    <PreviewWaveform
                      label={t('overtone.demoTakes.trackIllustration', { name: name })}
                    />
                    <p>{t('overtone.demoTakes.0030SampleTrackNoPlaybackFile')}</p>
                  </article>
                ),
              )}
              <PreviewButton onClick={() => setCompare(!compare)}>
                {compare
                  ? t('overtone.demoTakes.hideComparison')
                  : t('overtone.demoTakes.aBComparison')}
              </PreviewButton>
              {compare && (
                <div className="ot-demo-compare">
                  <strong>{t('overtone.demoTakes.aLighter')}</strong>
                  <p>{t('overtone.demoTakes.aForwardRhythmForTheOpeningOf')}</p>
                  <strong>{t('overtone.demoTakes.bWarmer')}</strong>
                  <p>{t('overtone.demoTakes.moreSpaceForVoiceover')}</p>
                </div>
              )}
            </>
          ) : (
            <div className="rp-empty">
              <Music2 size={35} />
              <p>{t('overtone.demoTakes.chooseADirectionToExploreSampleTakes')}</p>
            </div>
          )}
        </aside>
      </div>
      <div className="ot-demo-player">
        <Music2 size={20} />
        <div>
          <strong>
            {takes
              ? `${direction} · ${favorite === 0 ? t('overtone.workspace.lighterVersion') : t('overtone.workspace.warmerVersion')}`
              : t('overtone.workspace.noTrackSelected')}
          </strong>
          <small>{t('overtone.workspace.staticTrackIllustration')}</small>
        </div>
        <span className="ot-demo-track-line" />
        <span>{'00:00 / 00:30'}</span>
        {takes && <Check size={17} />}
      </div>
    </RemainingPreview>
  );
}
