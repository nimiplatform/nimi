import { ADVISOR_EMPTY_GRADIENT } from './advisor-theme.js';

export type AdvisorEmptyStateProps = {
  childName: string;
  runtimeAvailable: boolean | null;
};

export function AdvisorEmptyState({ childName, runtimeAvailable }: AdvisorEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className={`${ADVISOR_EMPTY_GRADIENT} w-full max-w-md rounded-[30px] border border-white/80 px-8 py-10 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)]`}>
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.2em] text-emerald-700/70">
          AI 顾问
        </p>
        <h2 className="mb-3 text-[24px] font-black leading-tight tracking-tight text-slate-950">
          选择或创建一个对话
        </h2>
        <p className="text-[14px] leading-6 text-slate-500">
          AI 顾问基于 {childName} 的档案和本地记录工作
        </p>
        {runtimeAvailable === false && (
          <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-2 text-[14px] text-amber-800">
            nimi runtime 未连接，将使用本地结构化事实
          </div>
        )}
      </div>
    </div>
  );
}
