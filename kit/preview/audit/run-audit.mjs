#!/usr/bin/env node
/**
 * Nimi Kit visual & interaction audit runner.
 *
 * The automated audit → modify → accept loop for governed UI surfaces:
 *
 *   1. Builds `kit/preview` (vite) and serves it headlessly.
 *   2. Captures a screenshot matrix (scheme × density × section) plus
 *      interaction-state shots (hover / pressed / focus / overlay open).
 *   3. Runs machine-readable assertions against the RENDERED result —
 *      pressed feedback, spring overlay travel, density axis, typography
 *      execution, glass vibrancy, dead-class elimination, rendered
 *      contrast, and hardcoded-visual-value drift.
 *   4. Writes screenshots + report.json + report.md to
 *      `.nimi/local/design-audit/kit-preview-<date>/` and exits non-zero
 *      on any failed assertion.
 *
 * Token self-check gates (check:ui-contrast-matrix etc.) prove tokens are
 * coherent; this gate proves the composed UI is coherent.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(scriptDir, '..', '..');
const repoRoot = path.resolve(kitRoot, '..');
const previewDist = path.join(scriptDir, '..', 'dist');
const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(repoRoot, '.nimi', 'local', 'design-audit', `kit-preview-${stamp}`);
const shotsDir = path.join(outDir, 'screenshots');
const PORT = 1471;

const SECTIONS = ['foundations', 'typography', 'actions', 'inputs', 'overlays', 'feedback'];
const SCHEMES = ['light', 'dark'];
const DENSITIES = ['regular', 'compact'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    const relativePath = path.relative(root, filePath);
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      res.writeHead(403); res.end(); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(root, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function buildPreview() {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vite', 'build', '--config', 'preview/vite.config.ts'],
    { cwd: kitRoot, stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) throw new Error('preview build failed');
}

// --- static source assertions ------------------------------------------------

function readSpecMotionValues() {
  const themes = YAML.parse(fs.readFileSync(path.join(repoRoot, '.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml'), 'utf8'));
  const light = themes.packs.find((p) => p.theme_id === 'nimi-light');
  const v = light.values;
  return {
    fast: parseInt(v['motion.fast'], 10),
    base: parseInt(v['motion.base'], 10),
    slow: parseInt(v['motion.slow'], 10),
    ambient: parseInt(v['motion.ambient'], 10),
    springDefaultResponse: parseFloat(v['motion.spring_default_response']),
    springDefaultDamping: parseFloat(v['motion.spring_default_damping']),
    springMomentumResponse: parseFloat(v['motion.spring_momentum_response']),
    springMomentumDamping: parseFloat(v['motion.spring_momentum_damping']),
    pressedScale: parseFloat(v['motion.pressed_scale']),
  };
}

function checkMotionMirrorSync(failures, passes) {
  const spec = readSpecMotionValues();
  const timing = fs.readFileSync(path.join(kitRoot, 'ui/src/motion/timing.ts'), 'utf8');
  const springs = fs.readFileSync(path.join(kitRoot, 'ui/src/motion/springs.ts'), 'utf8');
  const m = timing.match(/fast:\s*(\d+)[\s\S]*?base:\s*(\d+)[\s\S]*?slow:\s*(\d+)[\s\S]*?ambient:\s*(\d+)/);
  const okDurations = m
    && Number(m[1]) === spec.fast && Number(m[2]) === spec.base
    && Number(m[3]) === spec.slow && Number(m[4]) === spec.ambient;
  const okSprings = springs.includes(`responseSeconds: ${spec.springDefaultResponse}`)
    && springs.includes(`responseSeconds: ${spec.springMomentumResponse}`)
    && springs.includes(`dampingRatio: ${spec.springDefaultDamping}`)
    && springs.includes(`dampingRatio: ${spec.springMomentumDamping}`)
    && springs.includes(`NIMI_PRESSED_SCALE = ${spec.pressedScale}`);
  if (okDurations && okSprings) {
    passes.push('motion-mirror-sync: TS motion mirrors match spec motion.* values');
  } else {
    failures.push(`motion-mirror-sync: TS mirror drifted from spec (durations ok=${okDurations}, springs ok=${okSprings})`);
  }
}

const HARDCODED_SCAN_ALLOWLIST = [
  /generated\//,
  /styles\.css$/,
  /test\//,
];
const HARDCODED_BASELINE_PATH = path.join(scriptDir, 'baseline.json');

function scanHardcodedVisuals() {
  const hits = [];
  const roots = [path.join(kitRoot, 'ui/src')];
  const fileRe = /\.(tsx?|css)$/;
  const valueRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = path.relative(kitRoot, full).split(path.sep).join('/');
      if (!fileRe.test(entry.name)) continue;
      if (HARDCODED_SCAN_ALLOWLIST.some((re) => re.test(rel))) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        const matches = line.match(valueRe);
        if (matches) hits.push({ file: rel, line: i + 1, values: matches });
      });
    }
  };
  roots.forEach(walk);
  return hits;
}

function checkHardcodedVisuals(failures, passes, warnings) {
  const hits = scanHardcodedVisuals();
  let baseline = { count: 0 };
  if (fs.existsSync(HARDCODED_BASELINE_PATH)) {
    baseline = JSON.parse(fs.readFileSync(HARDCODED_BASELINE_PATH, 'utf8'));
  } else {
    fs.writeFileSync(HARDCODED_BASELINE_PATH, JSON.stringify({ count: hits.length, note: 'initial baseline; only decreases are admitted' }, null, 2));
    baseline = { count: hits.length };
  }
  if (hits.length === 0) {
    if (baseline.count !== 0) {
      fs.writeFileSync(HARDCODED_BASELINE_PATH, JSON.stringify({ count: 0, note: 'ratcheted baseline; only decreases are admitted' }, null, 2));
    }
    passes.push('hardcoded-visuals: no raw hex/rgba visual values in kit/ui/src (outside allowlist)');
  } else if (hits.length < baseline.count) {
    fs.writeFileSync(HARDCODED_BASELINE_PATH, JSON.stringify({ count: hits.length, note: 'ratcheted baseline; only decreases are admitted' }, null, 2));
    warnings.push(`hardcoded-visuals: ${hits.length} raw value site(s), baseline ratcheted ${baseline.count} -> ${hits.length} — drive to zero`);
  } else if (hits.length <= baseline.count) {
    warnings.push(`hardcoded-visuals: ${hits.length} raw value site(s) within baseline ${baseline.count} — drive to zero`);
  } else {
    failures.push(`hardcoded-visuals: ${hits.length} raw value site(s) exceeds baseline ${baseline.count}: ${hits.slice(0, 5).map((h) => `${h.file}:${h.line}`).join(', ')}`);
  }
  return hits;
}

// --- rendered assertions -----------------------------------------------------

function contrastRatio(fg, bg) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => parseFloat(x));
    return parts.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
  };
  const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const a = parse(fg); const b = parse(bg);
  if (!a || !b) return null;
  const l1 = Math.max(lum(a), lum(b));
  const l2 = Math.min(lum(a), lum(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

async function run() {
  fs.mkdirSync(shotsDir, { recursive: true });
  const failures = [];
  const passes = [];
  const warnings = [];
  const metrics = {};

  checkMotionMirrorSync(failures, passes);
  const hardcodedHits = checkHardcodedVisuals(failures, passes, warnings);

  buildPreview();
  const server = await serveStatic(previewDist, PORT);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = (q) => `http://127.0.0.1:${PORT}/?${q}`;

    // 1) Screenshot matrix -----------------------------------------------------
    for (const scheme of SCHEMES) {
      for (const density of DENSITIES) {
        for (const section of SECTIONS) {
          await page.goto(url(`scheme=${scheme}&density=${density}&section=${section}`), { waitUntil: 'networkidle' });
          await page.screenshot({ path: path.join(shotsDir, `${section}-${scheme}-${density}.png`), fullPage: true });
        }
      }
    }
    passes.push(`screenshot-matrix: ${SECTIONS.length * SCHEMES.length * DENSITIES.length} frames captured`);

    // 2) Dead animation classes ------------------------------------------------
    await page.goto(url('scheme=light&density=regular'), { waitUntil: 'networkidle' });
    const deadClasses = await page.evaluate(() => {
      const re = /^(animate-in|animate-out|fade-in-\d+|fade-out-\d+|zoom-in-\d+|zoom-out-\d+|slide-in-from-\S+|slide-out-to-\S+)$/;
      const found = new Set();
      document.querySelectorAll('*').forEach((el) => {
        (el.getAttribute('class') || '').split(/\s+/).forEach((c) => { if (re.test(c)) found.add(c); });
      });
      return [...found];
    });
    if (deadClasses.length === 0) passes.push('no-dead-animation-classes: no phantom animate-in/fade/zoom/slide classes in DOM');
    else failures.push(`no-dead-animation-classes: phantom classes still rendered: ${deadClasses.join(', ')}`);

    // 3) Pressed feedback + shape semantics ------------------------------------
    await page.goto(url('scheme=light&density=regular&section=actions'), { waitUntil: 'networkidle' });
    const btn = page.getByTestId('btn-primary');
    await btn.waitFor();
    const radius = await btn.evaluate((el) => getComputedStyle(el).borderRadius);
    if (radius === '12px') passes.push('shape-semantics: standard button radius is 12px (not capsule)');
    else failures.push(`shape-semantics: standard button radius expected 12px, got ${radius}`);

    const box = await btn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(30);
    // Tailwind v4 scale utilities emit the standalone `scale` property;
    // older transforms use `transform` matrix. Read both.
    const pressed = await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { transform: cs.transform, scale: cs.scale };
    });
    await page.screenshot({ path: path.join(shotsDir, 'state-pressed-primary.png') });
    await page.mouse.up();
    const scaleFromProp = pressed.scale && pressed.scale !== 'none' ? parseFloat(pressed.scale) : NaN;
    const matrixMatch = pressed.transform.match(/matrix\(([^,]+)/);
    const pressedScale = Number.isFinite(scaleFromProp)
      ? scaleFromProp
      : matrixMatch
        ? parseFloat(matrixMatch[1])
        : 1;
    if (pressedScale > 0.94 && pressedScale < 1) {
      passes.push(`pressed-feedback: pointer-down scale ${pressedScale} within one frame`);
    } else {
      failures.push(`pressed-feedback: expected scale ~0.97 on pointer-down, got scale=${pressed.scale} transform=${pressed.transform}`);
    }

    // focus ring state shot
    await btn.focus();
    await page.screenshot({ path: path.join(shotsDir, 'state-focus-primary.png') });

    // 4) Density axis -----------------------------------------------------------
    const heightAt = async (density) => {
      await page.goto(url(`scheme=light&density=${density}&section=actions`), { waitUntil: 'networkidle' });
      const b = page.getByTestId('btn-primary');
      await b.waitFor();
      return b.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    };
    const hRegular = await heightAt('regular');
    const hCompact = await heightAt('compact');
    metrics.density = { regular: hRegular, compact: hCompact };
    if (hRegular === 40 && hCompact === 34) {
      passes.push(`density-axis: md action height regular=${hRegular}px compact=${hCompact}px`);
    } else {
      failures.push(`density-axis: expected 40/34px for regular/compact, got ${hRegular}/${hCompact}`);
    }

    // Expressive escape hatch: inside a compact page, a nested expressive
    // boundary must restore the foundation sizing for its subtree.
    await page.goto(url('scheme=light&density=compact&section=actions'), { waitUntil: 'networkidle' });
    const hExpressive = await page.getByTestId('btn-expressive').evaluate((el) => Math.round(el.getBoundingClientRect().height));
    if (hExpressive === 40) {
      passes.push('density-expressive-escape: nested expressive boundary restores foundation sizing (40px)');
    } else {
      failures.push(`density-expressive-escape: expected 40px inside expressive boundary, got ${hExpressive}`);
    }

    // 5) Overlay spring travel (enter + symmetric exit) -------------------------
    await page.goto(url('scheme=light&density=regular&section=overlays'), { waitUntil: 'networkidle' });
    await page.getByTestId('open-drawer').click();
    const travelSamples = [];
    for (let i = 0; i < 14; i += 1) {
      const t = await page.evaluate(() => {
        const panel = document.querySelector('.nimi-overlay-panel--drawer');
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return { x: Math.round(rect.x), opacity: getComputedStyle(panel).opacity };
      });
      if (t) travelSamples.push(t);
      await page.waitForTimeout(40);
    }
    const settledX = travelSamples.length ? travelSamples[travelSamples.length - 1].x : null;
    const midFlight = travelSamples.some((s) => settledX !== null && s.x > settledX + 4);
    if (midFlight && settledX !== null) {
      passes.push('overlay-spring-enter: drawer traveled continuously and settled (spring, not jump)');
    } else {
      failures.push(`overlay-spring-enter: no continuous spring travel observed: ${JSON.stringify(travelSamples)}`);
    }
    await page.screenshot({ path: path.join(shotsDir, 'state-drawer-open.png') });

    await page.getByText('Done').click();
    const exitSamples = [];
    for (let i = 0; i < 12; i += 1) {
      const t = await page.evaluate(() => {
        const panel = document.querySelector('.nimi-overlay-panel--drawer');
        return panel ? Math.round(panel.getBoundingClientRect().x) : null;
      });
      if (t === null) break;
      exitSamples.push(t);
      await page.waitForTimeout(40);
    }
    const exitTraveled = exitSamples.length > 1 && exitSamples[exitSamples.length - 1] > exitSamples[0] + 4;
    if (exitTraveled) {
      passes.push('overlay-symmetric-exit: drawer exit reversed along the same axis');
    } else {
      failures.push(`overlay-symmetric-exit: expected multiple reverse-travel samples, got: ${exitSamples.join(',') || 'none'}`);
    }

    // 6) Typography execution ----------------------------------------------------
    await page.goto(url('scheme=light&density=regular&section=typography'), { waitUntil: 'networkidle' });
    const tracking = await page.getByTestId('type-page-title').evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing));
    if (Number.isFinite(tracking) && tracking < 0) passes.push(`typography-tracking: page-title tracking ${tracking}px applied`);
    else failures.push(`typography-tracking: page-title letter-spacing not applied (got ${tracking})`);

    const cjk = await page.getByTestId('type-body-zh').evaluate((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    });
    if (cjk >= 1.6) passes.push(`typography-cjk: zh body line-height ratio ${cjk.toFixed(2)} (CJK profile applied)`);
    else failures.push(`typography-cjk: expected zh body ratio >= 1.6, got ${cjk.toFixed(2)}`);

    const heroSize = await page.getByTestId('type-hero-title').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (heroSize === 36) passes.push('typography-hero: hero-title role resolves 36px token');
    else failures.push(`typography-hero: expected 36px hero title, got ${heroSize}`);

    // 7) Glass vibrancy ----------------------------------------------------------
    await page.goto(url('scheme=light&density=regular&section=foundations'), { waitUntil: 'networkidle' });
    const backdrop = await page.getByTestId('material-glass-regular').evaluate((el) => getComputedStyle(el).backdropFilter);
    if (/saturate\(/.test(backdrop)) passes.push(`glass-vibrancy: backdrop-filter includes saturation (${backdrop})`);
    else failures.push(`glass-vibrancy: expected saturate() in backdrop-filter, got "${backdrop}"`);

    // 8) Rendered contrast ---------------------------------------------------------
    const contrastSamples = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: getComputedStyle(document.body).backgroundColor };
      };
      return {
        body: pick('[data-testid="type-body"], main, body'),
      };
    });
    if (contrastSamples.body) {
      const ratio = contrastRatio(contrastSamples.body.color, contrastSamples.body.bg);
      metrics.contrastBody = ratio;
      if (ratio && ratio >= 4.5) passes.push(`contrast-rendered: body text ${ratio.toFixed(2)}:1 >= 4.5`);
      else failures.push(`contrast-rendered: body text ${ratio ? ratio.toFixed(2) : 'n/a'}:1 below 4.5`);
    }

    // 9) Popover stays anchored to its trigger through the spring enter.
    // Catches popper-transform conflicts between Radix positioning and the
    // motion layer (the wrapper pattern keeps them on separate elements).
    await page.goto(url('scheme=light&density=regular&section=overlays'), { waitUntil: 'networkidle' });
    await page.getByTestId('open-popover').click();
    await page.waitForTimeout(80); // mid-flight
    const triggerBox = await page.getByTestId('open-popover').boundingBox();
    const popoverPanel = page.locator('.nimi-overlay-panel--popover');
    const panelBox = await popoverPanel.boundingBox();
    const anchored = Boolean(panelBox && triggerBox
      && Math.abs(panelBox.x - triggerBox.x) < 200
      && panelBox.y > triggerBox.y - 40
      && panelBox.y < triggerBox.y + 400);
    if (anchored) {
      passes.push('popover-trigger-anchor: popover stays anchored to trigger during spring enter');
    } else {
      failures.push(`popover-trigger-anchor: panel drifted from trigger (trigger=${JSON.stringify(triggerBox)}, panel=${JSON.stringify(panelBox)})`);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shotsDir, 'state-popover-open.png') });
    await page.keyboard.press('Escape');

    // 10) Select motion render + symmetric exit retention.
    await page.goto(url('scheme=light&density=regular&section=inputs'), { waitUntil: 'networkidle' });
    await page.getByTestId('select-route').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shotsDir, 'state-select-open.png') });
    await page.keyboard.press('Escape');
    const selectExitSamples = [];
    for (let i = 0; i < 14; i += 1) {
      const opacity = await page.evaluate(() => {
        const panel = document.querySelector('.nimi-overlay-panel--popover');
        return panel ? Number.parseFloat(getComputedStyle(panel).opacity) : null;
      });
      if (opacity === null) break;
      selectExitSamples.push(opacity);
      await page.waitForTimeout(40);
    }
    const selectExitTraveled = selectExitSamples.length > 1
      && selectExitSamples.some((opacity) => opacity < selectExitSamples[0] - 0.05);
    if (selectExitTraveled) {
      passes.push('select-symmetric-exit: Select content remained mounted through visible reverse motion');
    } else {
      failures.push(`select-symmetric-exit: expected retained fading samples, got ${JSON.stringify(selectExitSamples)}`);
    }

    // 11) Overlay screenshots for the record ----------------------------------------
    await page.goto(url('scheme=light&density=regular&section=overlays'), { waitUntil: 'networkidle' });
    await page.getByTestId('open-dialog').click();
    await page.waitForTimeout(700);
    const dialogGeometry = await page.locator('.nimi-overlay-panel--dialog').evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        viewportCenterX: window.innerWidth / 2,
        viewportCenterY: window.innerHeight / 2,
      };
    });
    if (Math.abs(dialogGeometry.centerX - dialogGeometry.viewportCenterX) <= 2
      && Math.abs(dialogGeometry.centerY - dialogGeometry.viewportCenterY) <= 2) {
      passes.push('dialog-centering: Motion transform composition preserves viewport centering');
    } else {
      failures.push(`dialog-centering: expected viewport center, got ${JSON.stringify(dialogGeometry)}`);
    }
    await page.screenshot({ path: path.join(shotsDir, 'state-dialog-open-light.png') });
    await page.keyboard.press('Escape');
    await page.goto(url('scheme=dark&density=regular&section=overlays'), { waitUntil: 'networkidle' });
    await page.getByTestId('open-dialog').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shotsDir, 'state-dialog-open-dark.png') });
  } finally {
    await browser.close();
    server.close();
  }

  // --- report -------------------------------------------------------------------
  const report = {
    date: stamp,
    scope: 'kit/preview rendered audit + static source scan',
    summary: { failures: failures.length, warnings: warnings.length, passes: passes.length },
    failures,
    warnings,
    passes,
    metrics,
    hardcodedSites: hardcodedHits,
    screenshots: fs.readdirSync(shotsDir).sort(),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const md = [
    `# Nimi Kit Preview Audit — ${stamp}`,
    '',
    `**Result:** ${failures.length === 0 ? 'PASS' : 'FAIL'} (${failures.length} failures, ${warnings.length} warnings, ${passes.length} passes)`,
    '',
    '## Failures',
    ...(failures.length ? failures.map((f) => `- ❌ ${f}`) : ['- none']),
    '',
    '## Warnings',
    ...(warnings.length ? warnings.map((w) => `- ⚠️ ${w}`) : ['- none']),
    '',
    '## Passes',
    ...passes.map((p) => `- ✅ ${p}`),
    '',
    `Screenshots: ${path.relative(repoRoot, shotsDir)}/`,
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), md);

  console.log(`\nkit-preview-audit: ${failures.length === 0 ? 'PASS' : 'FAIL'} — ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed`);
  failures.forEach((f) => console.error(`  ❌ ${f}`));
  console.log(`report: ${path.relative(repoRoot, outDir)}/report.md`);
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('kit-preview-audit: runner error', err);
  process.exit(2);
});
