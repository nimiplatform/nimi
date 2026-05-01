import { useState } from 'react';
import {
  deleteOrthodonticCheckin,
  type OrthodonticCheckinRow,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';

export function CheckinHistoryStrip({
  checkins,
  last7,
  onDeleted,
  onError,
}: {
  checkins: OrthodonticCheckinRow[];
  last7: OrthodonticCheckinRow[];
  onDeleted: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (checkins.length === 0 && last7.length === 0) return null;

  const handleDelete = async (checkinId: string) => {
    if (!window.confirm('确认删除该条打卡？')) return;
    try {
      onError(null);
      await deleteOrthodonticCheckin(checkinId);
      await onDeleted();
    } catch (error) {
      catchLog('ortho', 'action:delete-checkin-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(226,232,240,0.6)' }}>
      {last7.length > 0 && (
        <div className="flex items-center gap-1">
          {last7.map((c) => (
            <div
              key={c.checkinId}
              title={`${c.checkinDate}: ${c.actualWearHours}h / ${c.prescribedHours}h`}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: bucketColor(c.complianceBucket),
              }}
            />
          ))}
          <span className="text-[12px] ml-2" style={{ color: S.sub }}>近 7 天达成率近似</span>
        </div>
      )}
      {checkins.length > 0 && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[13px]"
          style={{ background: 'transparent', color: S.sub, border: 0, cursor: 'pointer', padding: 0 }}>
          {expanded ? '收起打卡历史' : `查看打卡历史 · 近 30 天 ${checkins.length} 条`}
        </button>
      )}
      {expanded && (
        <div className="mt-2 flex flex-col" style={{ gap: 4 }}>
          {checkins.map((c) => (
            <CheckinHistoryRow key={c.checkinId} checkin={c} onDelete={() => void handleDelete(c.checkinId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckinHistoryRow({
  checkin,
  onDelete,
}: {
  checkin: OrthodonticCheckinRow;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md"
      style={{ background: 'rgba(248,250,252,0.6)' }}>
      <div className="flex items-center gap-2 text-[13px]" style={{ color: S.text }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: bucketColor(checkin.complianceBucket), flexShrink: 0 }} />
        <span style={{ color: S.sub, fontVariantNumeric: 'tabular-nums' }}>{checkin.checkinDate}</span>
        <span>{checkinSummary(checkin)}</span>
      </div>
      <button type="button" onClick={onDelete}
        className="text-[12px]"
        style={{ background: 'transparent', color: '#b91c1c', border: 0, cursor: 'pointer', padding: '0 4px' }}>
        删除
      </button>
    </div>
  );
}

function bucketColor(b: string | null): string {
  switch (b) {
    case 'done':    return '#22c55e';
    case 'partial': return '#f59e0b';
    case 'missed':  return '#ef4444';
    default:        return '#cbd5e1';
  }
}

function bucketLabel(b: string | null): string {
  switch (b) {
    case 'done':    return '达成';
    case 'partial': return '部分达成';
    case 'missed':  return '缺席';
    default:        return '未计算';
  }
}

function checkinSummary(c: OrthodonticCheckinRow): string {
  switch (c.checkinType) {
    case 'wear-daily':
    case 'retention-wear': {
      const actual = c.actualWearHours ?? 0;
      const prescribed = c.prescribedHours;
      const bucket = c.complianceBucket ? ` · ${bucketLabel(c.complianceBucket)}` : '';
      return prescribed != null
        ? `戴 ${actual}h / ${prescribed}h${bucket}`
        : `戴 ${actual}h${bucket}`;
    }
    case 'aligner-change':
      return c.alignerIndex != null ? `更换至第 ${c.alignerIndex} 副牙套` : '更换牙套';
    case 'expander-activation':
      return c.activationIndex != null ? `加力 · 第 ${c.activationIndex} 次` : '加力';
  }
}
