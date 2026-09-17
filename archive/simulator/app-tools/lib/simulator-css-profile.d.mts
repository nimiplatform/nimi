import type { Plugin } from 'vite';

export interface SimulatorCssValidation {
  readonly entry: string;
  readonly rootClass: string;
  readonly globalPrefix: string;
  readonly inputs: readonly { readonly path: string }[];
  readonly profile: {
    readonly scanner: {
      readonly inputs: readonly { readonly path: string }[];
    };
    readonly utility: { readonly owner: string; readonly layer: string };
  };
}

export declare const SIMULATOR_CSS_PROFILE_PROTOCOL: 'nimi.simulator.css-profile/v1';
export declare const SIMULATOR_CSS_PROFILE_REVISION: string;
export declare const SIMULATOR_CSS_COMPILER_VERSION: string;
export declare const SIMULATOR_KIT_FOUNDATION_CSS_EXPORTS: readonly string[];

export declare function assertSimulatorFoundationEntry(code: string, filePath: string): void;

export declare function createSimulatorCssProfileVitePlugin(options: {
  readonly compilerRoot: string;
  readonly foundationEntry: string;
  readonly apps: readonly { readonly rootDir: string; readonly style: SimulatorCssValidation }[];
}): Plugin;
