export type SemanticAgentThemeInput = {
  category?: string | null;
  origin?: string | null;
  worldName?: string | null;
  description?: string | null;
  tags?: string[];
};

export type SemanticAgentPalette = {
  background: string;
  ring: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
};

const DEFAULT_AGENT_PALETTE: SemanticAgentPalette = {
  background: 'linear-gradient(135deg, rgba(236,254,255,0.92) 0%, rgba(219,234,254,0.78) 100%)',
  ring: 'linear-gradient(135deg, #67e1f5 0%, #155dfc 100%)',
  accent: '#007595',
  badgeBg: 'rgba(255,255,255,0.78)',
  badgeText: '#0f172a',
};

const AGENT_THEME_PALETTES: Array<{ keywords: string[]; palette: SemanticAgentPalette }> = [
  {
    keywords: ['xianxia', 'cultivation', 'immortal', 'dao', 'fantasy', '修仙', '仙侠', '宗门'],
    palette: {
      background: 'linear-gradient(135deg, rgba(236,253,245,0.95) 0%, rgba(220,252,231,0.84) 45%, rgba(224,231,255,0.82) 100%)',
      ring: 'linear-gradient(135deg, #34d399 0%, #60a5fa 100%)',
      accent: '#15803d',
      badgeBg: 'rgba(240,253,244,0.86)',
      badgeText: '#166534',
    },
  },
  {
    keywords: ['tech', 'technology', 'cyber', 'ai', 'code', 'coding', 'research', '科技', '赛博'],
    palette: {
      background: 'linear-gradient(135deg, rgba(239,246,255,0.95) 0%, rgba(224,242,254,0.86) 50%, rgba(236,254,255,0.82) 100%)',
      ring: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
      accent: '#1d4ed8',
      badgeBg: 'rgba(239,246,255,0.84)',
      badgeText: '#1d4ed8',
    },
  },
  {
    keywords: ['art', 'artist', 'creative', 'music', 'story', 'design', '艺术', '创作', '音乐', '绘画'],
    palette: {
      background: 'linear-gradient(135deg, rgba(253,242,248,0.95) 0%, rgba(245,243,255,0.86) 50%, rgba(255,247,237,0.82) 100%)',
      ring: 'linear-gradient(135deg, #f472b6 0%, #a855f7 100%)',
      accent: '#a21caf',
      badgeBg: 'rgba(250,245,255,0.84)',
      badgeText: '#a21caf',
    },
  },
  {
    keywords: ['health', 'medical', 'doctor', 'wellness', '医疗', '健康'],
    palette: {
      background: 'linear-gradient(135deg, rgba(236,253,245,0.95) 0%, rgba(240,249,255,0.84) 100%)',
      ring: 'linear-gradient(135deg, #2dd4bf 0%, #22c55e 100%)',
      accent: '#0f766e',
      badgeBg: 'rgba(240,253,250,0.84)',
      badgeText: '#0f766e',
    },
  },
];

function normalizeAgentThemeText(input: SemanticAgentThemeInput): string {
  return [
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

export function getSemanticAgentPalette(input: SemanticAgentThemeInput): SemanticAgentPalette {
  const haystack = normalizeAgentThemeText(input);
  for (const entry of AGENT_THEME_PALETTES) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.palette;
    }
  }
  return DEFAULT_AGENT_PALETTE;
}
