import { useTranslation } from 'react-i18next';
import type { LookdevPortraitBrief } from './types.js';

type EmbeddedCapturePanelProps = {
  stylePackConfirmed: boolean;
  capturePortraitBriefs: LookdevPortraitBrief[];
  activePortraitBrief: LookdevPortraitBrief | null;
  activePortraitBriefFieldPrefix: string;
  onSelectBriefAgent(agentId: string): void;
  onUpdatePortraitBrief(patch: Partial<LookdevPortraitBrief>): void;
};

export function EmbeddedCapturePanel(props: EmbeddedCapturePanelProps) {
  const { t } = useTranslation();
  const {
    stylePackConfirmed,
    capturePortraitBriefs,
    activePortraitBrief,
    activePortraitBriefFieldPrefix,
    onSelectBriefAgent,
    onUpdatePortraitBrief,
  } = props;

  return (
    <div className="grid gap-4 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.embeddedCaptureEyebrow')}</div>
        <div className="text-sm text-white/62">{t('createBatch.embeddedCaptureDescription')}</div>
      </div>
      {!stylePackConfirmed ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
          {t('createBatch.embeddedCaptureBlocked')}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="max-h-[280px] min-w-0 space-y-2 overflow-auto pr-1 ld-scroll">
            {capturePortraitBriefs.map((brief) => {
              const selected = brief.agentId === activePortraitBrief?.agentId;
              return (
                <button
                  key={brief.agentId}
                  type="button"
                  onClick={() => onSelectBriefAgent(brief.agentId)}
                  className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
                >
                  <div>
                    <div className="font-medium text-white">{brief.displayName}</div>
                    <div className="mt-1 text-xs text-white/52">{brief.visualRole}</div>
                  </div>
                  <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? t('createBatch.embeddedCaptureEditing') : t('createBatch.embeddedCaptureReview')}</span>
                </button>
              );
            })}
            {capturePortraitBriefs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
                {t('createBatch.embeddedCaptureEmpty')}
              </div>
            ) : null}
          </div>

          {activePortraitBrief ? (
            <div className="grid min-w-0 gap-3">
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${activePortraitBriefFieldPrefix}-visual-role`} className="text-sm text-white/74">{t('createBatch.visualRole')}</label>
                <input
                  id={`${activePortraitBriefFieldPrefix}-visual-role`}
                  value={activePortraitBrief.visualRole}
                  onChange={(event) => onUpdatePortraitBrief({ visualRole: event.target.value })}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${activePortraitBriefFieldPrefix}-silhouette`} className="text-sm text-white/74">{t('createBatch.silhouette')}</label>
                <input
                  id={`${activePortraitBriefFieldPrefix}-silhouette`}
                  value={activePortraitBrief.silhouette}
                  onChange={(event) => onUpdatePortraitBrief({ silhouette: event.target.value })}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${activePortraitBriefFieldPrefix}-outfit`} className="text-sm text-white/74">{t('createBatch.outfit')}</label>
                <input
                  id={`${activePortraitBriefFieldPrefix}-outfit`}
                  value={activePortraitBrief.outfit}
                  onChange={(event) => onUpdatePortraitBrief({ outfit: event.target.value })}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>
              <div className="grid min-w-0 gap-2 2xl:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <label htmlFor={`${activePortraitBriefFieldPrefix}-hairstyle`} className="text-sm text-white/74">{t('createBatch.hairstyle')}</label>
                  <input
                    id={`${activePortraitBriefFieldPrefix}-hairstyle`}
                    value={activePortraitBrief.hairstyle}
                    onChange={(event) => onUpdatePortraitBrief({ hairstyle: event.target.value })}
                    className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
                <div className="grid min-w-0 gap-2">
                  <label htmlFor={`${activePortraitBriefFieldPrefix}-palette`} className="text-sm text-white/74">{t('createBatch.palette')}</label>
                  <input
                    id={`${activePortraitBriefFieldPrefix}-palette`}
                    value={activePortraitBrief.palettePrimary}
                    onChange={(event) => onUpdatePortraitBrief({ palettePrimary: event.target.value })}
                    className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                  />
                </div>
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${activePortraitBriefFieldPrefix}-must-keep-traits`} className="text-sm text-white/74">{t('createBatch.mustKeepTraits')}</label>
                <input
                  id={`${activePortraitBriefFieldPrefix}-must-keep-traits`}
                  value={activePortraitBrief.mustKeepTraits.join(', ')}
                  onChange={(event) => onUpdatePortraitBrief({
                    mustKeepTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                  })}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${activePortraitBriefFieldPrefix}-forbidden-traits`} className="text-sm text-white/74">{t('createBatch.forbiddenTraits')}</label>
                <input
                  id={`${activePortraitBriefFieldPrefix}-forbidden-traits`}
                  value={activePortraitBrief.forbiddenTraits.join(', ')}
                  onChange={(event) => onUpdatePortraitBrief({
                    forbiddenTraits: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                  })}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
