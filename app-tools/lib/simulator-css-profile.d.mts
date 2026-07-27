import type { Plugin } from 'vite';

export interface SimulatorCssValidation {
  readonly entry: string;
  readonly digest: string;
  readonly rootClass: string;
  readonly globalPrefix: string;
  readonly inputs: readonly { readonly path: string; readonly digest: string; readonly bytes: number }[];
  readonly production: {
    readonly hostFoundationInputs: readonly {
      readonly path: string;
      readonly digest: string;
      readonly bytes: number;
      readonly selectors: readonly string[];
    }[];
  };
  readonly profile: {
    readonly scanner: {
      readonly inputs: readonly { readonly path: string; readonly digest: string; readonly bytes: number }[];
    };
    readonly utility: { readonly owner: string; readonly layer: string };
  };
}

export declare const SIMULATOR_CSS_PROFILE_PROTOCOL: 'nimi.simulator.css-profile/v1';
export declare const SIMULATOR_CSS_PROFILE_REVISION: string;
export declare const SIMULATOR_CSS_COMPILER_VERSION: string;
export declare const SIMULATOR_CSS_THEME_DIGEST: string;
export declare const SIMULATOR_KIT_FOUNDATION_CSS_EXPORTS: readonly string[];

export declare function assertSimulatorFoundationEntry(code: string, filePath: string): void;

export declare function createSimulatorCssProfileVitePlugin(options: {
  readonly compilerRoot: string;
  readonly foundationEntry: string;
  readonly apps: readonly { readonly rootDir: string; readonly style: SimulatorCssValidation }[];
}): Plugin;

export declare function buildKitFoundationScannerInventory(kitRoot: string): {
  readonly owner: '@nimiplatform/kit';
  readonly inputs: readonly { readonly path: string; readonly digest: string; readonly bytes: number }[];
  readonly digest: string;
};

export declare function buildKitCssExportInventory(kitRoot: string): readonly {
  readonly specifier: string;
  readonly target: string;
  readonly digest: string;
  readonly closure: readonly { readonly path: string; readonly digest: string; readonly bytes: number }[];
  readonly closure_digest: string;
}[];
