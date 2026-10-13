import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutTemplate,
  Play,
  Plus,
  Presentation,
  SlidersHorizontal,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { RemainingPreview } from './demo-remaining-shared.js';

type SampleSlide = { title: string; body: string; image?: string; notes?: string };
const SLIDES: SampleSlide[] = [
  {
    title: 'A little more room\nfor everyday life.',
    body: 'Designing calmer, more welcoming places.\nAn illustrative presentation.',
    image: '/demo/remaining/inscape-landscape.webp',
  },
  {
    title: 'Start with the journey.',
    body: 'Connect the places people already visit.\nMake crossings clear and predictable.\nLeave space to stop, rest and meet.',
  },
  {
    title: 'Small changes.\nShared possibilities.',
    body: 'A shaded bench. A safer crossing. A place to gather.\nWhat would you change on your daily walk?',
    image: '/demo/storybook/garden.jpg',
  },
];

/** Presenton's slide strip, editable canvas, template settings and presentation mode. */
export function DemoPresentonPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData, pFormat } = useAppPreviewLocale();
  const [slides, setSlides] = useState(() => pData(SLIDES));
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState(() => pData('A more welcoming city'));
  const [theme, setTheme] = useState('Fern');
  const [presenting, setPresenting] = useState(false);
  const [settings, setSettings] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const slide = slides[selected]!;
  const update = (field: 'title' | 'body' | 'notes', value: string) => {
    setSlides((v) => v.map((s, i) => (i === selected ? { ...s, [field]: value } : s)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="presenton">
      {!presenting && (
        <>
          <header className="pn-header">
            <div>
              <img src={content.icon} alt={pText('')} />
              <strong>{pText('Presenton')}</strong>
              <input
                aria-label={pText('Presentation title')}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div>
              <PreviewButton onClick={() => setSaved(true)}>
                <Check size={14} />
                {pText(saved ? 'Kept in preview' : 'Save example')}
              </PreviewButton>
              <PreviewButton onClick={() => setExportOpen(!exportOpen)}>
                {pText('Export options')}
              </PreviewButton>
              <PreviewButton primary onClick={() => setPresenting(true)}>
                <Play size={15} />
                {pText('Present')}
              </PreviewButton>
            </div>
          </header>
          {exportOpen && (
            <section className="pn-export" role="status">
              <strong>{pText('Export in the installed App')}</strong>
              <span>{pText('PowerPoint (.pptx) · PDF (.pdf)')}</span>
              <p>{pText('This static preview does not create an export file.')}</p>
            </section>
          )}
          <div className={`pn-workspace${settings ? '' : ' pn-workspace--wide'}`}>
            <aside className="pn-slides">
              <div>
                <h2>{pText('Slides')}</h2>
                <button
                  type="button"
                  aria-label={pText('Add sample slide')}
                  onClick={() => {
                    setSlides((v) => [
                      ...v,
                      {
                        title: pText('A new idea'),
                        body: pText('Write a few lines to develop it.'),
                      },
                    ]);
                    setSelected(slides.length);
                    setSaved(false);
                  }}
                >
                  <Plus size={17} />
                </button>
              </div>
              {slides.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  aria-label={pFormat('Slide {0}: {1}', i + 1, s.title.replace('\n', ' '))}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <span>{pText(i + 1)}</span>
                  <div className={`pn-mini pn-theme-${theme.toLowerCase()}`}>
                    <strong>{s.title}</strong>
                    <small>{s.body.split('\n')[0]}</small>
                  </div>
                </button>
              ))}
            </aside>
            <main className="pn-main">
              <div className="pn-toolbar">
                <span>
                  {pText('Slide ')}
                  {pText(selected + 1)} {pText(' / ')}
                  {slides.length}
                </span>
                <PreviewButton onClick={() => setSettings(!settings)}>
                  <SlidersHorizontal size={15} />
                  {pText(settings ? 'Hide settings' : 'Slide settings')}
                </PreviewButton>
              </div>
              <section
                className={`pn-canvas pn-theme-${theme.toLowerCase()}${slide.image ? ' pn-canvas--image' : ''}`}
                aria-label={pText('Slide canvas')}
              >
                <div>
                  <textarea
                    aria-label={pText('Slide title')}
                    rows={3}
                    value={slide.title}
                    onChange={(e) => {
                      update('title', e.target.value);
                    }}
                  />
                  <textarea
                    aria-label={pText('Slide content')}
                    rows={4}
                    value={slide.body}
                    onChange={(e) => {
                      update('body', e.target.value);
                    }}
                  />
                  <span>{pText('PRESENTON · SAMPLE DECK')}</span>
                </div>
                {slide.image && <img src={slide.image} alt={pText('Sample slide illustration')} />}
              </section>
              <p className="pn-edit-hint">
                {pText('Click the title or body to edit this sample slide.')}
              </p>
              <label className="pn-speaker-notes">
                {pText('Speaker notes')}
                <textarea
                  aria-label={pText('Speaker notes')}
                  rows={2}
                  placeholder={pText('Add a note for this slide…')}
                  value={slide.notes ?? ''}
                  onChange={(e) => {
                    update('notes', e.target.value);
                  }}
                />
              </label>
            </main>
            {settings && (
              <aside className="pn-settings">
                <h2>
                  <LayoutTemplate size={17} />
                  {pText('Slide settings')}
                </h2>
                <label>
                  {pText('Theme')}
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {['Fern', 'Slate', 'Paper'].map((x) => (
                      <option value={x} key={x}>
                        {pText(x)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pn-theme-swatches">
                  {['Fern', 'Slate', 'Paper'].map((x) => (
                    <button
                      type="button"
                      key={x}
                      aria-label={pText(`Use ${x} theme`)}
                      aria-pressed={theme === x}
                      className={`pn-theme-${x.toLowerCase()}`}
                      onClick={() => setTheme(x)}
                    >
                      <span>{pText('Aa')}</span>
                      {pText(x)}
                    </button>
                  ))}
                </div>
                <h3>{pText('Layout')}</h3>
                <p>
                  {pText(slide.image ? 'Text with image' : 'Text slide')}{' '}
                  {pText(' · illustrative template')}
                </p>
                <PreviewButton
                  onClick={() => {
                    setSlides((v) =>
                      v.map((s, i) =>
                        i === selected
                          ? { ...s, image: s.image ? undefined : '/demo/storybook/garden.jpg' }
                          : s,
                      ),
                    );
                    setSaved(false);
                  }}
                >
                  {pText('Toggle sample image')}
                </PreviewButton>
              </aside>
            )}
          </div>
        </>
      )}
      {presenting && (
        <section className="pn-presentation" aria-label={pText('Presentation mode')}>
          <header>
            <strong>{title}</strong>
            <PreviewButton onClick={() => setPresenting(false)}>
              {pText('Exit presentation')}
            </PreviewButton>
          </header>
          <div
            className={`pn-canvas pn-theme-${theme.toLowerCase()}${slide.image ? ' pn-canvas--image' : ''}`}
          >
            <div>
              <h1>{slide.title}</h1>
              <p>{slide.body}</p>
              <span>{pText('PRESENTON · SAMPLE DECK')}</span>
            </div>
            {slide.image && <img src={slide.image} alt={pText('Sample slide illustration')} />}
          </div>
          <footer>
            <PreviewButton
              aria-label={pText('Previous slide')}
              disabled={selected === 0}
              onClick={() => setSelected(selected - 1)}
            >
              <ArrowLeft size={18} />
            </PreviewButton>
            <span>
              {pText(selected + 1)} {pText(' / ')}
              {slides.length}
            </span>
            <PreviewButton
              aria-label={pText('Next slide')}
              disabled={selected === slides.length - 1}
              onClick={() => setSelected(selected + 1)}
            >
              <ArrowRight size={18} />
            </PreviewButton>
          </footer>
        </section>
      )}
    </RemainingPreview>
  );
}
