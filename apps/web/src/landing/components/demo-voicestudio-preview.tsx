import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  FileAudio,
  Folder,
  Headphones,
  Mic,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import type { VoiceStudioPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice, PreviewWaveform } from './demo-third-party-shared.js';

const NAV_ICONS = [
  Mic,
  BookOpen,
  Headphones,
  AudioLines,
  FileAudio,
  Wand2,
  BookOpen,
  Folder,
  SlidersHorizontal,
];
type DemoVoice = { name: string; detail: string; initial: string };

/** Landing-owned replica of VoiceStudio's T3-style workspace, voice library and design page. */
export function DemoVoiceStudioPreview({ content }: { content: VoiceStudioPreviewContent }) {
  const { previewLang, t } = useAppPreviewLocale();
  const navigationLabels: Record<string, string> = {
    clone: content.navigation[0],
    story: content.navigation[1],
    dubbing: content.navigation[2],
    savedVoices: content.navigation[3],
    transcribe: content.navigation[4],
    design: content.navigation[5],
    audiobook: content.navigation[6],
    projects: content.navigation[7],
    tools: content.navigation[8],
    settings: t('voiceStudio.navigation.settings'),
  };
  const [view, setView] = useState('design');
  const [description, setDescription] = useState<string>(() => content.description);
  const [script, setScript] = useState<string>(() => content.script);
  const [voices, setVoices] = useState<DemoVoice[]>([...content.voices]);
  const [selected, setSelected] = useState(() => t('voiceStudio.workspace.seasideNarrator'));
  const [name, setName] = useState(() => '');
  const [take, setTake] = useState(false);
  const [language, setLanguage] = useState('自动');
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState(() => '');
  const pickVoice = (voice: DemoVoice) => {
    setSelected(voice.name);
    setDescription(voice.detail);
    setView('design');
  };
  return (
    <div className="tp-preview voicestudio-preview" data-demo-voicestudio-root lang={previewLang}>
      <div className="vs-layout">
        <aside className="vs-sidebar">
          <div className="vs-brand">
            <img src="/demo/voicestudio-icon.png" alt={''} />
            <strong>{t('voiceStudio.sidebar.voiceStudio')}</strong>
          </div>
          <div className="vs-library-heading">
            <span>{t('voiceStudio.sidebar.savedVoices')}</span>
            <button
              type="button"
              aria-label={t('voiceStudio.sidebar.viewVoiceConfiguration')}
              onClick={() => setView('savedVoices')}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="vs-voice-list">
            {voices.map((voice) => (
              <button
                type="button"
                key={voice.name}
                aria-pressed={selected === voice.name}
                onClick={() => pickVoice(voice)}
              >
                <span>{voice.initial}</span>
                {voice.name}
              </button>
            ))}
          </div>
          <nav aria-label={t('voiceStudio.sidebar.workspaces')}>
            {[
              'clone',
              'story',
              'dubbing',
              'savedVoices',
              'transcribe',
              'design',
              'audiobook',
              'projects',
              'tools',
            ].map((label, index) => {
              const Icon = NAV_ICONS[index]!;
              return (
                <button
                  type="button"
                  key={label}
                  aria-current={view === label ? 'page' : undefined}
                  onClick={() => setView(label)}
                >
                  <Icon size={16} />
                  {navigationLabels[label] ?? label}
                </button>
              );
            })}
          </nav>
          <button className="vs-settings-link" type="button" onClick={() => setView('settings')}>
            <Settings size={16} />
            {t('voiceStudio.sidebar.settings')}
          </button>
        </aside>
        <main className="vs-main">
          <header className="vs-header">
            <h1>
              {view === 'savedVoices'
                ? t('voiceStudio.header.savedVoices')
                : navigationLabels[view]}
            </h1>
            <span className="tp-chip">{t('voiceStudio.header.sampleWorkspace')}</span>
          </header>
          {view === 'design' || view === 'clone' ? (
            <div className="vs-creation">
              <aside className="vs-designer">
                <h2>{navigationLabels[view]}</h2>
                {view === 'design' ? (
                  <>
                    <label>
                      {t('voiceStudio.designer.describeYourVoice')}
                      <textarea
                        rows={5}
                        value={description}
                        maxLength={2000}
                        onChange={(event) => {
                          setDescription(event.target.value);
                        }}
                      />
                    </label>
                    <p className="tp-muted">
                      {t('voiceStudio.designer.describeTheVoiceOrChooseAStarting')}
                    </p>
                    <h3>{t('voiceStudio.designer.startingPoints')}</h3>
                    <div className="vs-presets">
                      {[
                        t('voiceStudio.designer.narrator'),
                        t('voiceStudio.designer.casual'),
                        t('voiceStudio.designer.newsAnchor'),
                        t('voiceStudio.designer.storyteller'),
                        t('voiceStudio.designer.corporate'),
                        t('voiceStudio.designer.energetic'),
                      ].map((preset) => (
                        <button
                          type="button"
                          key={preset}
                          onClick={() =>
                            setDescription(
                              t('voiceStudio.designer.presetDescription', { preset: preset }),
                            )
                          }
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <details>
                      <summary>{t('voiceStudio.designer.details')}</summary>
                      <label>
                        {t('voiceStudio.designer.speed')}
                        <select defaultValue="自然">
                          <option value="自然">{t('voiceStudio.designer.natural')}</option>
                          <option value="舒缓">{t('voiceStudio.designer.soothing')}</option>
                          <option value="轻快">{t('voiceStudio.designer.light')}</option>
                        </select>
                      </label>
                    </details>
                  </>
                ) : (
                  <div className="vs-reference">
                    <Upload size={27} />
                    <h3>{t('voiceStudio.designer.referenceAudio')}</h3>
                    <p>{t('voiceStudio.designer.theFullAppCanCreateAVoice')}</p>
                    <PreviewButton
                      onClick={() => {
                        setSelected(t('voiceStudio.designer.seasideNarrator'));
                        setDescription(content.description);
                      }}
                    >
                      {t('voiceStudio.designer.loadSampleConfiguration')}
                    </PreviewButton>
                  </div>
                )}
                <label>
                  {t('voiceStudio.designer.profileName')}
                  <input
                    value={name}
                    maxLength={60}
                    placeholder={t('voiceStudio.designer.configurationName')}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
                <PreviewButton
                  disabled={!name.trim() || voices.some((voice) => voice.name === name.trim())}
                  onClick={() => {
                    setVoices((previous) => [
                      ...previous,
                      {
                        name: name.trim(),
                        detail: description,
                        initial: Array.from(name.trim())[0]!,
                      },
                    ]);
                    setSelected(name.trim());
                    setName('');
                    setSaved(true);
                  }}
                >
                  <Plus size={14} />
                  {t('voiceStudio.designer.saveAsVoiceProfile')}
                </PreviewButton>
                {saved && (
                  <p role="status">
                    <Check size={14} />
                    {t('voiceStudio.designer.sampleConfigurationAddedToTheSidebar')}
                  </p>
                )}
              </aside>
              <section className="vs-script">
                <button
                  type="button"
                  className="vs-current-voice"
                  onClick={() => setView('savedVoices')}
                >
                  <span className="vs-voice-avatar">{Array.from(selected)[0]}</span>
                  <span>
                    <small>{t('voiceStudio.script.voice')}</small>
                    {selected}
                  </span>
                  <ChevronRight size={16} />
                </button>
                <label>
                  {t('voiceStudio.script.text')}
                  <textarea
                    value={script}
                    rows={7}
                    maxLength={3000}
                    placeholder={t('voiceStudio.script.whatShouldThisVoiceSay')}
                    onChange={(event) => {
                      setScript(event.target.value);
                    }}
                  />
                </label>
                <div className="vs-generate-row">
                  <label>
                    <span className="tp-sr-only">{t('voiceStudio.script.language')}</span>
                    <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                      <option value="自动">{t('voiceStudio.script.automatic')}</option>
                      <option value="中文">{t('voiceStudio.script.chinese')}</option>
                      <option value="English">{t('voiceStudio.script.english')}</option>
                    </select>
                  </label>
                  <span>
                    {script.length} {t('voiceStudio.script.characters')}
                  </span>
                  <PreviewButton
                    primary
                    disabled={!script.trim() || !description.trim()}
                    onClick={() => setTake(true)}
                  >
                    <Sparkles size={15} />
                    {t('voiceStudio.script.synthesizeAudio')}
                  </PreviewButton>
                </div>
                <p className="vs-sample-hint">
                  {t('voiceStudio.script.thisButtonPlaysAPrerecordedExampleAudio')}
                </p>
                {take && (
                  <section className="vs-take">
                    <h3>{t('voiceStudio.take.latestTakePrerecordedExample')}</h3>
                    <PreviewWaveform label={t('voiceStudio.take.sampleAudioTrackIllustration')} />
                    <audio
                      controls
                      preload="none"
                      src="/demo/zhiyu/qingzhao-voice.mp3"
                      aria-label={t('voiceStudio.take.voiceStudioPrerecordedSampleAudio')}
                    />
                    <p>{t('voiceStudio.take.prerecordedDemoAudioNotGeneratedIn')}</p>
                  </section>
                )}
              </section>
            </div>
          ) : view === 'savedVoices' ? (
            <section className="vs-profiles">
              <label className="vs-search">
                <Search size={16} />
                <input
                  value={query}
                  aria-label={t('voiceStudio.profiles.searchSampleVoices')}
                  placeholder={t('voiceStudio.profiles.search')}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <div>
                {voices
                  .filter((voice) => voice.name.toLowerCase().includes(query.toLowerCase()))
                  .map((voice) => (
                    <button type="button" key={voice.name} onClick={() => pickVoice(voice)}>
                      <span className="vs-voice-avatar">{voice.initial}</span>
                      <strong>{voice.name}</strong>
                      <p>{voice.detail}</p>
                      <span>
                        {t('voiceStudio.profiles.useVoice')}
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))}
              </div>
              {!voices.some((voice) => voice.name.toLowerCase().includes(query.toLowerCase())) && (
                <p className="tp-empty">{t('voiceStudio.profiles.noMatchingSampleVoices')}</p>
              )}
            </section>
          ) : view === 'story' || view === 'audiobook' ? (
            <section className="vs-story">
              <h2>{t('voiceStudio.story.aDayByTheSea')}</h2>
              <p className="tp-muted">{t('voiceStudio.story.sampleStoryAssignAVoiceTo')}</p>
              <label>
                {t('voiceStudio.story.storyText')}
                <textarea
                  rows={6}
                  value={script}
                  onChange={(event) => {
                    setScript(event.target.value);
                  }}
                />
              </label>
              {voices.slice(0, 2).map((voice, index) => (
                <div className="vs-track" key={voice.name}>
                  <span>
                    {index === 0
                      ? t('voiceStudio.story.narrator')
                      : t('voiceStudio.story.character')}
                    <small>{voice.name}</small>
                  </span>
                  <PreviewWaveform
                    label={t('voiceStudio.story.sampleTrack', { voiceName: voice.name })}
                  />
                </div>
              ))}
            </section>
          ) : (
            <section className="vs-story">
              <h2>
                {view === 'transcribe'
                  ? t('voiceStudio.story.turnRecordingsIntoText')
                  : view === 'dubbing'
                    ? t('voiceStudio.story.giveVisualsAVoice')
                    : view === 'settings'
                      ? t('voiceStudio.story.voiceCreationPreferences')
                      : t('voiceStudio.workspace.title', { name: navigationLabels[view]! })}
              </h2>
              <p>
                {view === 'transcribe'
                  ? t('voiceStudio.story.theFullAppSupportsFilesRecordingAnd')
                  : view === 'dubbing'
                    ? t('voiceStudio.story.importVideoOrganizeDialogueAndChooseVoices')
                    : t('voiceStudio.story.manageProjectsAudioToolsAndNimiAi')}
              </p>
              <PreviewButton onClick={() => setView('design')}>
                {t('voiceStudio.story.exploreVoiceDesign')}
                <ChevronRight size={15} />
              </PreviewButton>
            </section>
          )}
        </main>
      </div>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
