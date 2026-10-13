import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { BookOpen, Menu, MessageSquare, Send, Settings2, UserRound, Users, X } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { RemainingPreview } from './demo-remaining-shared.js';

const createSampleCharacters = (t: PreviewTranslate) => [
  {
    name: t('sillytavern.workspace.mira'),
    role: t('sillytavern.workspace.keeperOfTheEveningLibrary'),
    image: '/demo/zhiyu/qingzhao-avatar.svg',
    greeting: t('sillytavern.workspace.theRainTapsSoftlyAgainstTheBookshop'),
    reply: t('sillytavern.workspace.thenLetUsBeginWithASmall'),
  },
  {
    name: t('sillytavern.workspace.rowan'),
    role: t('sillytavern.workspace.aTravellerBetweenQuietTowns'),
    image: '/demo/zhiyu/chao-avatar.svg',
    greeting: t('sillytavern.workspace.theNextTrainDoesNotLeaveFor'),
    reply: t('sillytavern.workspace.rowanFoldsTheMapAndSmilesWe'),
  },
];

/** SillyTavern's dark scene-backed chat, character drawer and world-info controls. */
export function DemoSillyTavernPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const navigationLabels: Record<string, string> = {
    Chat: t('sillytavern.navigation.chat'),
    Characters: t('sillytavern.navigation.characters'),
    'World Info': t('sillytavern.navigation.worldInfo'),
    Persona: t('sillytavern.navigation.persona'),
    Settings: t('sillytavern.navigation.settings'),
  };
  const [character, setCharacter] = useState(0);
  const [panel, setPanel] = useState('Characters');
  const [input, setInput] = useState(() => t('sillytavern.workspace.tellMeAboutThisPlace'));
  const [messages, setMessages] = useState<Record<number, string[]>>({});
  const [worldEnabled, setWorldEnabled] = useState(true);
  const [persona, setPersona] = useState(() =>
    t('sillytavern.workspace.aCuriousVisitorWhoEnjoysListeningTo'),
  );
  const current = createSampleCharacters(t)[character]!;
  const send = () => {
    if (!input.trim()) return;
    setMessages((v) => ({ ...v, [character]: [...(v[character] ?? []), input] }));
    setInput('');
  };
  return (
    <RemainingPreview content={content} kind="sillytavern">
      <div className="st-demo-scene">
        <header className="st-demo-toolbar">
          <img src={content.icon} alt={''} />
          <strong>{t('sillytavern.demoToolbar.sillyTavern')}</strong>
          <div>
            {[
              { label: 'Chat', Icon: MessageSquare },
              { label: 'Characters', Icon: Users },
              { label: 'World Info', Icon: BookOpen },
              { label: 'Persona', Icon: UserRound },
              { label: 'Settings', Icon: Settings2 },
            ].map(({ label, Icon }) => (
              <button
                type="button"
                key={label}
                aria-label={navigationLabels[label]}
                title={navigationLabels[label]}
                aria-pressed={panel === label}
                onClick={() => setPanel(panel === label ? 'Chat' : label)}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </header>
        <div className="st-demo-workspace">
          <main className="st-demo-chat">
            <div className="st-demo-chat-title">
              <img src={current.image} alt={''} />
              <div>
                <h1>{current.name}</h1>
                <p>{current.role}</p>
              </div>
              <button
                type="button"
                aria-label={t('sillytavern.demoChat.openCharacterList')}
                onClick={() => setPanel('Characters')}
              >
                <Menu size={19} />
              </button>
            </div>
            <div className="st-demo-messages">
              <article>
                <img src={current.image} alt={''} />
                <div>
                  <h2>
                    {current.name}
                    <span>{t('sillytavern.demoChat.sampleGreeting')}</span>
                  </h2>
                  <p>{current.greeting}</p>
                </div>
              </article>
              {(messages[character] ?? []).map((message, i) => (
                <div key={i}>
                  <article className="st-demo-user">
                    <span className="st-demo-you">
                      <UserRound size={25} />
                    </span>
                    <div>
                      <h2>{t('sillytavern.demoChat.you')}</h2>
                      <p>{message}</p>
                    </div>
                  </article>
                  <article>
                    <img src={current.image} alt={''} />
                    <div>
                      <h2>
                        {current.name}
                        <span>{t('sillytavern.demoChat.scriptedExample')}</span>
                      </h2>
                      <p>{current.reply}</p>
                    </div>
                  </article>
                </div>
              ))}
            </div>
            <form
              className="st-demo-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                aria-label={t('sillytavern.demoChat.characterMessage')}
                rows={2}
                placeholder={t('sillytavern.demoChat.message', { currentName: current.name })}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                }}
              />
              <button
                type="submit"
                aria-label={t('sillytavern.demoChat.sendExampleMessage')}
                disabled={!input.trim()}
              >
                <Send size={20} />
              </button>
            </form>
            <p className="st-demo-sample">
              {t('sillytavern.demoChat.repliesArePrewrittenExamplesIndependentOfYour')}
            </p>
          </main>
          {panel !== 'Chat' && (
            <aside className="st-demo-panel">
              <div>
                <h2>{navigationLabels[panel]}</h2>
                <button
                  type="button"
                  aria-label={t('sillytavern.demoPanel.closeCharacterPanel')}
                  onClick={() => setPanel('Chat')}
                >
                  <X size={17} />
                </button>
              </div>
              {panel === 'Characters' ? (
                <>
                  <p>{t('sillytavern.demoPanel.fictionalSampleCharacters')}</p>
                  {createSampleCharacters(t).map((c, i) => (
                    <button
                      type="button"
                      className="st-demo-character"
                      key={c.name}
                      aria-pressed={character === i}
                      onClick={() => setCharacter(i)}
                    >
                      <img src={c.image} alt={''} />
                      <span>
                        <strong>{c.name}</strong>
                        <small>{c.role}</small>
                      </span>
                    </button>
                  ))}
                </>
              ) : panel === 'World Info' ? (
                <>
                  <label className="tp-check">
                    <input
                      type="checkbox"
                      checked={worldEnabled}
                      onChange={(e) => {
                        setWorldEnabled(e.target.checked);
                      }}
                    />
                    {t('sillytavern.demoPanel.eveningLibrary')}
                  </label>
                  <article>
                    <h3>{t('sillytavern.demoPanel.theLibraryAfterSunset')}</h3>
                    <p>{t('sillytavern.demoPanel.aFictionalPlaceWhereTravellersShareThe')}</p>
                    <small>
                      {worldEnabled
                        ? t('sillytavern.demoPanel.includedInThisExampleSetting')
                        : t('sillytavern.demoPanel.excludedFromThisExampleSetting')}
                    </small>
                  </article>
                </>
              ) : panel === 'Persona' ? (
                <label>
                  {t('sillytavern.demoPanel.yourSamplePersona')}
                  <textarea
                    value={persona}
                    rows={6}
                    onChange={(e) => {
                      setPersona(e.target.value);
                    }}
                  />
                </label>
              ) : (
                <>
                  <h3>{t('sillytavern.demoPanel.exampleChatPreferences')}</h3>
                  <label>
                    {t('sillytavern.demoPanel.responseLength')}
                    <select defaultValue="Balanced">
                      <option value="Balanced">{t('sillytavern.demoPanel.balanced')}</option>
                      <option value="Short">{t('sillytavern.demoPanel.short')}</option>
                      <option value="Detailed">{t('sillytavern.demoPanel.detailed')}</option>
                    </select>
                  </label>
                  <p>{t('sillytavern.demoPanel.inTheInstalledAppAiModelsAnd')}</p>
                  <PreviewButton onClick={() => setMessages((v) => ({ ...v, [character]: [] }))}>
                    {t('sillytavern.demoPanel.restartThisSampleChat')}
                  </PreviewButton>
                </>
              )}
            </aside>
          )}
        </div>
      </div>
    </RemainingPreview>
  );
}
