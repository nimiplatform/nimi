import type { AdvisorSuggestion } from './advisor-suggestion-engine.js';

export type AdvisorSuggestionsProps = {
  suggestions: AdvisorSuggestion[];
  disabled: boolean;
  onSelect: (question: string) => void;
};

export function AdvisorSuggestions({
  suggestions,
  disabled,
  onSelect,
}: AdvisorSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="shrink-0 px-5 pb-2 pt-2">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(item.question)}
              className="rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-[12px] text-slate-600 transition-all hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdvisorSuggestionsSkeleton() {
  const widths = ['w-28', 'w-32', 'w-24', 'w-36'];
  return (
    <div className="shrink-0 px-5 pb-2 pt-2">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap gap-1.5">
          {widths.map((w, i) => (
            <div
              key={i}
              className={`h-[26px] ${w} animate-pulse rounded-full border border-slate-200/60 bg-white/50`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
