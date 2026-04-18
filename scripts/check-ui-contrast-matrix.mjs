#!/usr/bin/env node
// check:ui-contrast-matrix
//
// Phase 3a CI gate (topic 2026-04-18-nimi-ui-glassmorphism-system-uplift).
//
// Computes WCAG 2.1 AA contrast ratios for every admitted material tier ×
// surface tone × theme combination declared in
// .nimi/spec/platform/kernel/tables/nimi-ui-{tokens,themes}.yaml.
//
// For glass materials (semitransparent fills), the "effective background"
// is the material bg alpha-composited over the surface tone. Contrast is
// computed against text.primary (body text target ≥ 4.5:1) and text.muted
// (UI chrome / large-text target ≥ 3:1).
//
// Forward-compat: the tier list is derived from the yaml at runtime. No
// hardcoded tier names. Works with the 3-tier or 5-tier taxonomy (Phase 1
// closed 3-tier baseline or Phase 2 closed 5-tier).
//
// Spec: P-DESIGN-022 (material layering) + .nimi/spec/platform/kernel/
// nimi-ui-material-contract.md §3 (4.5:1 threshold).
//
// Exit 0 on green. Exit 1 on any (tier, tone, theme) combination failing
// its target ratio, unless the combination is listed in
// nimi-ui-material-contract.md §4 Admitted Exceptions (currently empty).

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const TARGET_BODY = 4.5;
const TARGET_LARGE = 3.0;

function readYaml(rel) {
  return YAML.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

// ---------- Color parsing ----------

function parseColor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  let m;
  m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  // gradients or unsupported → null (skip)
  return null;
}

function composite(fg, bg) {
  // fg over bg alpha composition, assuming bg is opaque
  const a = fg.a;
  return {
    r: Math.round(a * fg.r + (1 - a) * bg.r),
    g: Math.round(a * fg.g + (1 - a) * bg.g),
    b: Math.round(a * fg.b + (1 - a) * bg.b),
    a: 1,
  };
}

function relLuminance({ r, g, b }) {
  const toLin = (c) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function contrast(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [bright, dark] = la > lb ? [la, lb] : [lb, la];
  return (bright + 0.05) / (dark + 0.05);
}

// ---------- Spec loading ----------

const tokensDoc = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml');
const themesDoc = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml');

const tokens = Array.isArray(tokensDoc?.tokens) ? tokensDoc.tokens : [];
const packs = Array.isArray(themesDoc?.packs) ? themesDoc.packs : [];

// Derive admitted glass tiers from token ids of shape `material.glass_<tier>.bg`
const tierPattern = /^material\.glass_([a-z]+)\.bg$/;
const tiers = tokens
  .map((t) => String(t?.id || '').match(tierPattern))
  .filter(Boolean)
  .map((m) => m[1]);

const TONES = ['canvas', 'panel', 'card', 'overlay']; // hero is gradient → skip
const THEMES = ['nimi-light', 'nimi-dark'];

function packValues(themeId) {
  const pack = packs.find((p) => String(p?.theme_id) === themeId);
  return pack?.values || {};
}

function resolveToneBg(themeId, tone) {
  const v = packValues(themeId);
  const raw = v[`surface.${tone}`] ?? v['surface.canvas'];
  return parseColor(raw);
}

function resolveText(themeId, role) {
  const v = packValues(themeId);
  return parseColor(v[`text.${role}`]);
}

function resolveGlassBg(themeId, tier) {
  const v = packValues(themeId);
  return parseColor(v[`material.glass_${tier}.bg`]);
}

// ---------- Compute matrix ----------

const failures = [];
const rows = [];

for (const themeId of THEMES) {
  for (const tone of TONES) {
    const toneBg = resolveToneBg(themeId, tone);
    const textPrimary = resolveText(themeId, 'primary');
    const textMuted = resolveText(themeId, 'muted');
    if (!toneBg || !textPrimary || !textMuted) continue;

    // solid tier baseline
    {
      const effective = toneBg;
      const rPrimary = contrast(textPrimary, effective);
      const rMuted = contrast(textMuted, effective);
      rows.push({ themeId, tone, tier: 'solid', rPrimary, rMuted });
      if (rPrimary < TARGET_BODY) {
        failures.push({ themeId, tone, tier: 'solid', kind: 'body', ratio: rPrimary, target: TARGET_BODY });
      }
      if (rMuted < TARGET_LARGE) {
        failures.push({ themeId, tone, tier: 'solid', kind: 'large', ratio: rMuted, target: TARGET_LARGE });
      }
    }

    // glass tiers — effective bg = material bg composited over tone bg
    for (const tier of tiers) {
      const glassBg = resolveGlassBg(themeId, tier);
      if (!glassBg) continue;
      const effective = composite(glassBg, toneBg);
      const rPrimary = contrast(textPrimary, effective);
      const rMuted = contrast(textMuted, effective);
      rows.push({ themeId, tone, tier: `glass-${tier}`, rPrimary, rMuted });
      if (rPrimary < TARGET_BODY) {
        failures.push({ themeId, tone, tier: `glass-${tier}`, kind: 'body', ratio: rPrimary, target: TARGET_BODY });
      }
      if (rMuted < TARGET_LARGE) {
        failures.push({ themeId, tone, tier: `glass-${tier}`, kind: 'large', ratio: rMuted, target: TARGET_LARGE });
      }
    }
  }
}

// ---------- Output ----------

function fmt(n) {
  return n.toFixed(2);
}

console.log(`check:ui-contrast-matrix — ${tiers.length} glass tiers + solid × ${TONES.length} tones × ${THEMES.length} themes`);
console.log(`Targets: body text (text.primary) ≥ ${TARGET_BODY}:1; large/UI (text.muted) ≥ ${TARGET_LARGE}:1`);
console.log('');
console.log('theme'.padEnd(12) + 'tone'.padEnd(10) + 'tier'.padEnd(16) + 'primary'.padEnd(12) + 'muted');
for (const row of rows) {
  const primaryMark = row.rPrimary >= TARGET_BODY ? ' ' : '!';
  const mutedMark = row.rMuted >= TARGET_LARGE ? ' ' : '!';
  console.log(
    row.themeId.padEnd(12) +
      row.tone.padEnd(10) +
      row.tier.padEnd(16) +
      `${fmt(row.rPrimary)}:1${primaryMark}`.padEnd(12) +
      `${fmt(row.rMuted)}:1${mutedMark}`,
  );
}
console.log('');

if (failures.length === 0) {
  console.log(`ui-contrast-matrix: OK (${rows.length} combinations all ≥ target)`);
  process.exit(0);
}

console.error('');
console.error(`FAIL: ${failures.length} combination(s) below target:`);
for (const f of failures) {
  console.error(
    `  ${f.themeId} × tone=${f.tone} × tier=${f.tier} × ${f.kind}: ${fmt(f.ratio)}:1 (target ≥ ${f.target}:1)`,
  );
}
console.error('');
console.error('Per nimi-ui-material-contract.md §stop_line: if < 2 combinations fail, each must be filed as an admitted exception in §4. If ≥ 2 fail, escalate to Phase 2 for tier-value revision.');
process.exit(1);
