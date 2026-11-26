export type SemanticSourceThemeInput = {
  archetype?: string | null;
  category?: string | null;
  origin?: string | null;
  worldName?: string | null;
  description?: string | null;
  tags?: string[];
};

export type SemanticSourcePalette = {
  background: string;
  ring: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
};

const DEFAULT_SOURCE_PALETTE: SemanticSourcePalette = {
  background: 'linear-gradient(135deg, light-dark(rgba(236,254,255,0.92), color-mix(in srgb, #0891b2 18%, var(--nimi-surface-card))) 0%, light-dark(rgba(219,234,254,0.78), color-mix(in srgb, #1d4ed8 14%, var(--nimi-surface-card))) 100%)',
  ring: 'linear-gradient(135deg, #67e1f5 0%, #155dfc 100%)',
  accent: 'light-dark(#007595, #67e8f9)',
  badgeBg: 'light-dark(rgba(255,255,255,0.78), color-mix(in srgb, #0891b2 22%, var(--nimi-surface-card)))',
  badgeText: 'light-dark(#0f172a, #e0f2fe)',
};

const SOURCE_THEME_PALETTES: Array<{ keywords: string[]; palette: SemanticSourcePalette }> = [
  {
    keywords: ['xianxia', 'cultivation', 'immortal', 'dao', 'fantasy', '修仙', '仙侠', '宗门'],
    palette: {
      background: 'linear-gradient(135deg, light-dark(rgba(236,253,245,0.95), color-mix(in srgb, #10b981 18%, var(--nimi-surface-card))) 0%, light-dark(rgba(220,252,231,0.84), color-mix(in srgb, #22c55e 14%, var(--nimi-surface-card))) 45%, light-dark(rgba(224,231,255,0.82), color-mix(in srgb, #6366f1 14%, var(--nimi-surface-card))) 100%)',
      ring: 'linear-gradient(135deg, #34d399 0%, #60a5fa 100%)',
      accent: 'light-dark(#15803d, #6ee7b7)',
      badgeBg: 'light-dark(rgba(240,253,244,0.86), color-mix(in srgb, #10b981 22%, var(--nimi-surface-card)))',
      badgeText: 'light-dark(#166534, #d1fae5)',
    },
  },
  {
    keywords: ['tech', 'technology', 'cyber', 'ai', 'code', 'coding', 'research', '科技', '赛博'],
    palette: {
      background: 'linear-gradient(135deg, light-dark(rgba(239,246,255,0.95), color-mix(in srgb, #2563eb 18%, var(--nimi-surface-card))) 0%, light-dark(rgba(224,242,254,0.86), color-mix(in srgb, #0284c7 15%, var(--nimi-surface-card))) 50%, light-dark(rgba(236,254,255,0.82), color-mix(in srgb, #06b6d4 14%, var(--nimi-surface-card))) 100%)',
      ring: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
      accent: 'light-dark(#1d4ed8, #93c5fd)',
      badgeBg: 'light-dark(rgba(239,246,255,0.84), color-mix(in srgb, #2563eb 24%, var(--nimi-surface-card)))',
      badgeText: 'light-dark(#1d4ed8, #dbeafe)',
    },
  },
  {
    keywords: ['art', 'artist', 'creative', 'music', 'story', 'design', '艺术', '创作', '音乐', '绘画'],
    palette: {
      background: 'linear-gradient(135deg, light-dark(rgba(253,242,248,0.95), color-mix(in srgb, #db2777 18%, var(--nimi-surface-card))) 0%, light-dark(rgba(245,243,255,0.86), color-mix(in srgb, #9333ea 16%, var(--nimi-surface-card))) 50%, light-dark(rgba(255,247,237,0.82), color-mix(in srgb, #ea580c 12%, var(--nimi-surface-card))) 100%)',
      ring: 'linear-gradient(135deg, #f472b6 0%, #a855f7 100%)',
      accent: 'light-dark(#a21caf, #f0abfc)',
      badgeBg: 'light-dark(rgba(250,245,255,0.84), color-mix(in srgb, #a855f7 24%, var(--nimi-surface-card)))',
      badgeText: 'light-dark(#a21caf, #f5d0fe)',
    },
  },
  {
    keywords: ['health', 'medical', 'doctor', 'wellness', '医疗', '健康'],
    palette: {
      background: 'linear-gradient(135deg, light-dark(rgba(236,253,245,0.95), color-mix(in srgb, #14b8a6 18%, var(--nimi-surface-card))) 0%, light-dark(rgba(240,249,255,0.84), color-mix(in srgb, #0284c7 14%, var(--nimi-surface-card))) 100%)',
      ring: 'linear-gradient(135deg, #2dd4bf 0%, #22c55e 100%)',
      accent: 'light-dark(#0f766e, #5eead4)',
      badgeBg: 'light-dark(rgba(240,253,250,0.84), color-mix(in srgb, #14b8a6 22%, var(--nimi-surface-card)))',
      badgeText: 'light-dark(#0f766e, #ccfbf1)',
    },
  },
];

function normalizeSourceThemeText(input: SemanticSourceThemeInput): string {
  return [
    input.archetype,
    input.category,
    input.origin,
    input.worldName,
    input.description,
    ...(input.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getSemanticSourcePalette(input: SemanticSourceThemeInput): SemanticSourcePalette {
  const haystack = normalizeSourceThemeText(input);
  for (const entry of SOURCE_THEME_PALETTES) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.palette;
    }
  }
  return DEFAULT_SOURCE_PALETTE;
}
