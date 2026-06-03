import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type BackgroundMutationLike = {
  error: unknown;
  isPending: boolean;
  mutate: () => void;
};

type BackgroundQueryLike = {
  data?: {
    validation?: {
      status?: string;
      errors?: Array<{ message?: string }>;
    } | null;
  } | null;
  isFetching: boolean;
};

type BackgroundValidation = {
  status?: string;
  errors?: Array<{ message?: string }>;
} | null | undefined;

type AgentConversationBackgroundSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  backgroundValid: boolean;
  selectedBackgroundAssetId: string | null | undefined;
  backgroundAssetQuery: BackgroundQueryLike;
  backgroundValidation: BackgroundValidation;
  backgroundImportError: string | null;
  clearBackgroundMutation: BackgroundMutationLike;
  backgroundImportDisabled: boolean;
  backgroundImportMutation: BackgroundMutationLike;
};

export function AgentConversationBackgroundSettingsContent(
  props: AgentConversationBackgroundSettingsContentProps,
) {
  const {
    input,
    backgroundValid,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
  } = props;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-950">
              {input.t('Chat.agentCenterBackground', { defaultValue: 'Background' })}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">
              {backgroundValid
                ? input.t('Chat.agentCenterBackgroundReadyHint', { defaultValue: 'A local background is selected for this agent.' })
                : selectedBackgroundAssetId
                  ? input.t('Chat.agentCenterBackgroundNeedsFix', { defaultValue: 'The selected local background needs attention.' })
                  : input.t('Chat.agentCenterBackgroundMissingHint', { defaultValue: 'Import a png, jpeg, or webp image for this agent.' })}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
            {backgroundValid
              ? input.t('Chat.agentCenterReady', { defaultValue: 'Ready' })
              : backgroundAssetQuery.isFetching
                ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
                : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' })}
          </span>
        </div>
        {backgroundValidation?.errors?.[0]?.message ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
            {backgroundValidation.errors[0].message}
          </div>
        ) : null}
        {(backgroundImportError || (clearBackgroundMutation.error instanceof Error ? clearBackgroundMutation.error.message : null)) ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
            {backgroundImportError || (clearBackgroundMutation.error instanceof Error ? clearBackgroundMutation.error.message : null)}
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={backgroundImportDisabled}
          onClick={() => backgroundImportMutation.mutate()}
          className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>
            {backgroundImportMutation.isPending
              ? input.t('Chat.agentCenterBackgroundImporting', { defaultValue: 'Importing…' })
              : input.t('Chat.agentCenterImportBackground', { defaultValue: 'Import background image' })}
          </span>
        </button>
        <button
          type="button"
          disabled={!selectedBackgroundAssetId || clearBackgroundMutation.isPending}
          onClick={() => clearBackgroundMutation.mutate()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {clearBackgroundMutation.isPending
            ? input.t('Chat.agentCenterBackgroundClearing', { defaultValue: 'Clearing…' })
            : input.t('Chat.agentCenterClearBackgroundSelection', { defaultValue: 'Remove background' })}
        </button>
      </div>
    </div>
  );
}
