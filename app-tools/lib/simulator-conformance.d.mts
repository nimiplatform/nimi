import type { SimulatorCssValidation } from './simulator-css-profile.mjs';

export declare function isSimulatorStaticAssetPath(filePath: string): boolean;

export declare function validateSimulatorAppSource(rootDir: string, options?: Readonly<Record<string, unknown>>): {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly style: SimulatorCssValidation;
  readonly fixture: Readonly<Record<string, unknown>>;
};

export declare function validateSimulatorSelectedDependencyModule(
  code: string,
  canonicalPath: string,
): { readonly specifiers: readonly string[] };
