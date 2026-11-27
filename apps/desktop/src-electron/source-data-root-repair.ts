import { app, BrowserWindow } from 'electron';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-014-repair-required
// The Windows source Runtime refused to start. No app preload, Runtime IPC
// or data-root capability is installed in this temporary Home window.
export async function showSourceDataRootRepair(detail: string, exit: (code: number) => void): Promise<void> {
  await app.whenReady();
  const zh = app.getLocale().startsWith('zh');
  const title = zh ? '请修复 Nimi 数据文件夹' : 'Repair your Nimi data folder';
  const guide = zh
    ? 'Runtime 未能验证已选的数据文件夹。请按下方诊断恢复原目录及其内容。如果必需的目录被同名文件占用，请先保存该文件，再从备份恢复目录。修复后可让 Runtime 重新检查。'
    : 'Runtime could not verify the selected data folder. Restore the original directory and its contents using the diagnostic below. If a file has taken the place of a required directory, preserve the file before restoring the directory from a backup. Then ask Runtime to check again.';
  const retry = zh ? '重新检查并打开 Home' : 'Recheck and open Home';
  const retryURL = 'about:blank#recheck-data-folder';
  const diagnostic = detail.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const window = new BrowserWindow({
    title: 'Nimi Home', width: 720, height: 470, minWidth: 400, minHeight: 320, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'source-startup-repair' },
  });
  window.removeMenu();
  let exitCode = 1;
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Intercept the page's single link before Electron creates a new window.
  // No renderer script or IPC bridge is needed to request a clean retry.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === retryURL) {
      exitCode = 76;
      setImmediate(() => window.close());
    }
    return { action: 'deny' };
  });
  window.once('closed', () => exit(exitCode));
  app.on('second-instance', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
  const html = `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Nimi Home</title><style>
:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif}body{margin:0}main{max-width:54em;margin:auto;padding:clamp(20px,5vw,42px)}
h1{font-size:1.5rem;margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid GrayText;border-radius:6px;font-size:.85rem}
a{display:inline-block;padding:8px 14px;border-radius:6px;background:Highlight;color:HighlightText;text-decoration:none;font-weight:600}
</style></head><body><main><h1>${title}</h1><p>${guide}</p>
<pre aria-label="Runtime diagnostic">${diagnostic}</pre><a target="_blank" href="${retryURL}">${retry}</a></main></body></html>`;
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  window.show();
}
