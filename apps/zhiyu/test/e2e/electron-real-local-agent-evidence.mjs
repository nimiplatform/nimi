import assert from 'node:assert/strict';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

export function resolveEvidenceRoot() {
  const checkpoint = process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || 'real-local-agent';
  const productArtifactsRoot = process.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_ARTIFACTS_ROOT?.trim();
  return {
    checkpoint,
    evidenceRoot: productArtifactsRoot
      ? path.resolve(productArtifactsRoot)
      : path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint),
  };
}

export async function resetRealLocalAgentEvidenceRoot() {
  const { evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^real-local-agent-.*\.(?:png|json)$/u.test(entry.name)) {
      await rm(path.join(evidenceRoot, entry.name), { force: true });
    }
  }
}

export async function captureRealLocalAgentEvidence(page, stage, pageProblems, evidence) {
  const { checkpoint, evidenceRoot } = resolveEvidenceRoot();
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(evidenceRoot, `real-local-agent-${stage}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.join(evidenceRoot, `real-local-agent-${stage}-narrow.png`), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const domEvidence = await page.evaluate(() => ({
    url: globalThis.location.href,
    title: globalThis.document.title,
    bodyText: globalThis.document.body?.innerText ?? '',
    zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
  })).catch((error) => ({ evaluationError: error instanceof Error ? error.message : String(error) }));
  await writeFile(path.join(evidenceRoot, `real-local-agent-${stage}-evidence.json`), `${JSON.stringify({
    checkpoint,
    scenario: 'real-local-agent',
    stage,
    pageProblems: [...pageProblems],
    ...evidence,
    domEvidence,
  }, null, 2)}\n`, 'utf8');
}

export async function captureRealLocalAgentPanelEvidence(page, stage) {
  const { evidenceRoot } = resolveEvidenceRoot();
  const panel = page.locator('[data-zhiyu-region="agent-panel"]');
  const panelScroll = page.locator('[data-zhiyu-agent-panel-tab="appearance"]');
  await page.setViewportSize({ width: 1280, height: 900 });
  await panel.screenshot({ path: path.join(evidenceRoot, `real-local-agent-${stage}-panel.png`) });
  await panelScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await panel.screenshot({ path: path.join(evidenceRoot, `real-local-agent-${stage}-panel-bottom.png`) });
}

export function trackPageProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`));
  return problems;
}

export function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}
