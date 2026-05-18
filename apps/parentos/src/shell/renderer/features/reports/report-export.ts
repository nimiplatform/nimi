/* ──────────────────────────────────────────────────────────────
 * Report export helpers.
 *
 * Two-phase flow (designed so the OS save dialog appears *immediately*
 * on click, not after a multi-second render):
 *
 *   1. `pick_report_save_path` (Rust) opens the native rfd save
 *      dialog and returns the chosen absolute path (or null on
 *      cancel).
 *   2. The renderer then captures the article DOM with `html-to-image`
 *      (SVG <foreignObject> + native browser paint — supports modern
 *      CSS like var(), color-mix(), oklch()) and, for PDF, wraps the
 *      bitmap in an A4 jsPDF document.
 *   3. `write_report_file_at` (Rust) writes the bytes to the path
 *      picked in step 1.
 *
 * window.print() is intentionally avoided: under the Tauri WebView on
 * Windows it yields an empty/blank print dialog.
 * ───────────────────────────────────────────────────────────── */

import { invoke } from '@tauri-apps/api/core';

export type PrintMode = 'letter' | 'professional';

/**
 * Legacy print path kept for the professional summary modal, which
 * still relies on body[data-print-mode] + CSS scoping to print a
 * subtree. Migrating that flow is tracked separately.
 */
export function printReport(mode: PrintMode = 'letter'): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const prev = document.body.getAttribute('data-print-mode');
  document.body.setAttribute('data-print-mode', mode);

  const cleanup = () => {
    if (prev) document.body.setAttribute('data-print-mode', prev);
    else document.body.removeAttribute('data-print-mode');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  requestAnimationFrame(() => {
    try {
      window.print();
    } catch {
      cleanup();
    }
  });
}

interface ExportOptions {
  filename?: string;
  backgroundColor?: string;
  scale?: number;
}

export interface ExportResult {
  /** Absolute path the user chose, or null if the dialog was cancelled. */
  savedPath: string | null;
  /** Filename presented to / accepted by the user. */
  filename: string;
}

type SaveKind = 'pdf' | 'png';

async function pickSavePath(
  defaultFilename: string,
  kind: SaveKind,
  title: string,
): Promise<string | null> {
  return invoke<string | null>('pick_report_save_path', {
    defaultFilename,
    kind,
    title,
  });
}

async function writeReportFileAt(path: string, base64Data: string): Promise<string> {
  return invoke<string>('write_report_file_at', { path, base64Data });
}

/**
 * CSS classes whose elements are dropped from the cloned DOM during
 * capture. These are decorative overlays that html-to-image's
 * foreignObject path renders as solid black blocks/lines because it
 * can't faithfully reproduce `color-mix(..., transparent)` gradients
 * or `backdrop-filter`.
 */
const EXPORT_DROP_CLASSES: readonly string[] = [
  'report-monthly-grain',         // absolutely-positioned paper-grain gradient overlay
  'report-monthly-timeline-rule', // 1px vertical line via transparent gradient — renders as solid black bar
  'hide-on-print',
  'edit-pencil',
  'report-monthly-edit-pencil',
  'report-note-actions',
  'report-note-composer',
];

const NO_BACKDROP_FILTER_DECLS = ['backdrop-filter', '-webkit-backdrop-filter']
  .map((property) => `${property}: none !important;`)
  .join('\n');

/**
 * Stylesheet injected while the capture runs. Neutralises styling
 * that html-to-image flattens to dark artefacts in the SVG snapshot.
 * Scoped to `[data-report-exporting]` so on-screen UI is untouched.
 */
const EXPORT_CAPTURE_CSS = `
[data-report-exporting] *,
[data-report-exporting] {
  ${NO_BACKDROP_FILTER_DECLS}
  mix-blend-mode: normal !important;
}
[data-report-exporting].report-monthly-page,
[data-report-exporting] .report-monthly-page {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  filter: none !important;
  outline: 0 !important;
  overflow: hidden !important;
}
[data-report-exporting].report-monthly-page {
  padding-left: 56px !important;
  padding-right: 56px !important;
}
[data-report-exporting] .hide-on-print,
[data-report-exporting] .edit-pencil,
[data-report-exporting] .report-monthly-edit-pencil,
[data-report-exporting] .report-note-actions,
[data-report-exporting] .report-note-composer {
  display: none !important;
}
[data-report-exporting] .report-monthly-header,
[data-report-exporting] .report-monthly-title,
[data-report-exporting] .report-monthly-intro,
[data-report-exporting] .report-monthly-hero,
[data-report-exporting] .report-monthly-pullquote,
[data-report-exporting] .report-monthly-highlights,
[data-report-exporting] .report-monthly-timeline,
[data-report-exporting] .report-monthly-watch,
[data-report-exporting] .report-monthly-actions,
[data-report-exporting] .report-monthly-caregiver,
[data-report-exporting] .report-monthly-signoff,
[data-report-exporting] .report-monthly-footer {
  margin-left: auto !important;
  margin-right: auto !important;
  max-width: 472px !important;
  width: 100% !important;
}
[data-report-exporting] .report-monthly-highlight {
  grid-template-columns: 48px minmax(0, 1fr) !important;
}
[data-report-exporting] .report-monthly-timeline-item {
  grid-template-columns: 24px minmax(0, 1fr) !important;
}
[data-report-exporting] .report-monthly-highlight-title,
[data-report-exporting] .report-monthly-timeline-title,
[data-report-exporting] .report-monthly-timeline-body,
[data-report-exporting] .report-monthly-action-title,
[data-report-exporting] .report-monthly-watch-copy {
  max-width: 100% !important;
}
`;

function installCaptureStyles(): () => void {
  if (typeof document === 'undefined') return () => {};
  const style = document.createElement('style');
  style.setAttribute('data-report-export-styles', '');
  style.textContent = EXPORT_CAPTURE_CSS;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

function shouldKeepNode(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  const cls = node.classList;
  if (!cls) return true;
  for (const dropped of EXPORT_DROP_CLASSES) {
    if (cls.contains(dropped)) return false;
  }
  return true;
}

async function renderTargetToCanvas(
  target: HTMLElement,
  options: ExportOptions,
): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image');
  const pixelRatio = options.scale ?? Math.min(window.devicePixelRatio || 1, 2);
  // Lock the capture region to the element's own bounding rect — the
  // article uses `max-width: 640px; margin: 0 auto`, so without this
  // html-to-image can capture a wider area and leave blank gutters.
  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  target.setAttribute('data-report-exporting', '');
  const uninstallStyles = installCaptureStyles();
  // Wait one paint so the injected style takes effect before snapshot.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const canvas = await toCanvas(target, {
      backgroundColor: options.backgroundColor ?? '#fffdf5',
      pixelRatio,
      width,
      height,
      cacheBust: true,
      filter: shouldKeepNode,
    });
    return normalizeExportCanvas(canvas, target, options.backgroundColor ?? '#fffdf5');
  } finally {
    uninstallStyles();
    target.removeAttribute('data-report-exporting');
  }
}

function normalizeExportCanvas(
  source: HTMLCanvasElement,
  target: HTMLElement,
  backgroundColor: string,
): HTMLCanvasElement {
  // Flatten onto an opaque background so the resulting PNG/PDF doesn't
  // expose alpha holes at the article edges.
  const opaque = document.createElement('canvas');
  opaque.width = source.width;
  opaque.height = source.height;
  const ctx = opaque.getContext('2d');
  if (!ctx) return source;

  ctx.fillStyle = resolveCanvasBackground(target, backgroundColor);
  ctx.fillRect(0, 0, opaque.width, opaque.height);
  ctx.drawImage(source, 0, 0);
  repairTallDarkEdgeArtifacts(opaque);
  repairSmallDarkEdgeArtifacts(opaque);

  return opaque;
}

function repairTallDarkEdgeArtifacts(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const runs = findTallDarkRuns(image.data, canvas.width, canvas.height);
  if (runs.length === 0) return;

  const data = image.data;
  for (const run of runs) {
    const sampleX = Math.min(canvas.width - 1, run.end + 3);
    for (let y = 0; y < canvas.height; y += 1) {
      const sampleOffset = (y * canvas.width + sampleX) * 4;
      const r = data[sampleOffset] ?? 255;
      const g = data[sampleOffset + 1] ?? 253;
      const b = data[sampleOffset + 2] ?? 245;
      const a = data[sampleOffset + 3] ?? 255;
      for (let x = run.start; x <= run.end; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

function findTallDarkRuns(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Array<{ start: number; end: number }> {
  const scanWidth = Math.min(width, Math.max(48, Math.floor(width * 0.22)));
  const darkColumn = new Uint8Array(scanWidth);
  const minDarkRatio = 0.82;

  for (let x = 0; x < scanWidth; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 255;
      const red = data[offset] ?? 255;
      const green = data[offset + 1] ?? 255;
      const blue = data[offset + 2] ?? 255;
      if (alpha > 220 && red < 28 && green < 28 && blue < 28) {
        dark += 1;
      }
    }
    darkColumn[x] = dark / height >= minDarkRatio ? 1 : 0;
  }

  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let x = 0; x <= scanWidth; x += 1) {
    const isDark = x < scanWidth && darkColumn[x] === 1;
    if (isDark && start < 0) {
      start = x;
    } else if (!isDark && start >= 0) {
      const end = x - 1;
      const runWidth = end - start + 1;
      if (runWidth >= 2 && runWidth <= 64) {
        runs.push({ start, end });
      }
      start = -1;
    }
  }
  return runs;
}

function repairSmallDarkEdgeArtifacts(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const maxX = Math.min(canvas.width, Math.max(80, Math.floor(canvas.width * 0.28)));
  const visited = new Uint8Array(maxX * canvas.height);

  const isDark = (x: number, y: number) => {
    const offset = (y * canvas.width + x) * 4;
    const alpha = data[offset + 3] ?? 255;
    const red = data[offset] ?? 255;
    const green = data[offset + 1] ?? 255;
    const blue = data[offset + 2] ?? 255;
    return alpha > 220 && red < 36 && green < 36 && blue < 36;
  };

  const stack: Array<[number, number]> = [];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < maxX; x += 1) {
      const startIndex = y * maxX + x;
      if (visited[startIndex] || !isDark(x, y)) continue;

      let minX = x;
      let maxRunX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      visited[startIndex] = 1;
      stack.push([x, y]);

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        count += 1;
        minX = Math.min(minX, cx);
        maxRunX = Math.max(maxRunX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        const neighbors: Array<[number, number]> = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= maxX || ny < 0 || ny >= canvas.height) continue;
          const index = ny * maxX + nx;
          if (visited[index] || !isDark(nx, ny)) continue;
          visited[index] = 1;
          stack.push([nx, ny]);
        }
      }

      const width = maxRunX - minX + 1;
      const height = maxY - minY + 1;
      const mostlyFilled = count / (width * height) > 0.45;
      const edgeArtifact =
        width >= 8
        && width <= 96
        && height <= 28
        && minX <= 48
        && mostlyFilled;
      if (!edgeArtifact) continue;

      fillRectFromNeighbor(data, canvas.width, canvas.height, minX, minY, maxRunX, maxY);
    }
  }

  ctx.putImageData(image, 0, 0);
}

function fillRectFromNeighbor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const sampleX = Math.min(width - 1, maxX + 4);
  for (let y = minY; y <= maxY; y += 1) {
    const sampleOffset = (y * width + sampleX) * 4;
    const r = data[sampleOffset] ?? 255;
    const g = data[sampleOffset + 1] ?? 253;
    const b = data[sampleOffset + 2] ?? 245;
    const a = data[sampleOffset + 3] ?? 255;
    for (let x = minX; x <= maxX; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
}

function resolveCanvasBackground(target: HTMLElement, fallback: string): string {
  if (fallback && !fallback.includes('var(')) return fallback;
  const computed = window.getComputedStyle(target).backgroundColor;
  if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
    return computed;
  }
  return '#fffdf5';
}

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/png', 0.95);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Failed to encode PNG.');
  return dataUrl.slice(comma + 1);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Renders the given DOM node to a PNG. The native save dialog opens
 * immediately so the user picks a destination *before* the (multi-
 * second) DOM capture runs.
 */
export async function exportReportAsImage(
  target: HTMLElement | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (!target) throw new Error('No target element to export.');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PNG export requires a browser environment.');
  }

  const filename = options.filename ?? `growth-report-${formatTimestamp(new Date())}.png`;
  const chosenPath = await pickSavePath(filename, 'png', '另存为图片');
  if (!chosenPath) return { savedPath: null, filename };

  const canvas = await renderTargetToCanvas(target, options);
  const base64Data = canvasToPngBase64(canvas);
  const savedPath = await writeReportFileAt(chosenPath, base64Data);
  return { savedPath, filename };
}

/**
 * Renders the given DOM node into a PDF (multi-page A4 when needed).
 * The native save dialog opens immediately so the user picks a
 * destination *before* the render/encode work begins.
 */
export async function exportReportAsPdf(
  target: HTMLElement | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (!target) throw new Error('No target element to export.');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export requires a browser environment.');
  }

  const filename = options.filename ?? `growth-report-${formatTimestamp(new Date())}.pdf`;
  const chosenPath = await pickSavePath(filename, 'pdf', '另存为 PDF');
  if (!chosenPath) return { savedPath: null, filename };

  const canvas = await renderTargetToCanvas(target, options);
  const { jsPDF } = await import('jspdf');

  // Use a single tall PDF page instead of splitting the report into A4
  // pages. This preserves the exported long-image reading experience
  // and avoids page-cut artefacts through text.
  const pageWidth = 210;
  const marginX = 10;
  const marginY = 10;
  const imgWidth = pageWidth - 2 * marginX;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const pageHeight = Math.max(297, imgHeight + 2 * marginY);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, pageHeight],
  });
  const dataUrl = canvas.toDataURL('image/png', 0.95);
  pdf.addImage(dataUrl, 'PNG', marginX, marginY, imgWidth, imgHeight, undefined, 'FAST');

  const pdfBlob = pdf.output('blob');
  const base64Data = await blobToBase64(pdfBlob);
  const savedPath = await writeReportFileAt(chosenPath, base64Data);
  return { savedPath, filename };
}
