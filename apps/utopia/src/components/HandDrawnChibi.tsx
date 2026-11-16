import type { CSSProperties } from 'react';
import type { CompanionPresenceTone } from './CompanionAvatar.js';
import {
  CHIBI_CLOAK_OPTIONS,
  CHIBI_HAIR_COLOR_OPTIONS,
  CHIBI_SKIN_OPTIONS,
  type ChibiAppearance,
  type ChibiEyeStyle,
  type ChibiHairStyle,
  type ChibiHeadwear,
} from '../domain/chibi-wardrobe.js';

const INK = '#3E3025';

function renderBackHair(hairStyle: ChibiHairStyle, fill: string, accent: string) {
  switch (hairStyle) {
    case 'twintails':
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.5" cy="31.5" r="7.2" fill={fill} />
          <circle cx="53.5" cy="31.5" r="7.2" fill={fill} />
          <ellipse cx="15.2" cy="28.5" rx="2.2" ry="3.2" fill={accent} />
          <ellipse cx="48.8" cy="28.5" rx="2.2" ry="3.2" fill={accent} />
          <path d="M 13 33 C 12 19, 21 13.5, 32 13.5 C 43 13.5, 52 19, 51 33 Z" fill={fill} />
        </g>
      );
    case 'curly':
      return (
        <g fill={fill} stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13" cy="27" r="6.4" />
          <circle cx="12.5" cy="38" r="6.2" />
          <circle cx="51" cy="27" r="6.4" />
          <circle cx="51.5" cy="38" r="6.2" />
          <circle cx="21" cy="18.5" r="6.6" />
          <circle cx="43" cy="18.5" r="6.6" />
          <circle cx="32" cy="16.5" r="7" />
        </g>
      );
    case 'bob':
      return (
        <path
          d="M 11.5 35 C 10.5 20, 20 13.5, 32 13.5 C 44 13.5, 53.5 20, 52.5 35 C 52 44, 48.2 48.5, 43.5 48.5 L 20.5 48.5 C 15.8 48.5, 12 44, 11.5 35 Z"
          fill={fill}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      );
    case 'fluffy':
      return (
        <path
          d="M 11 33 L 8.5 36.5 L 13 39.5 C 14 45, 19 47.5, 32 47.5 C 45 47.5, 50 45, 51 39.5 L 55.5 36.5 L 53 33 C 52.5 19.5, 43.5 13.5, 32 13.5 C 20.5 13.5, 11.5 19.5, 11 33 Z"
          fill={fill}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      );
    case 'pixie':
      return (
        <path
          d="M 12.5 33 L 10 30.5 L 13.5 26.5 C 15 18, 22.5 14, 32 14 C 41.5 14, 49 18, 50.5 26.5 L 54 30.5 L 51.5 33 Z"
          fill={fill}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      );
    case 'side-part':
    default:
      return (
        <path
          d="M 12.5 35 C 11.8 20.5, 20.5 14, 32 14 C 43.5 14, 52.2 20.5, 51.5 35 C 51 42.5, 47.8 46.8, 43.8 47 L 20.2 47 C 16.2 46.8, 13 42.5, 12.5 35 Z"
          fill={fill}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      );
  }
}

function renderFrontHair(hairStyle: ChibiHairStyle, fill: string, highlight: string) {
  switch (hairStyle) {
    case 'bob':
      return (
        <g>
          <path
            d="M 13.5 33 C 13.5 20, 21.5 15, 32 15 C 42.5 15, 50.5 20, 50.5 33 L 49.5 41.5 C 47.2 40.5, 46.5 36, 46.5 29.5 L 38.5 29 C 37.5 26.2, 36.8 26.2, 35.8 29 L 27.2 29 C 26.2 26.2, 25.5 26.2, 24.5 29 L 17.5 29.5 C 17.5 36, 16.8 40.5, 14.5 41.5 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 22 20.5 Q 32 18.2 42 20.5"
            fill="none"
            stroke={highlight}
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.82"
          />
        </g>
      );
    case 'fluffy':
      return (
        <g>
          <path
            d="M 13.5 31 C 14 19.5, 22 14.8, 32 14.8 C 42 14.8, 50 19.5, 50.5 31 L 46.2 27.5 L 41.5 30.2 L 35.5 25.8 L 30.5 30.4 L 24.5 26.5 L 18.5 30.2 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 23 19.8 Q 32 17.6 40.5 19.8"
            fill="none"
            stroke={highlight}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.8"
          />
        </g>
      );
    case 'twintails':
      return (
        <g>
          <path
            d="M 14 31 C 14.5 19.8, 22 15, 32 15 C 42 15, 49.5 19.8, 50 31 C 44.5 29.5, 37.5 26.5, 32 22.8 C 26.5 26.5, 19.5 29.5, 14 31 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 21.5 20.5 Q 27 18.4 31 19.8 M 33 19.8 Q 37 18.4 42.5 20.5"
            fill="none"
            stroke={highlight}
            strokeWidth="1.9"
            strokeLinecap="round"
            opacity="0.82"
          />
        </g>
      );
    case 'curly':
      return (
        <g>
          <path
            d="M 14 29.5 C 14.5 19.5, 22 15, 32 15 C 42 15, 49.5 19.5, 50 29.5 C 46.5 31, 42.5 29.8, 40.5 27.2 C 37.8 30.5, 32 30.8, 28.5 27.4 C 25.5 30.4, 19 31, 14 29.5 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 23 20.5 Q 32 18.2 41 20.5"
            fill="none"
            stroke={highlight}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.78"
          />
        </g>
      );
    case 'pixie':
      return (
        <g>
          <path
            d="M 14.5 28.5 C 15.5 19.5, 22.5 15, 32 15 C 41.5 15, 48.5 19.5, 49.5 28.5 L 43.5 25.5 L 38.5 27.8 L 32.5 24.2 L 26.5 27.8 L 20.5 25.2 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 24 19.8 Q 32 18 40 19.8"
            fill="none"
            stroke={highlight}
            strokeWidth="1.9"
            strokeLinecap="round"
            opacity="0.8"
          />
        </g>
      );
    case 'side-part':
    default:
      return (
        <g>
          <path
            d="M 13.8 32 C 14.2 19.8, 22 15, 32 15 C 42 15, 49.8 19.8, 50.2 32 C 44 30.8, 33.5 28, 24.5 23.2 C 21.8 27.8, 18.2 30.8, 13.8 32 Z"
            fill={fill}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 25.5 19.8 Q 35 18.5 43.5 21.5"
            fill="none"
            stroke={highlight}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.82"
          />
        </g>
      );
  }
}

function renderEyesAndMouth(eyes: ChibiEyeStyle, presenceTone?: CompanionPresenceTone) {
  const cheerfulMouth = eyes === 'happy' || presenceTone === 'shared' || presenceTone === 'conversing';

  return (
    <g>
      <g className="utopia-chibi-eyes">
        {eyes === 'happy' && (
          <g fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M 20.8 36.8 Q 24.3 32.2 27.8 36.8" />
            <path d="M 36.2 36.8 Q 39.7 32.2 43.2 36.8" />
          </g>
        )}

        {eyes === 'sparkle' && (
          <g>
            <ellipse cx="24.5" cy="36" rx="2.7" ry="3.3" fill={INK} />
            <ellipse cx="39.5" cy="36" rx="2.7" ry="3.3" fill={INK} />
            <circle cx="23.6" cy="34.7" r="1.15" fill="#FFFDF7" />
            <circle cx="38.6" cy="34.7" r="1.15" fill="#FFFDF7" />
          </g>
        )}

        {eyes === 'starry' && (
          <g>
            <ellipse cx="24.4" cy="36" rx="3.1" ry="3.6" fill={INK} />
            <ellipse cx="39.6" cy="36" rx="3.1" ry="3.6" fill={INK} />
            <path d="M 24.4 33.4 L 25.1 35.2 L 26.8 35.8 L 25.1 36.4 L 24.4 38.2 L 23.7 36.4 L 22 35.8 L 23.7 35.2 Z" fill="#FFF3B0" />
            <path d="M 39.6 33.4 L 40.3 35.2 L 42 35.8 L 40.3 36.4 L 39.6 38.2 L 38.9 36.4 L 37.2 35.8 L 38.9 35.2 Z" fill="#FFF3B0" />
          </g>
        )}

        {eyes === 'gentle' && (
          <g>
            <ellipse cx="24.5" cy="36.6" rx="2.45" ry="2.7" fill={INK} />
            <ellipse cx="39.5" cy="36.6" rx="2.45" ry="2.7" fill={INK} />
            <circle cx="23.8" cy="35.6" r="1" fill="#FFFDF7" />
            <circle cx="38.8" cy="35.6" r="1" fill="#FFFDF7" />
            <path d="M 20.4 33.8 Q 24.4 32.1 27.8 33.1" fill="none" stroke={INK} strokeWidth="1.85" strokeLinecap="round" />
            <path d="M 36.2 33.1 Q 39.6 32.1 43.6 33.8" fill="none" stroke={INK} strokeWidth="1.85" strokeLinecap="round" />
          </g>
        )}

        {!['happy', 'sparkle', 'starry', 'gentle', 'curious'].includes(eyes) && (
          <g>
            <ellipse cx="24.5" cy="36" rx="2.7" ry="3.3" fill={INK} />
            <ellipse cx="39.5" cy="36" rx="2.7" ry="3.3" fill={INK} />
            <circle cx="23.6" cy="34.7" r="1.15" fill="#FFFDF7" />
            <circle cx="38.6" cy="34.7" r="1.15" fill="#FFFDF7" />
          </g>
        )}

        {eyes === 'curious' && (
          <g>
            <circle cx="24.5" cy="36" r="2.7" fill={INK} />
            <circle cx="39.5" cy="36" r="2.7" fill={INK} />
            <circle cx="25.3" cy="35" r="1.05" fill="#FFFDF7" />
            <circle cx="40.3" cy="35" r="1.05" fill="#FFFDF7" />
            <path d="M 22 31.4 Q 24.5 30.2 27 31.4" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M 37 31.4 Q 39.5 30.2 42 31.4" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}
      </g>

      {/* Hand-drawn Mouth */}
      {eyes === 'curious' ? (
        <path
          d="M 28.6 42.3 Q 30.3 44.3 32 42.4 Q 33.7 44.3 35.4 42.3"
          fill="none"
          stroke={INK}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : cheerfulMouth ? (
        <path
          d="M 29.1 41.8 Q 32 46.2 34.9 41.8 Z"
          fill="#E77B6F"
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M 29.4 42.2 Q 32 44.8 34.6 42.2"
          fill="none"
          stroke={INK}
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

function renderHeadwear(headwear: ChibiHeadwear, accent: string, hairFill: string) {
  switch (headwear) {
    case 'star-hat':
      return (
        <g data-utopia-chibi-headwear="star-hat">
          <path
            d="M 21.5 17.5 L 35.5 3 L 45.5 19.2 Q 33.5 21.6 21.5 17.5 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 25.5 13.2 Q 34 15.2 42.2 14.2"
            fill="none"
            stroke="#FFF8DF"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="36" cy="3" r="3.4" fill="#FFF7D4" stroke={INK} strokeWidth="2.2" />
        </g>
      );
    case 'sprout':
      return (
        <g data-utopia-chibi-headwear="sprout">
          <path
            d="M 32 15.8 Q 32.5 10.5 32 7.8"
            fill="none"
            stroke={INK}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M 32 9 C 25.5 4.2, 20.5 7.5, 24.5 12.2 C 27.2 14.2, 30.5 12, 32 9 Z"
            fill="#88CA6C"
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 32 8.8 C 37.5 3.6, 43.2 6.8, 39.5 11.8 C 36.8 13.8, 33.6 11.6, 32 8.8 Z"
            fill="#A2DE84"
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </g>
      );
    case 'beret':
      return (
        <g data-utopia-chibi-headwear="beret">
          <path
            d="M 32.5 8.5 L 34.5 5.2"
            fill="none"
            stroke={INK}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M 15.5 20.5 C 14.5 10.8, 28.5 7, 44.5 11 C 50.5 12.6, 49.5 19.5, 44 21.2 Q 30 18.2 15.5 20.5 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </g>
      );
    case 'sun-hat':
      return (
        <g data-utopia-chibi-headwear="sun-hat">
          <ellipse
            cx="32"
            cy="18.2"
            rx="21.5"
            ry="5.2"
            fill="#F4D58D"
            stroke={INK}
            strokeWidth="2.3"
          />
          <path
            d="M 19.5 17.5 C 20 8.2, 44 8.2, 44.5 17.5 Z"
            fill="#F8DF9E"
            stroke={INK}
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path
            d="M 19.8 16.5 Q 32 18.8 44.2 16.5"
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      );
    case 'flower-crown':
      return (
        <g data-utopia-chibi-headwear="flower-crown">
          <path
            d="M 16.5 21.5 Q 32 16.5 47.5 21.5"
            fill="none"
            stroke="#5D9652"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="22" cy="19.5" r="3.6" fill="#FFF7DF" stroke={INK} strokeWidth="1.9" />
          <circle cx="22" cy="19.5" r="1.3" fill="#F2A93B" />
          <circle cx="32" cy="17.8" r="4" fill="#F69C90" stroke={INK} strokeWidth="1.9" />
          <circle cx="32" cy="17.8" r="1.4" fill="#FFF7DF" />
          <circle cx="42" cy="19.5" r="3.6" fill="#FCE28B" stroke={INK} strokeWidth="1.9" />
          <circle cx="42" cy="19.5" r="1.3" fill="#E67E6E" />
        </g>
      );
    case 'goggles':
      return (
        <g data-utopia-chibi-headwear="goggles">
          <path
            d="M 14.5 20.5 Q 32 18.2 49.5 20.5"
            fill="none"
            stroke={INK}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="25.2" cy="19.2" r="5.2" fill="#E3A548" stroke={INK} strokeWidth="2.1" />
          <circle cx="38.8" cy="19.2" r="5.2" fill="#E3A548" stroke={INK} strokeWidth="2.1" />
          <circle cx="25.2" cy="19.2" r="3.2" fill="#B5E5F7" stroke={INK} strokeWidth="1.5" />
          <circle cx="38.8" cy="19.2" r="3.2" fill="#B5E5F7" stroke={INK} strokeWidth="1.5" />
          <circle cx="24.2" cy="18.2" r="1" fill="#FFFFFF" />
          <circle cx="37.8" cy="18.2" r="1" fill="#FFFFFF" />
        </g>
      );
    case 'ribbon':
      return (
        <g data-utopia-chibi-headwear="ribbon">
          <path
            d="M 38 15.5 C 31.5 9.5, 28 15.5, 34.5 18.5 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 39.5 15.5 C 46 9.5, 49.5 15.5, 43 18.5 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="38.8" cy="16.2" r="2.7" fill="#FFF6DC" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 'sailor-cap':
      return (
        <g data-utopia-chibi-headwear="sailor-cap">
          <path
            d="M 17.5 18.5 C 17 9.5, 47 9.5, 46.5 18.5 Z"
            fill="#FFFDF7"
            stroke={INK}
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path
            d="M 16.5 18.2 Q 32 21.4 47.5 18.2 L 46.2 21.6 Q 32 24.4 17.8 21.6 Z"
            fill="#3B729C"
            stroke={INK}
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <circle cx="32" cy="8.5" r="2.4" fill={accent} stroke={INK} strokeWidth="1.9" />
        </g>
      );
    case 'bamboo-hat':
      return (
        <g data-utopia-chibi-headwear="bamboo-hat">
          <path
            d="M 9.5 21.2 L 32 6.8 L 54.5 21.2 Q 32 24.6 9.5 21.2 Z"
            fill="#DFC484"
            stroke={INK}
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path
            d="M 32 7.4 L 21 21.4 M 32 7.4 L 32 22.4 M 32 7.4 L 43 21.4"
            fill="none"
            stroke="#9B7C43"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>
      );
    case 'cat-ears':
      return (
        <g data-utopia-chibi-headwear="cat-ears">
          <path
            d="M 16.5 21.5 L 18.5 9.2 L 27.5 16.8 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path d="M 19.2 18.6 L 20.2 12.6 L 25.2 16.8 Z" fill="#F9C5C7" />
          <path
            d="M 47.5 21.5 L 45.5 9.2 L 36.5 16.8 Z"
            fill={accent}
            stroke={INK}
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path d="M 44.8 18.6 L 43.8 12.6 L 38.8 16.8 Z" fill="#F9C5C7" />
        </g>
      );
    case 'earmuffs':
      return (
        <g data-utopia-chibi-headwear="earmuffs">
          <path
            d="M 11.5 32 C 11.5 14.5, 52.5 14.5, 52.5 32"
            fill="none"
            stroke={accent}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <circle cx="11.2" cy="34.5" r="5.6" fill="#FFF7E8" stroke={INK} strokeWidth="2.2" />
          <circle cx="52.8" cy="34.5" r="5.6" fill="#FFF7E8" stroke={INK} strokeWidth="2.2" />
        </g>
      );
    case 'none':
    default:
      return (
        <path
          data-utopia-chibi-headwear="none"
          d="M 31 15.2 Q 33.8 8.2 38.8 11.2 Q 34.8 12.6 33.4 15.5 Z"
          fill={hairFill}
          stroke={INK}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      );
  }
}

export function HandDrawnChibiHeadSvg(props: {
  readonly appearance: ChibiAppearance;
  readonly presenceTone?: CompanionPresenceTone;
  readonly className?: string;
  readonly croppedForBadge?: boolean;
}) {
  const { appearance, presenceTone, className = '', croppedForBadge = false } = props;
  const skin = CHIBI_SKIN_OPTIONS.find((s) => s.value === appearance.skinTone) ?? CHIBI_SKIN_OPTIONS[0]!;
  const hair = CHIBI_HAIR_COLOR_OPTIONS.find((h) => h.value === appearance.hairColor) ?? CHIBI_HAIR_COLOR_OPTIONS[0]!;
  const cloak = CHIBI_CLOAK_OPTIONS.find((c) => c.value === appearance.cloakColor) ?? CHIBI_CLOAK_OPTIONS[0]!;

  return (
    <svg
      className={`utopia-chibi-head-svg ${className}`.trim()}
      viewBox={croppedForBadge ? '5 2 54 55' : '0 0 64 56'}
      aria-hidden="true"
    >
      {/* Back Hair Silhouette */}
      {renderBackHair(appearance.hairStyle, hair.fill, cloak.accent)}

      {/* Cozy Collar & Shoulder Peek for Circular Badges */}
      {croppedForBadge && (
        <g>
          <path
            d="M 20.5 48.5 C 18.2 51.5, 17.5 55.5, 17.5 58 L 46.5 58 C 46.5 55.5, 45.8 51.5, 43.5 48.5 Z"
            fill={cloak.cape}
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 23.5 48.2 C 21.5 50.6, 22.4 54.4, 27 54.4 C 29.6 54.4, 31.3 52.8, 32 51.2 C 32.7 52.8, 34.4 54.4, 37 54.4 C 41.6 54.4, 42.5 50.6, 40.5 48.2 Z"
            fill={cloak.trim}
            stroke={INK}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </g>
      )}

      {/* Little Chibi Ears */}
      <circle cx="14.2" cy="36.8" r="3.8" fill={skin.fill} stroke={INK} strokeWidth="2.3" />
      <circle cx="49.8" cy="36.8" r="3.8" fill={skin.fill} stroke={INK} strokeWidth="2.3" />

      {/* Chubby Picture-Book Chibi Head */}
      <path
        d="M 14.5 34.5 C 14 21.5, 21.8 16.5, 32 16.5 C 42.2 16.5, 50 21.5, 49.5 34.5 C 49 46.2, 42.2 50.8, 32 50.8 C 21.8 50.8, 15 46.2, 14.5 34.5 Z"
        fill={skin.fill}
        stroke={INK}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Soft Gouache Chin Shading */}
      <path
        d="M 18.5 44.5 Q 32 50 45.5 44.5"
        fill="none"
        stroke={skin.shade}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.75"
      />

      {/* Rosy Gouache Cheek Blushes */}
      <ellipse cx="20.4" cy="40.6" rx="4.2" ry="2.4" fill={skin.blush} opacity="0.72" />
      <ellipse cx="43.6" cy="40.6" rx="4.2" ry="2.4" fill={skin.blush} opacity="0.72" />

      {/* Blinking Eyes & Expressive Mouth */}
      {renderEyesAndMouth(appearance.eyes, presenceTone)}

      {/* Front Bangs Layer */}
      {renderFrontHair(appearance.hairStyle, hair.fill, hair.highlight)}

      {/* Hand-Drawn Hat / Sprout / Wreath / Goggles */}
      {renderHeadwear(appearance.headwear, cloak.accent, hair.fill)}
    </svg>
  );
}

export function HandDrawnChibiMedallion(props: {
  readonly appearance: ChibiAppearance;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg';
  readonly presenceTone?: CompanionPresenceTone;
  readonly className?: string;
}) {
  const { appearance, size = 'sm', presenceTone, className = '' } = props;
  const cloak = CHIBI_CLOAK_OPTIONS.find((c) => c.value === appearance.cloakColor) ?? CHIBI_CLOAK_OPTIONS[0]!;

  return (
    <span
      className={`utopia-chibi-medallion size-${size} ${className}`.trim()}
      style={{
        '--chibi-badge-bg': cloak.trim,
        '--chibi-badge-ring': cloak.cape,
      } as CSSProperties}
      aria-hidden="true"
    >
      <HandDrawnChibiHeadSvg
        appearance={appearance}
        presenceTone={presenceTone}
        croppedForBadge={true}
        className="utopia-chibi-medallion-svg"
      />
      {presenceTone && (
        <span className={`utopia-presence-dot is-${presenceTone}`} />
      )}
    </span>
  );
}

export function HandDrawnChibiActorFigure(props: {
  readonly appearance: ChibiAppearance;
  readonly facing: 'left' | 'right';
  readonly presenceTone?: CompanionPresenceTone;
}) {
  const { appearance, facing, presenceTone } = props;
  const skin = CHIBI_SKIN_OPTIONS.find((s) => s.value === appearance.skinTone) ?? CHIBI_SKIN_OPTIONS[0]!;
  const hair = CHIBI_HAIR_COLOR_OPTIONS.find((h) => h.value === appearance.hairColor) ?? CHIBI_HAIR_COLOR_OPTIONS[0]!;
  const cloak = CHIBI_CLOAK_OPTIONS.find((c) => c.value === appearance.cloakColor) ?? CHIBI_CLOAK_OPTIONS[0]!;

  return (
    <span
      className={`utopia-chibi-figure facing-${facing}`}
      style={{
        '--chibi-cape': cloak.cape,
        '--chibi-hat': cloak.accent,
        '--chibi-trim': cloak.trim,
      } as CSSProperties}
    >
      {/* Unified Single-SVG Picture-Book Chibi Doll (Zero Head/Body Gap) */}
      <svg
        className="utopia-chibi-full-svg"
        viewBox="0 0 64 82"
        aria-hidden="true"
      >
        {/* 1. Back Hair Silhouette (naturally tucks behind neck & shoulders) */}
        {renderBackHair(appearance.hairStyle, hair.fill, cloak.accent)}

        {/* 2. Connected Stockinged Legs & Rounded Leather Boots */}
        <g className="utopia-chibi-leg leg-left">
          <path
            d="M 23.4 65.5 L 23.4 73.2 L 28.2 73.2 L 28.2 65.5 Z"
            fill={cloak.trim}
            stroke={INK}
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M 20.8 74.4 C 20.8 71.9, 23 71.2, 25.8 71.2 C 28.5 71.2, 29.8 72.4, 29.8 74.8 C 29.8 76.9, 28.3 77.8, 25.1 77.8 C 22 77.8, 20.8 76.6, 20.8 74.4 Z"
            fill="#5B4333"
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 22.8 73.2 Q 25.4 72.5 27.6 73.3"
            fill="none"
            stroke="#8D6E59"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </g>

        <g className="utopia-chibi-leg leg-right">
          <path
            d="M 35.8 65.5 L 35.8 73.2 L 40.6 73.2 L 40.6 65.5 Z"
            fill={cloak.trim}
            stroke={INK}
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M 34.2 74.8 C 34.2 72.4, 35.5 71.2, 38.2 71.2 C 41 71.2, 43.2 71.9, 43.2 74.4 C 43.2 76.6, 42 77.8, 38.9 77.8 C 35.7 77.8, 34.2 76.9, 34.2 74.8 Z"
            fill="#5B4333"
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 36.4 73.3 Q 38.6 72.5 41.2 73.2"
            fill="none"
            stroke="#8D6E59"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </g>

        {/* 3. Connected Swinging Coat Sleeves & Little Round Hands */}
        <g className="utopia-chibi-arm arm-left">
          <circle cx="14.2" cy="60.8" r="2.8" fill={skin.fill} stroke={INK} strokeWidth="2.1" />
          <path
            d="M 22.6 48.2 C 18.2 49.6, 14.4 53.6, 12.8 58.2 C 12.3 59.5, 13.9 60.8, 16.3 60.3 C 18.4 59.8, 20.5 56.2, 22.4 53 Z"
            fill={cloak.cape}
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 13.4 58 Q 15.3 59.1 17.2 58.2"
            fill="none"
            stroke={cloak.trim}
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </g>

        <g className="utopia-chibi-arm arm-right">
          <circle cx="49.8" cy="60.8" r="2.8" fill={skin.fill} stroke={INK} strokeWidth="2.1" />
          <path
            d="M 41.4 48.2 C 45.8 49.6, 49.6 53.6, 51.2 58.2 C 51.7 59.5, 50.1 60.8, 47.7 60.3 C 45.6 59.8, 43.5 56.2, 41.6 53 Z"
            fill={cloak.cape}
            stroke={INK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M 46.8 58.2 Q 48.7 59.1 50.6 58"
            fill="none"
            stroke={cloak.trim}
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </g>

        {/* 4. Snug Neck, Cozy A-Line Traveler Coat, Pocket & Scalloped Collar */}
        <rect
          x="27.6"
          y="46.2"
          width="8.8"
          height="6.2"
          rx="2.8"
          fill={skin.fill}
          stroke={INK}
          strokeWidth="2"
        />
        <path
          className="utopia-chibi-cloak"
          d="M 21.8 48 C 19.2 52.2, 17.6 60.2, 18 67.8 C 18.2 70.1, 23.8 71.2, 32 71.2 C 40.2 71.2, 45.8 70.1, 46 67.8 C 46.4 60.2, 44.8 52.2, 42.2 48 C 39.2 46.8, 24.8 46.8, 21.8 48 Z"
          fill={cloak.cape}
          stroke={INK}
          strokeWidth="2.35"
          strokeLinejoin="round"
        />
        <path
          d="M 19.6 66.8 Q 32 68.8 44.4 66.8"
          fill="none"
          stroke={cloak.trim}
          strokeWidth="2.1"
          strokeLinecap="round"
          opacity="0.92"
        />
        <path
          d="M 32 55.6 L 32 69.8"
          fill="none"
          stroke={INK}
          strokeWidth="1.45"
          strokeLinecap="round"
          opacity="0.28"
        />
        <path
          d="M 36.4 60.6 L 41.4 60.6 L 41.1 64.5 Q 38.8 65.3 36.7 64.5 Z"
          fill={cloak.trim}
          fillOpacity="0.55"
          stroke={INK}
          strokeWidth="1.45"
          strokeLinejoin="round"
        />
        <path
          className="utopia-chibi-collar"
          d="M 23.2 47.5 C 20.6 50.2, 21.6 55.1, 26.8 55.1 C 29.6 55.1, 31.4 53.2, 32 51.2 C 32.6 53.2, 34.4 55.1, 37.2 55.1 C 42.4 55.1, 43.4 50.2, 40.8 47.5 Z"
          fill={cloak.trim}
          stroke={INK}
          strokeWidth="2.15"
          strokeLinejoin="round"
        />
        <circle
          className="utopia-chibi-star-pin"
          cx="32"
          cy="55.3"
          r="2.3"
          fill={cloak.accent}
          stroke={INK}
          strokeWidth="1.8"
        />
        <ellipse cx="32" cy="51.1" rx="8.6" ry="2.1" fill={INK} opacity="0.14" />

        {/* 5. Connected Head, Ears, Blush, Blinking Eyes, Bangs & Hat */}
        <circle cx="14.2" cy="36.8" r="3.8" fill={skin.fill} stroke={INK} strokeWidth="2.3" />
        <circle cx="49.8" cy="36.8" r="3.8" fill={skin.fill} stroke={INK} strokeWidth="2.3" />

        <path
          d="M 14.5 34.5 C 14 21.5, 21.8 16.5, 32 16.5 C 42.2 16.5, 50 21.5, 49.5 34.5 C 49 46.2, 42.2 50.8, 32 50.8 C 21.8 50.8, 15 46.2, 14.5 34.5 Z"
          fill={skin.fill}
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M 18.5 44.5 Q 32 50 45.5 44.5"
          fill="none"
          stroke={skin.shade}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.75"
        />
        <ellipse cx="20.4" cy="40.6" rx="4.2" ry="2.4" fill={skin.blush} opacity="0.72" />
        <ellipse cx="43.6" cy="40.6" rx="4.2" ry="2.4" fill={skin.blush} opacity="0.72" />

        {renderEyesAndMouth(appearance.eyes, presenceTone)}
        {renderFrontHair(appearance.hairStyle, hair.fill, hair.highlight)}
        {renderHeadwear(appearance.headwear, cloak.accent, hair.fill)}
      </svg>
    </span>
  );
}
