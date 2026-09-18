const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

/**
 * Primary-color gradient stops (mint → sky blue) for the slogan look. These
 * are the lighter brand hues; their contrast on the light hero background is
 * below the 3:1 large-text target, accepted as a deliberate visual trade-off.
 */
export const PRIMARY_GRADIENT_PALETTE = [
  '#38d6a3',
  '#0ea5e9',
] as const;

function toRgb(hex: string): [number, number, number] {
  const match = HEX_PATTERN.exec(hex);
  if (!match || !match[1]) {
    return [0, 0, 0];
  }
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** Sample a smooth color at position t (0..1) across the palette stops. */
export function sampleGradient(palette: ReadonlyArray<string>, t: number): string {
  if (palette.length === 0) {
    return '#0f172a';
  }
  if (palette.length === 1) {
    return palette[0] ?? '#0f172a';
  }
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const from = toRgb(palette[index] ?? '#0f172a');
  const to = toRgb(palette[index + 1] ?? palette[index] ?? '#0f172a');
  return toHex([
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
    from[2] + (to[2] - from[2]) * fraction,
  ]);
}

export type GradientTextProps = {
  text: string;
  palette?: ReadonlyArray<string>;
};

/**
 * Static gradient text rendered as real characters with interpolated colors.
 * Deliberately avoids `background-clip: text` and animation: both previously
 * caused expensive selection repaints, and this stays cheap and selectable.
 */
export function GradientText({ text, palette = PRIMARY_GRADIENT_PALETTE }: GradientTextProps) {
  const characters = Array.from(text);
  const visibleCount = characters.filter((character) => character.trim().length > 0).length;
  let visibleIndex = 0;

  return (
    <>
      {characters.map((character, index) => {
        if (character.trim().length === 0) {
          return <span key={index}>{character}</span>;
        }
        const position = visibleCount <= 1 ? 0 : visibleIndex / (visibleCount - 1);
        visibleIndex += 1;
        return (
          <span key={index} style={{ color: sampleGradient(palette, position) }}>
            {character}
          </span>
        );
      })}
    </>
  );
}
