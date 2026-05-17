/* ──────────────────────────────────────────────────────────────
 * Report export helpers.
 *
 * The renderer-side flow:
 *   1. html2canvas captures the printable article DOM at 2x scale.
 *   2. For PDF: jsPDF wraps the bitmap in an A4 page (auto multi-page
 *      when the report is taller than one sheet).
 *   3. The resulting bytes are handed to the Tauri command
 *      `save_report_file`, which opens the OS-native "Save as" dialog
 *      (rfd::FileDialog::save_file) and writes the file to disk.
 *
 * window.print() is intentionally not used: under the Tauri WebView
 * on Windows it yields an empty/blank print dialog, so users got no
 * actual file. Routing through rfd guarantees the system picker shows
 * up with the user's usual save locations.
 * ───────────────────────────────────────────────────────────── */

import { invoke } from '@tauri-apps/api/core';

export type PrintMode = 'letter' | 'professional';

/**
 * Legacy print path kept for the professional summary modal, which
 * still relies on body[data-print-mode] + CSS scoping to print a
 * subtree. Browsers outside Tauri (vitest jsdom, dev preview) honor
 * window.print(); Tauri WebView does not. Migrating that flow is
 * tracked separately.
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

async function renderTargetToCanvas(
  target: HTMLElement,
  options: ExportOptions,
): Promise<HTMLCanvasElement> {
  // html-to-image uses SVG <foreignObject> + native browser rendering,
  // so it correctly handles modern CSS (var(), color-mix(), oklch(),
  // lab/lch) — html2canvas and html2canvas-pro both reimplement a CSS
  // parser internally and choke on nimi-kit's theme tokens with
  // "Attempting to parse an unsupported color function 'var'".
  const { toCanvas } = await import('html-to-image');
  const pixelRatio = options.scale ?? Math.min(window.devicePixelRatio || 1, 2);
  return toCanvas(target, {
    backgroundColor: options.backgroundColor ?? '#fffdf5',
    pixelRatio,
    cacheBust: true,
  });
}

function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  // toDataURL returns "data:image/png;base64,<payload>" — strip the prefix.
  const dataUrl = canvas.toDataURL('image/png', 0.95);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Failed to encode PNG.');
  return dataUrl.slice(comma + 1);
}

async function saveViaTauri(
  base64Data: string,
  defaultFilename: string,
  kind: 'pdf' | 'png',
  title: string,
): Promise<string | null> {
  return invoke<string | null>('save_report_file', {
    base64Data,
    defaultFilename,
    kind,
    title,
  });
}

/**
 * Renders the given DOM node to a PNG and hands the bytes to the
 * Tauri `save_report_file` command, which shows the OS-native save
 * dialog so the user can pick where to put the file.
 */
export async function exportReportAsImage(
  target: HTMLElement | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (!target) throw new Error('No target element to export.');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PNG export requires a browser environment.');
  }
  const canvas = await renderTargetToCanvas(target, options);
  const base64Data = canvasToPngBase64(canvas);
  const filename = options.filename ?? `growth-report-${formatTimestamp(new Date())}.png`;
  const savedPath = await saveViaTauri(base64Data, filename, 'png', '另存为图片');
  return { savedPath, filename };
}

/**
 * Renders the given DOM node into a PDF (multi-page A4 when needed)
 * and hands the bytes to the Tauri save dialog. Pure-renderer path —
 * no Tauri WebView print integration is involved.
 */
export async function exportReportAsPdf(
  target: HTMLElement | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (!target) throw new Error('No target element to export.');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF export requires a browser environment.');
  }

  const canvas = await renderTargetToCanvas(target, options);
  const { jsPDF } = await import('jspdf');

  // A4 portrait: 210mm × 297mm. We fit the bitmap to the full width
  // and let jsPDF span as many pages as the height requires.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const dataUrl = canvas.toDataURL('image/png', 0.95);

  if (imgHeight <= pageHeight) {
    pdf.addImage(dataUrl, 'PNG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
  } else {
    // Slice the bitmap into A4-sized vertical bands. We do this by
    // shifting the image's Y origin upward and clipping each page
    // viewport — jsPDF doesn't natively split a single addImage call
    // across pages, but it does honor negative Y offsets.
    let remaining = imgHeight;
    let position = 0;
    while (remaining > 0) {
      pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      remaining -= pageHeight;
      if (remaining > 0) {
        position -= pageHeight;
        pdf.addPage();
      }
    }
  }

  const pdfBlob = pdf.output('blob');
  const base64Data = await blobToBase64(pdfBlob);
  const filename = options.filename ?? `growth-report-${formatTimestamp(new Date())}.pdf`;
  const savedPath = await saveViaTauri(base64Data, filename, 'pdf', '另存为 PDF');
  return { savedPath, filename };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // btoa needs a binary string; build it in chunks to avoid stack
  // overflow on large PDFs.
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
