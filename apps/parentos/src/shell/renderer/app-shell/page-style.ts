/** Shared dashboard design tokens — import in every page for consistent styling */
export const S = {
  bg: '#E5ECEA',
  card: '#ffffff',
  text: '#1a2b4a',
  sub: '#8a8f9a',
  accent: '#94A533',
  accentBar: '#c8e64a',
  border: '#e8e5e0',
  blue: '#86AFDA',
  shadow: '0 2px 12px rgba(0,0,0,0.06)',
  radius: 'rounded-[18px]',
  radiusSm: 'rounded-[14px]',
  /** Standard page container classes */
  container: 'max-w-3xl mx-auto px-6 pb-6',
  /** Standard page top padding to align with nav icons */
  topPad: 86,
  /** Unified native select styling */
  select: 'rounded-[10px] px-3 py-1.5 text-[12px] cursor-pointer appearance-none bg-[#f9faf7] hover:bg-[#f0f2ee] transition-colors',
} as const;

/** Inline style for native select — use with S.select className */
export const selectStyle = {
  borderWidth: 1, borderStyle: 'solid' as const, borderColor: '#e8e5e0', color: '#1a2b4a',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8f9a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28,
};
