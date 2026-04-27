import { S } from '../../app-shell/page-style.js';
import {
  PERM_LOWER_L,
  PERM_LOWER_R,
  PERM_UPPER_L,
  PERM_UPPER_R,
  PRIMARY_LOWER_L,
  PRIMARY_LOWER_R,
  PRIMARY_UPPER_L,
  PRIMARY_UPPER_R,
  TOOTH_NAMES,
} from './dental-page-domain.js';

export function ToothChart({
  selectedTeeth,
  onToggle,
  toothSet,
  recordedTeeth,
}: {
  selectedTeeth: string[];
  onToggle: (id: string) => void;
  toothSet: 'primary' | 'permanent';
  recordedTeeth: Map<string, string>;
}) {
  const isPrimary = toothSet === 'primary';
  const upperRight = isPrimary ? PRIMARY_UPPER_R : PERM_UPPER_R;
  const upperLeft = isPrimary ? PRIMARY_UPPER_L : PERM_UPPER_L;
  const lowerLeft = isPrimary ? PRIMARY_LOWER_L : PERM_LOWER_L;
  const lowerRight = isPrimary ? PRIMARY_LOWER_R : PERM_LOWER_R;
  const selected = new Set(selectedTeeth);

  const toothColor = (id: string) => {
    if (selected.has(id)) return { bg: S.accent, color: '#fff' };
    const eventType = recordedTeeth.get(id);
    if (eventType === 'caries') return { bg: '#fecaca', color: '#dc2626' };
    if (eventType === 'loss') return { bg: '#f1f5f9', color: '#475569' };
    if (eventType === 'eruption') return { bg: '#d1fae5', color: '#059669' };
    if (eventType === 'filling' || eventType === 'sealant') return { bg: '#dbeafe', color: '#2563eb' };
    return { bg: '#f5f3ef', color: S.text };
  };

  const renderRow = (teeth: string[], label: string) => (
    <div className="flex items-center gap-0.5">
      <span className="mr-1 w-8 text-right text-[12px]" style={{ color: S.sub }}>{label}</span>
      {teeth.map((id) => {
        const colors = toothColor(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            title={`${id} ${TOOTH_NAMES[id] ?? ''}`}
            className="h-7 w-7 rounded-lg text-[12px] font-bold transition-all hover:scale-110"
            style={{ background: colors.bg, color: colors.color }}
          >
            {id}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-semibold" style={{ color: S.text }}>
          {isPrimary ? '乳牙 (20颗)' : '恒牙 (32颗)'} · 点击选择牙位（可多选）
        </p>
        <div className="flex gap-1">
          {[
            { color: '#d1fae5', label: '萌出' },
            { color: '#f1f5f9', label: '脱落' },
            { color: '#fecaca', label: '龋齿' },
            { color: '#dbeafe', label: '治疗' },
          ].map((item) => (
            <span key={item.label} className="flex items-center gap-0.5 text-[12px]" style={{ color: S.sub }}>
              <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-[12px]" style={{ color: S.sub }}>上颌</p>
        <div className="flex gap-1">
          {renderRow(upperRight, '右')}
          <span className="w-3" />
          {renderRow(upperLeft, '')}
          <span className="ml-1 w-8 text-[12px]" style={{ color: S.sub }}>左</span>
        </div>
        <div className="my-1 h-px w-full" style={{ background: S.border }} />
        <div className="flex gap-1">
          {renderRow(lowerRight, '右')}
          <span className="w-3" />
          {renderRow(lowerLeft, '')}
          <span className="ml-1 w-8 text-[12px]" style={{ color: S.sub }}>左</span>
        </div>
        <p className="text-[12px]" style={{ color: S.sub }}>下颌</p>
      </div>
      {selectedTeeth.length > 0 ? (
        <p className="mt-2 text-center text-[13px] font-medium" style={{ color: S.accent }}>
          已选 {selectedTeeth.length} 颗: {selectedTeeth.map((id) => `${id}(${TOOTH_NAMES[id] ?? ''})`).join('、')}
        </p>
      ) : null}
    </div>
  );
}
