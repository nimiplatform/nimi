import type { CSSProperties } from 'react';
import {
  resolveWorldLandmarks,
  type WorldScenicLandmark,
} from '../domain/world-landmarks.js';

function LandmarkGlyph(props: { readonly kind: WorldScenicLandmark['glyph'] }) {
  switch (props.kind) {
    case 'lighthouse':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 14L7 5h2l1 9" />
          <path d="M5 14h6M6.5 5V3L8 2l1.5 1v2" />
          <path d="M3 4l2 .5M13 4l-2 .5" />
        </svg>
      );
    case 'bridge':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 11.5c2.2-4 10.8-4 13 0" />
          <path d="M1.5 8.5c2.8-2.8 10.2-2.8 13 0" />
          <path d="M5 7v3.2M11 7v3.2" />
        </svg>
      );
    case 'windmill':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" />
          <circle cx="8" cy="8" r="1.6" />
        </svg>
      );
    case 'boat':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 10.5h12l-2 3H4l-2-3Z" />
          <path d="M8 3v7.5M8 3.5l4 4.5H8" />
        </svg>
      );
    case 'spring':
    case 'hearth':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5.5 9.5c0-1.8 1.5-2.6 1.5-4.4M9.5 9.5c0-1.8 1.5-2.6 1.5-4.4" />
          <ellipse cx="8" cy="12.2" rx="5.2" ry="1.8" />
        </svg>
      );
    case 'flower':
    case 'archway':
    case 'market':
    case 'postbox':
    default:
      return (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5l1.9 4.6 4.6 1.9-4.6 1.9L8 14.5l-1.9-4.6L1.5 8l4.6-1.9L8 1.5Z" />
        </svg>
      );
  }
}

export function WorldSceneryLayer(props: {
  readonly habitatId: string;
  readonly selectedLandmarkId: string | null;
  readonly projectPercent?: (
    xPercent: number,
    yPercent: number,
    offsetX?: string,
    offsetY?: string,
  ) => CSSProperties;
  readonly onSelectLandmark: (landmark: WorldScenicLandmark) => void;
}) {
  const {
    habitatId,
    selectedLandmarkId,
    projectPercent,
    onSelectLandmark,
  } = props;

  const landmarks = resolveWorldLandmarks(habitatId);
  if (landmarks.length === 0) return null;

  return (
    <div className="utopia-landmarks-layer" role="group" aria-label="洞天风物地标">
      {landmarks.map((landmark) => {
        const isSelected = selectedLandmarkId === landmark.id;
        const posStyle = projectPercent
          ? projectPercent(landmark.xPercent, landmark.yPercent)
          : { left: `${landmark.xPercent}%`, top: `${landmark.yPercent}%` };
        return (
          <div
            key={landmark.id}
            className={`utopia-landmark-node ${isSelected ? 'is-selected' : ''}`}
            style={posStyle}
          >
            <button
              type="button"
              className="utopia-landmark-pin-btn"
              aria-pressed={isSelected}
              aria-label={`风物地标：${landmark.name}（${landmark.categoryLabel}）`}
              title={`${landmark.name} · ${landmark.categoryLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectLandmark(landmark);
              }}
            >
              <span className="utopia-landmark-glyph" aria-hidden="true">
                <LandmarkGlyph kind={landmark.glyph} />
              </span>
              <span className="utopia-landmark-title">{landmark.name}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
