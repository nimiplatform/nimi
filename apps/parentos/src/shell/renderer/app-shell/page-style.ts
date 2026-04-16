/** Shell background — aurora mesh gradient with subtle blue/pink/purple ambient glow */
export const BG = [
  'radial-gradient(ellipse at 0% 0%, rgba(191,219,254,0.45) 0%, transparent 50%)',
  'radial-gradient(ellipse at 100% 0%, rgba(221,214,254,0.3) 0%, transparent 50%)',
  'radial-gradient(ellipse at 100% 100%, rgba(252,231,243,0.35) 0%, transparent 50%)',
  'radial-gradient(ellipse at 0% 100%, rgba(167,243,208,0.2) 0%, transparent 50%)',
  'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
].join(', ');

/** Glass card style — shared across all bento cards */
export const GLASS = {
  background: 'rgba(255,255,255,0.45)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border: '1px solid rgba(226,232,240,0.3)',
  boxShadow: '0 8px 32px rgba(31,38,135,0.04)',
  borderRadius: 24,
} as const;

/** Stronger glass for hero / profile cards */
export const GLASS_SOLID = {
  ...GLASS,
  background: 'rgba(255,255,255,0.7)',
} as const;

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
  select: 'rounded-[10px] px-3 py-1.5 text-[12px] cursor-pointer appearance-none bg-white/60 hover:bg-white/80 transition-colors',
} as const;

export const selectStyle = {
  borderWidth: 1, borderStyle: 'solid' as const, borderColor: 'rgba(255,255,255,0.7)', color: '#1e293b',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28,
};
