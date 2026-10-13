// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome-host
export const NIMI_CHROME_NATIVE_COMMANDS = [
  'undo', 'redo', 'cut', 'copy', 'paste', 'select-all',
  'zoom-in', 'zoom-out', 'zoom-reset', 'toggle-fullscreen', 'close-window', 'quit-app',
] as const;
export type NimiChromeNativeCommand = typeof NIMI_CHROME_NATIVE_COMMANDS[number];
export type NimiChromeLocale = 'en' | 'zh';
export type NimiChromeGeometry = {
  readonly left: number;
  readonly right: number;
  readonly height: number;
};
export type NimiChromeState = {
  readonly generation: string;
  /** Independent UI behavior, not a Host/OS identifier or presentation variant. */
  readonly menuPlacement: 'window' | 'system';
  readonly windowDrag: boolean;
  readonly geometry: NimiChromeGeometry;
  readonly zoomFactor: number;
  readonly fullscreen: boolean;
  readonly nativeCommands: readonly NimiChromeNativeCommand[];
  readonly shortcuts: readonly NimiChromeShortcut[];
};
export type NimiChromeShortcut = {
  readonly commandId: string;
  readonly keys: string;
  readonly owner: 'renderer' | 'host' | 'native-edit';
};
export type NimiChromeBindRequest = { readonly locale: NimiChromeLocale };
export type NimiChromeCommandState = {
  readonly id: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly checked: boolean;
};
export type NimiChromeStateSetRequest = {
  readonly generation: string;
  readonly locale: NimiChromeLocale;
  readonly commands: readonly NimiChromeCommandState[];
  readonly suppressMenuShortcuts: boolean;
};
export type NimiChromeCommandRequest = {
  readonly generation: string;
  readonly command: NimiChromeNativeCommand;
};
export type NimiChromeUnbindRequest = { readonly generation: string };
export type NimiChromeCommandEvent = {
  readonly generation: string;
  readonly commandId: string;
};
export const NIMI_CHROME_COMMAND_EVENT = 'nimi.shell.ui.chromeCommand';
export const NIMI_CHROME_STATE_EVENT = 'nimi.shell.ui.chromeState';
