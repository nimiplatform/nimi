// W3 (2026-04-17): `BG`, `GLASS`, and `GLASS_SOLID` removed per
// preflight-w3.md. Aurora mesh and glass material are now consumed
// through kit primitives:
//   - `<AmbientBackground variant="mesh">` (P-DESIGN-023)
//   - `<Surface material="glass-regular" | "glass-thick">` (P-DESIGN-022)
// ParentOS no longer defines a local parallel material language.

export const S = {
  bg: '#F1F5F9',
  card: '#ffffff',
  text: '#1e293b',
  sub: '#475569',
  accent: '#4ECCA3',
  accentBar: '#4ECCA3',
  border: 'rgba(255,255,255,0.7)',
  blue: '#818CF8',
  shadow: '0 8px 32px rgba(31,38,135,0.04)',
  radius: 'rounded-[24px]',
  radiusSm: 'rounded-[16px]',
  container: 'max-w-3xl mx-auto px-6 pb-6',
  topPad: 72,
  select: 'rounded-[10px] px-3 py-1.5 text-[14px] cursor-pointer appearance-none bg-white/60 hover:bg-white/80 transition-colors',
} as const;

export const selectStyle = {
  borderWidth: 1, borderStyle: 'solid' as const, borderColor: 'rgba(255,255,255,0.7)', color: '#1e293b',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28,
};
