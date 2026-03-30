import { useTranslation } from 'react-i18next';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';

type CaptureSelectionPanelProps = {
  stylePackConfirmed: boolean;
  selectedAgents: Array<Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>>;
  captureSelectionAgentIds: string[];
  onToggleCaptureSelection(agentId: string): void;
};

export function CaptureSelectionPanel(props: CaptureSelectionPanelProps) {
  const { t } = useTranslation();
  const { stylePackConfirmed, selectedAgents, captureSelectionAgentIds, onToggleCaptureSelection } = props;

  return (
    <div className="grid gap-3 rounded-3xl border border-white/8 bg-black/14 px-5 py-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('createBatch.captureSelectionEyebrow')}</div>
        <div className="text-sm text-white/62">{t('createBatch.captureSelectionDescription')}</div>
      </div>
      {!stylePackConfirmed ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
          {t('createBatch.captureSelectionBlocked')}
        </div>
      ) : (
        <div className="max-h-[280px] space-y-2 overflow-auto pr-1 ld-scroll">
          {selectedAgents.map((agent) => {
            const selected = captureSelectionAgentIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onToggleCaptureSelection(agent.id)}
                className={`flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left ${selected ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/8 bg-black/12 text-white/72'}`}
              >
                <div>
                  <div className="font-medium text-white">{agent.displayName}</div>
                  <div className="mt-1 text-xs text-white/52">{t(`importance.${agent.importance}`, { defaultValue: agent.importance })} · {agent.handle || agent.id}</div>
                </div>
                <span className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{selected ? t('createBatch.captureLabel') : t('createBatch.batchOnlyLabel')}</span>
              </button>
            );
          })}
          {selectedAgents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
              {t('createBatch.captureSelectionEmpty')}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
