// Content policies for the installed Home and Avatar pages, sent with their
// HTML from the nimi-app protocol. They apply on top of any meta policy a page
// carries (a load must satisfy both), so a development page keeps its dev
// server connections while an installed page cannot reach loopback ports.
const COMMON = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

export const DESKTOP_APP_CONTENT_SECURITY_POLICY = [
  ...COMMON,
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "img-src 'self' https: data: blob: file: nimi-shell-file:",
  "media-src 'self' https: data: blob: file: nimi-shell-file:",
  "font-src 'self' data: nimi-shell-file:",
  "connect-src 'self' https: data: nimi-shell-file:",
].join('; ');

// Avatar renders local model packages: scripts and shaders come from its own
// origin, model files and textures from nimi-shell-file, and decoded assets
// travel as blob or data URLs. It has no remote origin.
export const AVATAR_APP_CONTENT_SECURITY_POLICY = [
  ...COMMON,
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob: nimi-shell-file:",
  "media-src 'self' data: blob: nimi-shell-file:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: nimi-shell-file:",
].join('; ');
