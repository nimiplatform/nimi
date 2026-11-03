import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw } from 'lucide-react';
import type { LandingContent, TourChapterCopy } from '../content/landing-content.js';
import { demoChapters } from '../content/demo-tour.js';
import { useHeroDemoSession } from './hero-demo-context.js';

export function HomeTourCaption({ copy, controls }: { copy: TourChapterCopy; controls: LandingContent['guide'] }) {
  const { section, resumeStep, guideStep, selectGuideStep, explore, playing, setPlaying, preferences, demo, preview, closePreview } = useHeroDemoSession();
  const last = copy.stops.length - 1;
  const free = guideStep === undefined;
  const [title, body] = copy.stops[resumeStep]!;
  const next = demoChapters[(section ?? 0) - 2]?.stops[resumeStep + 1];
  const launchId = preview ? undefined : next?.preview?.appId;
  const launch = launchId && demo.apps.items.find(app => app.id === launchId);
  const finishApp = Boolean(preview) && resumeStep === last;
  const nextLabel = finishApp ? controls.backHome : resumeStep === last ? controls.replay :
    launch ? controls.openApp.replace('{app}', launch.name) : controls.next;
  const move = (step: number) => { setPlaying(false); selectGuideStep(step); };

  return (
    <aside className="tour-caption" aria-label={controls.label}>
      <div className="tour-count" aria-label={`${resumeStep + 1} / ${copy.stops.length}`}>
        <b>{String(resumeStep + 1).padStart(2, '0')}</b><span>/ {String(copy.stops.length).padStart(2, '0')}</span>
      </div>
      <div className="tour-caption-copy" aria-live={playing && !preferences.reducedMotion && !free ? 'off' : 'polite'}>
        <h3>{free ? controls.exploring : title}</h3>
        <p>{free ? controls.resumeHint.replace('{step}', title) : body}</p>
      </div>
      <div className="tour-actions">
        <button type="button" className="tour-mode" onClick={free ? () => move(resumeStep) : explore}>
          {free ? controls.resume : controls.explore}
        </button>
        <button type="button" className="tour-icon" aria-label={controls.previous} title={controls.previous}
          disabled={resumeStep === 0} onClick={() => move(resumeStep - 1)}><ArrowLeft size={16} /></button>
        <button type="button" className="tour-next" onClick={finishApp ? closePreview : () => move(resumeStep === last ? 0 : resumeStep + 1)}>
          {nextLabel}{resumeStep === last && !finishApp ? <RotateCcw size={14} /> : <ArrowRight size={15} />}
        </button>
        {!free && resumeStep < last && !preferences.reducedMotion && (
          <button type="button" className="tour-icon" aria-label={playing ? controls.pause : controls.play} title={playing ? controls.pause : controls.play}
            onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        )}
      </div>
    </aside>
  );
}
