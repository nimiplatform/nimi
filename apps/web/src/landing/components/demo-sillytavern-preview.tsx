import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { BookOpen, Menu, MessageSquare, Send, Settings2, UserRound, Users, X } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { RemainingPreview } from './demo-remaining-shared.js';

const CHARACTERS = [
  {
    name: 'Mira',
    role: 'Keeper of the evening library',
    image: '/demo/zhiyu/qingzhao-avatar.svg',
    greeting:
      'The rain taps softly against the bookshop window. “Come in. There is always room for one more story. What brings you here tonight?”',
    reply:
      '“Then let us begin with a small detail,” Mira says, setting a notebook on the table. “A place, a sound, or something you almost forgot.”',
  },
  {
    name: 'Rowan',
    role: 'A traveller between quiet towns',
    image: '/demo/zhiyu/chao-avatar.svg',
    greeting:
      '“The next train does not leave for an hour,” Rowan says. “Would you like to take a walk through the old town?”',
    reply:
      'Rowan folds the map and smiles. “We can take the slower road. It usually has the better stories.”',
  },
];

/** SillyTavern's dark scene-backed chat, character drawer and world-info controls. */
export function DemoSillyTavernPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [character, setCharacter] = useState(0);
  const [panel, setPanel] = useState('Characters');
  const [input, setInput] = useState(() => pData('Tell me about this place.'));
  const [messages, setMessages] = useState<Record<number, string[]>>({});
  const [worldEnabled, setWorldEnabled] = useState(true);
  const [persona, setPersona] = useState(() =>
    pData('A curious visitor who enjoys listening to stories.'),
  );
  const current = CHARACTERS[character]!;
  const send = () => {
    if (!input.trim()) return;
    setMessages((v) => ({ ...v, [character]: [...(v[character] ?? []), input] }));
    setInput('');
  };
  return (
    <RemainingPreview content={content} kind="sillytavern">
      <div className="st-demo-scene">
        <header className="st-demo-toolbar">
          <img src={content.icon} alt={pText('')} />
          <strong>{pText('SillyTavern')}</strong>
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
                aria-label={pText(label)}
                title={pText(label)}
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
              <img src={current.image} alt={pText('')} />
              <div>
                <h1>{pText(current.name)}</h1>
                <p>{pText(current.role)}</p>
              </div>
              <button
                type="button"
                aria-label={pText('Open character list')}
                onClick={() => setPanel('Characters')}
              >
                <Menu size={19} />
              </button>
            </div>
            <div className="st-demo-messages">
              <article>
                <img src={current.image} alt={pText('')} />
                <div>
                  <h2>
                    {pText(current.name)}
                    <span>{pText('Sample greeting')}</span>
                  </h2>
                  <p>{pText(current.greeting)}</p>
                </div>
              </article>
              {(messages[character] ?? []).map((message, i) => (
                <div key={i}>
                  <article className="st-demo-user">
                    <span className="st-demo-you">
                      <UserRound size={25} />
                    </span>
                    <div>
                      <h2>{pText('You')}</h2>
                      <p>{message}</p>
                    </div>
                  </article>
                  <article>
                    <img src={current.image} alt={pText('')} />
                    <div>
                      <h2>
                        {pText(current.name)}
                        <span>{pText('Scripted example')}</span>
                      </h2>
                      <p>{pText(current.reply)}</p>
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
                aria-label={pText('Character message')}
                rows={2}
                placeholder={pText(`Message ${current.name}…`)}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                }}
              />
              <button
                type="submit"
                aria-label={pText('Send example message')}
                disabled={!input.trim()}
              >
                <Send size={20} />
              </button>
            </form>
            <p className="st-demo-sample">
              {pText('Replies are prewritten examples, independent of your message.')}
            </p>
          </main>
          {panel !== 'Chat' && (
            <aside className="st-demo-panel">
              <div>
                <h2>{pText(panel)}</h2>
                <button
                  type="button"
                  aria-label={pText('Close character panel')}
                  onClick={() => setPanel('Chat')}
                >
                  <X size={17} />
                </button>
              </div>
              {panel === 'Characters' ? (
                <>
                  <p>{pText('Fictional sample characters')}</p>
                  {CHARACTERS.map((c, i) => (
                    <button
                      type="button"
                      className="st-demo-character"
                      key={c.name}
                      aria-pressed={character === i}
                      onClick={() => setCharacter(i)}
                    >
                      <img src={c.image} alt={pText('')} />
                      <span>
                        <strong>{pText(c.name)}</strong>
                        <small>{pText(c.role)}</small>
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
                    {pText('Evening Library')}
                  </label>
                  <article>
                    <h3>{pText('The library after sunset')}</h3>
                    <p>
                      {pText(
                        'A fictional place where travellers share the small stories they bring from the road.',
                      )}
                    </p>
                    <small>
                      {pText(
                        worldEnabled
                          ? 'Included in this example setting'
                          : 'Excluded from this example setting',
                      )}
                    </small>
                  </article>
                </>
              ) : panel === 'Persona' ? (
                <label>
                  {pText('Your sample persona')}
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
                  <h3>{pText('Example chat preferences')}</h3>
                  <label>
                    {pText('Response length')}
                    <select defaultValue="Balanced">
                      <option value={'Balanced'}>{pText('Balanced')}</option>
                      <option value={'Short'}>{pText('Short')}</option>
                      <option value={'Detailed'}>{pText('Detailed')}</option>
                    </select>
                  </label>
                  <p>
                    {pText(
                      'In the installed App, AI models and capabilities are configured through Nimi.',
                    )}
                  </p>
                  <PreviewButton onClick={() => setMessages((v) => ({ ...v, [character]: [] }))}>
                    {pText('Restart this sample chat')}
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
