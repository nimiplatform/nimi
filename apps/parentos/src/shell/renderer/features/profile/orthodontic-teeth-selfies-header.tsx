import type { OrthodonticPhotoAngle, OrthodonticPhotoSessionBundle } from '../../bridge/sqlite-bridge.js';
import { CapsLabel } from './orthodontic-teeth-selfies-shared.js';

export type CompareMode = 'slide' | 'split';

// ── Header ─────────────────────────────────────────────────

export function Header({
  bundles,
  aSessionId,
  bSessionId,
  angle,
  mode,
  onAngleChange,
  onModeChange,
}: {
  bundles: OrthodonticPhotoSessionBundle[] | null;
  aSessionId: string | null;
  bSessionId: string | null;
  angle: OrthodonticPhotoAngle;
  mode: CompareMode;
  onAngleChange: (a: OrthodonticPhotoAngle) => void;
  onModeChange: (m: CompareMode) => void;
}) {
  const count = bundles?.length ?? 0;
  const a = bundles?.find((b) => b.session.sessionId === aSessionId)?.session;
  const b = bundles?.find((bb) => bb.session.sessionId === bSessionId)?.session;
  const trayDelta =
    a?.trayIndex !== undefined && a.trayIndex !== null
      ? b?.trayIndex !== undefined && b.trayIndex !== null
        ? Math.abs(b.trayIndex - a.trayIndex)
        : null
      : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 6,
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      <div>
        <CapsLabel>影像档案</CapsLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--nimi-text-primary)',
            }}
          >
            牙齿成长相册
          </span>
          {count > 0 && (
            <span style={{ fontSize: 13, color: 'var(--nimi-text-muted)' }}>
              {count} 组{trayDelta !== null ? ` · 已记录 ${trayDelta} 副变化` : ''}
            </span>
          )}
        </div>
      </div>
      {count > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented<OrthodonticPhotoAngle>
            value={angle}
            options={[
              { id: 'front', label: '正面' },
              { id: 'side', label: '侧面' },
            ]}
            onChange={onAngleChange}
          />
          <Segmented<CompareMode>
            value={mode}
            options={[
              { id: 'slide', label: '叠加', title: '拖动分割线对比' },
              { id: 'split', label: '平铺', title: '左右并排' },
            ]}
            onChange={onModeChange}
          />
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 3,
        borderRadius: 999,
        background: 'var(--nimi-surface-active)',
      }}
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            onClick={() => onChange(o.id)}
            style={{
              padding: '5px 14px',
              borderRadius: 999,
              border: 0,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: active ? '#ffffff' : 'transparent',
              color: active ? 'var(--nimi-text-primary)' : 'var(--nimi-text-muted)',
              boxShadow: active ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
              transition: 'all 160ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

