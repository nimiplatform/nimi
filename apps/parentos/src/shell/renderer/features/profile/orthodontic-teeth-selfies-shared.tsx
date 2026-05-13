import type { OrthodonticPhotoSessionBundle } from '../../bridge/sqlite-bridge.js';

export function formatThumbLabel(session: OrthodonticPhotoSessionBundle['session']): string {
  if (session.note) return session.note;
  if (session.trayIndex !== null) return `第 ${session.trayIndex} 副`;
  return '一组照片';
}

export function CapsLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--nimi-text-muted)',
      }}
    >
      {children}
    </div>
  );
}
