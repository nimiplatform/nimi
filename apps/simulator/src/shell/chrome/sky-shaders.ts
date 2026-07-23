/** GLSL sources for the living-sky field background (WebGL2 / GLSL ES 3.00). */

export const SKY_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * Layered composition over the night-scape terrain texture:
 *  - texture layer (terrain + night sky) retained at night, graded by time
 *  - procedural sky (dawn/day/dusk palettes by sun elevation) cross-fades in
 *  - sun disc + horizon glow, terrain pseudo-relief key light, drifting fog band
 *
 * Port note: the simulator CSP pins `img-src 'none'`, so the terrain texture
 * is generated procedurally on a 2D canvas at startup instead of loading the
 * prototype's sky-night.png photo. The shader is unchanged.
 */
export const SKY_FRAG = `#version 300 es
precision highp float;

uniform vec2 u_res;
uniform vec2 u_texRes;
uniform sampler2D u_tex;
uniform float u_time;      // seconds, for drift/twinkle
uniform float u_dayTime;   // [0,1) local time of day
uniform float u_intensity; // light strength, ~[0,2]
uniform float u_motion;    // animation amplitude, [0,1]
uniform float u_horizon;   // horizon line in cover-uv space (from bottom)

in vec2 v_uv;
out vec4 outColor;

const float PI = 3.14159265;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

vec3 hex3(float r, float g, float b) { return vec3(r, g, b) / 255.0; }

void main() {
  // cover-fit the texture onto the canvas
  float ca = u_res.x / u_res.y;
  float ia = u_texRes.x / u_texRes.y;
  vec2 scale = (ca > ia) ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
  vec2 tuv = (v_uv - 0.5) * scale + 0.5;
  vec3 photo = texture(u_tex, tuv).rgb;
  float lum = dot(photo, vec3(0.299, 0.587, 0.114));

  float t = u_dayTime;
  float H = u_horizon;

  // sun elevation: peaks at noon (t=0.5), trough at midnight
  float e = sin(2.0 * PI * (t - 0.25));
  // sun travels left->right across the day; moon mirrors it at night
  float dayFrac = clamp((t - 0.25) / 0.5, 0.0, 1.0);
  float nightFrac = clamp((t >= 0.75 ? t - 0.75 : t + 0.25) / 0.5, 0.0, 1.0);
  vec2 sunPos = vec2(mix(0.08, 0.92, dayFrac), H + 0.40 * max(e, 0.0));
  vec2 moonPos = vec2(mix(0.10, 0.90, nightFrac), H + 0.34 * max(-e, 0.0));

  // phase weights
  float dayW = smoothstep(0.10, 0.38, e);
  float nightW = smoothstep(0.02, 0.20, -e);
  float twiW = clamp(1.0 - dayW - nightW, 0.0, 1.0);
  float duskness = smoothstep(0.44, 0.56, t); // 0 = dawn tint, 1 = dusk tint

  // sky palettes (zenith / horizon)
  vec3 dayTop = hex3(44.0, 68.0, 194.0);
  vec3 dayBot = hex3(79.0, 210.0, 232.0);
  vec3 dawnTop = hex3(39.0, 56.0, 154.0);
  vec3 dawnBot = hex3(242.0, 201.0, 214.0);
  vec3 duskTop = hex3(58.0, 42.0, 140.0);
  vec3 duskBot = hex3(240.0, 160.0, 112.0);
  vec3 nightTop = hex3(21.0, 12.0, 48.0);
  vec3 nightBot = hex3(38.0, 27.0, 61.0);

  vec3 twiTop = mix(dawnTop, duskTop, duskness);
  vec3 twiBot = mix(dawnBot, duskBot, duskness);

  float skyV = smoothstep(H, 1.0, v_uv.y);
  vec3 skyDay = mix(dayBot, dayTop, skyV);
  vec3 skyTwi = mix(twiBot, twiTop, skyV);
  vec3 skyNight = mix(nightBot, nightTop, skyV);
  vec3 skyProc = skyDay * dayW + skyTwi * twiW + skyNight * nightW;

  // sun / moon glow (aspect-corrected distance)
  vec2 aspect = vec2(ca, 1.0);
  float sunD = length((v_uv - sunPos) * aspect);
  float moonD = length((v_uv - moonPos) * aspect);
  float sunVis = smoothstep(-0.14, 0.04, e);
  vec3 sunTint = mix(mix(dawnBot, duskBot, duskness), vec3(1.0, 0.98, 0.92), dayW);
  float sunGlow = exp(-sunD * sunD * 42.0) * 0.85 + exp(-sunD * 5.5) * 0.30;
  sunGlow *= sunVis * u_intensity;
  float moonGlow = exp(-moonD * moonD * 90.0) * 0.30 + exp(-moonD * 7.0) * 0.10;
  moonGlow *= nightW * u_intensity;
  skyProc += sunTint * sunGlow + vec3(0.82, 0.86, 1.0) * moonGlow;

  // twilight horizon glow bleeding onto the ridge line
  float horizonGlow = exp(-abs(v_uv.y - H) * 7.0) * twiW * 0.55 * u_intensity;
  skyProc += mix(dawnBot, duskBot, duskness) * horizonGlow;

  // how much the procedural sky replaces the texture sky;
  // dark ridge pixels just above the horizon keep the texture (mountain silhouettes)
  float skyMask = smoothstep(H - 0.012, H + 0.030, v_uv.y);
  float skyMix = clamp(dayW + twiW * 0.60, 0.0, 1.0);
  float nearH = 1.0 - smoothstep(0.04, 0.22, v_uv.y - H);
  float keepRidge = (1.0 - smoothstep(0.07, 0.30, lum)) * nearH;
  float skyBlend = skyMask * skyMix * (1.0 - 0.88 * keepRidge);
  vec3 skyCol = mix(photo, skyProc, skyBlend);

  // terrain grading: brightness + color temperature
  float lit = smoothstep(-0.08, 0.32, e);
  float bright = mix(0.55, 1.14, lit);
  vec3 tintNight = vec3(0.74, 0.80, 1.04);
  vec3 tintTwi = mix(vec3(1.10, 0.86, 0.90), vec3(1.16, 0.86, 0.70), duskness);
  vec3 tintDay = vec3(1.02, 1.00, 0.98);
  vec3 tint = tintDay * dayW + tintTwi * twiW + tintNight * nightW;
  vec3 terrain = photo * bright * tint;

  // pseudo-relief key light: luminance bumps catch light from the sun side
  float bump = dFdx(lum);
  float lightSide = (sunPos.x - 0.5) * 2.0;
  float keyLight = -bump * lightSide * mix(0.35, 1.0, lit) * 3.2 * u_intensity;
  float keyVis = mix(0.35, 1.0, max(dayW, twiW * 0.8));
  terrain += keyLight * keyVis * sunTint * 0.55;

  // fog band over the terrain near the horizon; thicker at dawn, slow drift
  float drift = vnoise(v_uv * vec2(3.0, 7.0) + vec2(u_time * 0.012 * u_motion, 0.0));
  float fogDensity = 0.16 + twiW * (0.30 - duskness * 0.10) + nightW * 0.08;
  float fogBand = exp(-max(H - v_uv.y, 0.0) * 6.0) * (1.0 - skyMask);
  float fog = clamp(fogBand * (0.65 + 0.55 * drift) * fogDensity * 2.2, 0.0, 0.80);
  vec3 fogCol = mix(twiBot, vec3(0.62, 0.66, 0.82), nightW * 0.7) * (0.55 + 0.45 * lit);
  terrain = mix(terrain, fogCol, fog);

  vec3 col = mix(terrain, skyCol, skyMask);

  // gentle vignette
  vec2 vc = (v_uv - 0.5) * aspect;
  col *= 1.0 - 0.22 * dot(vc, vc);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
