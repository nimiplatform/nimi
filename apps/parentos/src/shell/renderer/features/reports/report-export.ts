/* ──────────────────────────────────────────────────────────────
 * Report export helpers — PDF (via window.print) + PNG (via html2canvas).
 * Both work inside Tauri's WebView without any Tauri plugin: print
 * uses the OS print dialog ("Save as PDF"), and PNG uses a data URL
 * download link. No filesystem plugin needed.
 * ───────────────────────────────────────────────────────────── */

export type PrintMode = 'letter' | 'professional';

/**
 * Triggers the browser's print dialog with the printable region flagged.
 * The caller's root element must have class `report-printable-page`
 * and the rest of the shell must be tagged with `.hide-on-print` or
 * handled by the rules in styles.css.
 *
 * After printing, the `data-print-mode` attribute is removed so future
 * UI interactions aren't affected by lingering print styling.
 */
export function printReport(mode: PrintMode = 'letter'): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const prev = document.body.getAttribute('data-print-mode');
  document.body.setAttribute('data-print-mode', mode);

  // `afterprint` may fire asynchronously (Chromium). Use it to restore state.
  const cleanup = () => {
    if (prev) document.body.setAttribute('data-print-mode', prev);
    else document.body.removeAttribute('data-print-mode');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Defer one frame so the browser applies the attribute before paint.
  requestAnimationFrame(() => {
    try {
      window.print();
    } catch {
      cleanup();
    }
  });
}

interface ExportPngOptions {
  filename?: string;
  backgroundColor?: string;
  scale?: number;
}

/**
 * Renders the given DOM node to a PNG and triggers a download.
 * html2canvas is loaded lazily so it doesn't weigh down the initial
 * renderer bundle. Returns a promise that resolves with the filename
 * written, or rejects with the underlying error.
 */
export async function exportReportAsPng(
  target: HTMLElement | null,
  options: ExportPngOptions = {},
): Promise<string> {
  if (!target) throw new Error('No target element to export.');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PNG export requires a browser environment.');
  }
  const { default: html2canvas } = await import('html2canvas');
  const scale = options.scale ?? Math.min(window.devicePixelRatio || 1, 2);
  const canvas = await html2canvas(target, {
    backgroundColor: options.backgroundColor ?? '#fffdf5',
    scale,
    useCORS: true,
    logging: false,
    // Disable shadow compositing that crashes in some WebViews.
    allowTaint: false,
    removeContainer: true,
  });

  const filename = options.filename ?? `growth-report-${formatTimestamp(new Date())}.png`;
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png', 0.95),
  );
  if (!blob) throw new Error('Failed to encode PNG.');

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    // Append, click, remove — needed for some browsers to honor `download`.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Release the blob URL on the next tick — some browsers need the click
    // to complete before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
