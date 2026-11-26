import { Menu, type BrowserWindow } from 'electron';
import {
  bindNativeEditContextMenu,
  buildNativeEditContextMenuTemplate,
  type NativeEditContextMenuActions,
  type NativeEditContextMenuLocale,
  type NativeEditContextMenuParams,
} from './context-menu-template.js';

export {
  bindNativeEditContextMenu,
  buildNativeEditContextMenuTemplate,
  type NativeEditContextMenuActions,
  type NativeEditContextMenuLocale,
  type NativeEditContextMenuParams,
};

export function installNativeEditContextMenu(
  window: BrowserWindow,
  getLocale: () => NativeEditContextMenuLocale = () => 'en',
): () => void {
  return bindNativeEditContextMenu(window.webContents, {
    isWindowDestroyed: () => window.isDestroyed(),
    getLocale,
    popupMenu: (template) => {
      Menu.buildFromTemplate(template).popup({ window });
    },
  });
}
