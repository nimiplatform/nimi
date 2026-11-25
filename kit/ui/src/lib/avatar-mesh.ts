export const AVATAR_MESH_PALETTE_IDS = [
  'glacier',
  'mint',
  'apricot',
  'sage',
  'rose',
  'amber',
  'periwinkle',
  'slate',
] as const;

export type AvatarMeshPaletteId = (typeof AVATAR_MESH_PALETTE_IDS)[number];

export type AvatarMeshPaletteTheme = {
  readonly base: string;
  readonly glowA: string;
  readonly glowB: string;
  readonly glowC: string;
  readonly ink: string;
  readonly border: string;
};

export type AvatarMeshPalette = {
  readonly id: AvatarMeshPaletteId;
  readonly labelEn: string;
  readonly labelZh: string;
  readonly swatchFrom: string;
  readonly swatchTo: string;
  readonly light: AvatarMeshPaletteTheme;
  readonly dark: AvatarMeshPaletteTheme;
};

export const AVATAR_MESH_PALETTES: readonly AvatarMeshPalette[] = [
  {
    id: 'glacier',
    labelEn: 'Glacier Blue',
    labelZh: '冰川蓝',
    swatchFrom: '#3B82F6',
    swatchTo: '#06B6D4',
    light: {
      base: '#EBF4FF',
      glowA: 'rgba(147, 197, 253, 0.76)',
      glowB: 'rgba(191, 219, 254, 0.72)',
      glowC: 'rgba(224, 242, 254, 0.58)',
      ink: '#1E40AF',
      border: 'rgba(29, 78, 216, 0.12)',
    },
    dark: {
      base: '#132544',
      glowA: 'rgba(37, 99, 235, 0.60)',
      glowB: 'rgba(56, 189, 248, 0.36)',
      glowC: 'rgba(30, 58, 138, 0.48)',
      ink: '#DBEAFE',
      border: 'rgba(191, 219, 254, 0.16)',
    },
  },
  {
    id: 'mint',
    labelEn: 'Mint Breeze',
    labelZh: '薄荷青',
    swatchFrom: '#14B8A6',
    swatchTo: '#38BDF8',
    light: {
      base: '#E6FBF6',
      glowA: 'rgba(94, 234, 212, 0.72)',
      glowB: 'rgba(153, 246, 228, 0.68)',
      glowC: 'rgba(186, 230, 253, 0.58)',
      ink: '#0F5E59',
      border: 'rgba(15, 118, 110, 0.12)',
    },
    dark: {
      base: '#0E2E2E',
      glowA: 'rgba(13, 148, 136, 0.58)',
      glowB: 'rgba(34, 211, 238, 0.34)',
      glowC: 'rgba(17, 94, 89, 0.46)',
      ink: '#CCFBF1',
      border: 'rgba(153, 246, 228, 0.16)',
    },
  },
  {
    id: 'apricot',
    labelEn: 'Warm Apricot',
    labelZh: '暖杏桃',
    swatchFrom: '#F97316',
    swatchTo: '#FB7185',
    light: {
      base: '#FFF2E6',
      glowA: 'rgba(253, 186, 116, 0.72)',
      glowB: 'rgba(254, 205, 211, 0.68)',
      glowC: 'rgba(254, 243, 199, 0.58)',
      ink: '#9A3412',
      border: 'rgba(194, 65, 12, 0.12)',
    },
    dark: {
      base: '#3A1F14',
      glowA: 'rgba(234, 88, 12, 0.56)',
      glowB: 'rgba(251, 113, 133, 0.36)',
      glowC: 'rgba(154, 52, 18, 0.46)',
      ink: '#FFEDD5',
      border: 'rgba(254, 215, 170, 0.16)',
    },
  },
  {
    id: 'sage',
    labelEn: 'Sage Dew',
    labelZh: '鼠尾草',
    swatchFrom: '#22C55E',
    swatchTo: '#14B8A6',
    light: {
      base: '#ECFDF3',
      glowA: 'rgba(134, 239, 172, 0.68)',
      glowB: 'rgba(167, 243, 208, 0.68)',
      glowC: 'rgba(217, 249, 157, 0.50)',
      ink: '#166534',
      border: 'rgba(21, 128, 61, 0.12)',
    },
    dark: {
      base: '#112E22',
      glowA: 'rgba(22, 163, 74, 0.54)',
      glowB: 'rgba(45, 212, 191, 0.34)',
      glowC: 'rgba(22, 101, 52, 0.46)',
      ink: '#DCFCE7',
      border: 'rgba(187, 247, 208, 0.16)',
    },
  },
  {
    id: 'rose',
    labelEn: 'Rose Cloud',
    labelZh: '柔雾粉',
    swatchFrom: '#EC4899',
    swatchTo: '#FB7185',
    light: {
      base: '#FFF0F6',
      glowA: 'rgba(249, 168, 212, 0.68)',
      glowB: 'rgba(254, 205, 211, 0.68)',
      glowC: 'rgba(253, 230, 138, 0.46)',
      ink: '#9D174D',
      border: 'rgba(190, 24, 93, 0.12)',
    },
    dark: {
      base: '#381529',
      glowA: 'rgba(219, 39, 119, 0.56)',
      glowB: 'rgba(251, 113, 133, 0.36)',
      glowC: 'rgba(157, 23, 77, 0.46)',
      ink: '#FCE7F3',
      border: 'rgba(251, 207, 232, 0.16)',
    },
  },
  {
    id: 'amber',
    labelEn: 'Amber Sand',
    labelZh: '琥珀光',
    swatchFrom: '#F59E0B',
    swatchTo: '#FB923C',
    light: {
      base: '#FFFBEB',
      glowA: 'rgba(252, 211, 77, 0.66)',
      glowB: 'rgba(253, 186, 116, 0.64)',
      glowC: 'rgba(254, 240, 138, 0.52)',
      ink: '#92400E',
      border: 'rgba(180, 83, 9, 0.12)',
    },
    dark: {
      base: '#36240D',
      glowA: 'rgba(217, 119, 6, 0.56)',
      glowB: 'rgba(245, 158, 11, 0.34)',
      glowC: 'rgba(146, 64, 14, 0.46)',
      ink: '#FEF3C7',
      border: 'rgba(253, 230, 138, 0.16)',
    },
  },
  {
    id: 'periwinkle',
    labelEn: 'Periwinkle Mist',
    labelZh: '鸢尾蓝',
    swatchFrom: '#6366F1',
    swatchTo: '#3B82F6',
    light: {
      base: '#EEF2FF',
      glowA: 'rgba(165, 180, 252, 0.70)',
      glowB: 'rgba(191, 219, 254, 0.68)',
      glowC: 'rgba(224, 231, 255, 0.58)',
      ink: '#3730A3',
      border: 'rgba(67, 56, 202, 0.12)',
    },
    dark: {
      base: '#1B204A',
      glowA: 'rgba(79, 70, 229, 0.58)',
      glowB: 'rgba(96, 165, 250, 0.36)',
      glowC: 'rgba(55, 48, 163, 0.46)',
      ink: '#E0E7FF',
      border: 'rgba(199, 210, 254, 0.16)',
    },
  },
  {
    id: 'slate',
    labelEn: 'Slate Pearl',
    labelZh: '静谧灰蓝',
    swatchFrom: '#64748B',
    swatchTo: '#38BDF8',
    light: {
      base: '#F1F5F9',
      glowA: 'rgba(148, 163, 184, 0.52)',
      glowB: 'rgba(203, 213, 225, 0.66)',
      glowC: 'rgba(219, 234, 254, 0.56)',
      ink: '#1E293B',
      border: 'rgba(51, 65, 85, 0.13)',
    },
    dark: {
      base: '#1B2538',
      glowA: 'rgba(71, 85, 105, 0.56)',
      glowB: 'rgba(100, 116, 139, 0.38)',
      glowC: 'rgba(51, 65, 85, 0.46)',
      ink: '#E2E8F0',
      border: 'rgba(203, 213, 225, 0.16)',
    },
  },
] as const;

const PALETTE_BY_ID = new Map<AvatarMeshPaletteId, AvatarMeshPalette>(
  AVATAR_MESH_PALETTES.map((palette) => [palette.id, palette]),
);

const CJK_OR_KANA_OR_HANGUL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;

function hashAvatarSeed(seed: string): number {
  const normalized = seed.trim().replace(/^@+/u, '').toLowerCase() || 'nimi';
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getAvatarMonogram(name: string | null | undefined): string {
  const cleaned = String(name ?? '').trim().replace(/^@+/u, '').trim();
  if (!cleaned) return '?';
  const chars = Array.from(cleaned);
  const first = chars[0];
  if (!first) return '?';
  if (CJK_OR_KANA_OR_HANGUL.test(first)) {
    return first;
  }
  const words = cleaned.split(/\s+/u).filter(Boolean);
  if (words.length >= 2) {
    const firstInitial = Array.from(words[0] ?? '')[0] ?? '';
    const secondInitial = Array.from(words[1] ?? '')[0] ?? '';
    if (firstInitial && secondInitial && !CJK_OR_KANA_OR_HANGUL.test(secondInitial)) {
      return `${firstInitial}${secondInitial}`.toUpperCase();
    }
  }
  return first.toUpperCase();
}

export function resolveAvatarMeshPalette(
  seed: string | null | undefined,
  paletteId?: AvatarMeshPaletteId | null,
): AvatarMeshPalette {
  if (paletteId) {
    const exact = PALETTE_BY_ID.get(paletteId);
    if (exact) return exact;
  }
  const index = hashAvatarSeed(String(seed ?? '')) % AVATAR_MESH_PALETTES.length;
  return AVATAR_MESH_PALETTES[index] ?? AVATAR_MESH_PALETTES[0]!;
}

export function getAvatarMeshInlineStyle(
  palette: AvatarMeshPalette,
  scheme: 'light' | 'dark' = 'light',
): {
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  boxShadow: string;
} {
  const theme = scheme === 'dark' ? palette.dark : palette.light;
  return {
    backgroundColor: theme.base,
    backgroundImage: [
      `radial-gradient(circle at 22% 18%, ${theme.glowA} 0%, transparent 72%)`,
      `radial-gradient(circle at 84% 82%, ${theme.glowB} 0%, transparent 74%)`,
      `radial-gradient(circle at 78% 18%, ${theme.glowC} 0%, transparent 56%)`,
    ].join(', '),
    color: theme.ink,
    boxShadow: `inset 0 0 0 1px ${theme.border}`,
  };
}

export type RenderAvatarMeshPresetOptions = {
  readonly name: string;
  readonly paletteId: AvatarMeshPaletteId;
  readonly scheme?: 'light' | 'dark';
  readonly size?: number;
};

const AVATAR_PRESET_FONT_STACK =
  '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif';

export async function renderAvatarMeshPresetFile({
  name,
  paletteId,
  scheme = 'light',
  size = 512,
}: RenderAvatarMeshPresetOptions): Promise<File> {
  if (typeof document === 'undefined' || typeof File === 'undefined') {
    throw new Error('AVATAR_PRESET_RENDER_UNAVAILABLE');
  }
  const palette = resolveAvatarMeshPalette(name, paletteId);
  const theme = scheme === 'dark' ? palette.dark : palette.light;
  const monogram = getAvatarMonogram(name);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('AVATAR_PRESET_RENDER_UNAVAILABLE');
  }

  ctx.fillStyle = theme.base;
  ctx.fillRect(0, 0, size, size);

  const glows: ReadonlyArray<readonly [cx: number, cy: number, radius: number, color: string]> = [
    [size * 0.22, size * 0.18, size * 0.72, theme.glowA],
    [size * 0.84, size * 0.82, size * 0.74, theme.glowB],
    [size * 0.78, size * 0.18, size * 0.56, theme.glowC],
  ];
  for (const [cx, cy, radius, color] of glows) {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const fontSize = Math.round(size * (monogram.length > 1 ? 0.37 : 0.44));
  ctx.fillStyle = theme.ink;
  ctx.font = `600 ${fontSize}px ${AVATAR_PRESET_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(monogram, size * 0.5, size * 0.52);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) {
    throw new Error('AVATAR_PRESET_RENDER_UNAVAILABLE');
  }
  return new File([blob], `nimi-avatar-${palette.id}.png`, { type: 'image/png' });
}
