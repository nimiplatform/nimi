export type NimiElectronStandardApplicationMenuOptions = {
  readonly appName?: string;
  readonly platform?: NodeJS.Platform;
};

export type NimiElectronStandardMenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll';

export type NimiElectronStandardMenuItem = {
  label?: string;
  role?: NimiElectronStandardMenuRole;
  type?: 'separator';
  submenu?: NimiElectronStandardMenuItem[];
};

export function createNimiElectronStandardApplicationMenuTemplate(
  options: NimiElectronStandardApplicationMenuOptions = {},
): NimiElectronStandardMenuItem[] {
  const editMenu = createNimiElectronStandardEditMenuTemplate();
  if ((options.platform ?? process.platform) !== 'darwin') {
    return [editMenu];
  }
  return [
    createNimiElectronStandardMacAppMenuTemplate(options.appName),
    editMenu,
  ];
}

export function createNimiElectronStandardEditMenuTemplate(): NimiElectronStandardMenuItem {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  };
}

function createNimiElectronStandardMacAppMenuTemplate(appName: string | undefined): NimiElectronStandardMenuItem {
  return {
    label: normalizeMenuLabel(appName) || 'Nimi',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

function normalizeMenuLabel(value: unknown): string {
  return String(value ?? '').trim();
}
