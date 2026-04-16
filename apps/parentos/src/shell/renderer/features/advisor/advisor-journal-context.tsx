import { ADVISOR_EMPTY_GRADIENT } from './advisor-theme.js';

export type JournalEntryAdvisorContext = {
  entryId: string;
  recordedAt: string;
  contentType: string;
  textContent: string | null;
  dimensionName: string | null;
  tags: string[];
  recorderName: string | null;
};

const JOURNAL_CONTEXT_STARTERS = [
  '请帮我整理这条记录的关键信息',
  '这个维度还有哪些值得观察的方面',
  '有什么需要关注的信号吗',
] as const;

function formatContextDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace('T', ' ').slice(0, 16);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type AdvisorJournalContextProps = {
  context: JournalEntryAdvisorContext;
  onSelectStarter: (starter: string) => void;
};

export function AdvisorJournalContext({ context, onSelectStarter }: AdvisorJournalContextProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className={`${ADVISOR_EMPTY_GRADIENT} w-full max-w-md rounded-[30px] border border-white/80 p-6 shadow-[0_20px_52px_rgba(15,23,42,0.08)]`}>
        <p className="mb-4 text-[13px] font-semibold text-slate-900">
          关于这条随记，你想聊什么？
        </p>

        {/* Journal entry preview card */}
        <div className="mb-4 rounded-2xl border border-slate-200/60 bg-white/90 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {context.dimensionName && (
              <span className="rounded-full border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {context.dimensionName}
              </span>
            )}
            <span className="text-[10px] text-slate-400">
              {formatContextDateTime(context.recordedAt)}
            </span>
            {context.recorderName && (
              <span className="text-[10px] text-slate-400">
                记录人：{context.recorderName}
              </span>
            )}
          </div>
          {context.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {context.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-700">
            {context.textContent?.trim() || '这条随记以语音或图片为主'}
          </p>
        </div>

        {/* Starter buttons */}
        <div className="flex flex-col gap-1.5">
          {JOURNAL_CONTEXT_STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onSelectStarter(starter)}
              className="rounded-xl border border-slate-200/60 bg-white/90 px-3.5 py-2.5 text-left text-[12px] text-slate-700 transition-colors hover:bg-slate-50/80"
            >
              {starter}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
