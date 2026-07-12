import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const forbiddenPatterns = [
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~-]{12,}/giu],
  ['jwt', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu],
  ['packet_proof', /(?:detachedJws|packetProof|materializationProof)\s*["':=]/giu],
  ['raw_prompt', /(?:rawSystemPrompt|privateLane|rawMemory|rawPacket)\s*["':=]/giu],
  ['private_canary', /NIMI_PRIVATE_CANARY_[A-Z0-9_-]+/gu],
];

export function scanText(text, label) {
  const findings = [];
  for (const [id, pattern] of forbiddenPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${id}:${label}`);
  }
  return findings;
}

export function scanArtifactFiles(files) {
  const findings = [];
  const ocr = [];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (['.json', '.jsonl', '.log', '.txt', '.html', '.md', '.yaml', '.yml'].includes(extension)) {
      findings.push(...scanText(fs.readFileSync(file, 'utf8'), file));
      continue;
    }
    if (extension === '.png') {
      let text;
      try {
        text = execFileSync('tesseract', [file, 'stdout', '--psm', '6'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        throw new Error(`screenshot OCR failed closed for ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      findings.push(...scanText(text, `${file}:ocr`));
      ocr.push({ file, textLength: text.length });
    }
  }
  return { ok: findings.length === 0, findings, ocr };
}
