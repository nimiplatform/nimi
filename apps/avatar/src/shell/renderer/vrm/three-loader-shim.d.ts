// Type bridge governed by docs/authority/avatar-embodiment-rationale.md.
//
// `three` does not ship .d.ts for its `examples/jsm/**` add-on modules and
// we deliberately do not add a workspace-wide `@types/three` dependency at
// this wave. The vrm-loader only needs the GLTFLoader constructor + a
// minimal `loadAsync` shape; richer typing is provided by `@pixiv/three-vrm`
// which already declares its own dependency on three's types via
// `skipLibCheck`. This shim is scoped to the apps/avatar VRM module surface
// and is intentionally narrow.
//
// If a workspace-wide @types/three is ever admitted, this shim should be
// deleted and the loader code typed against the real declarations.

// Wave 2 chunk 2-E: opaque shim for the bare `three` module so the
// framing glue (vrm-framing.ts) can `import { Box3, Vector3 } from 'three'`
// without `noImplicitAny` complaining. Mirrors the existing kit/ui shim
// at `kit/ui/src/types/three-shim.d.ts` (which apps/avatar's tsconfig
// does not transitively include). Empty body gives `any` for every
// export — sufficient since the surface only consumes plain numeric
// fields off the result. Adding `@types/three` workspace-wide would
// remove the need for this shim.
declare module 'three';

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export interface GLTFLoaderPluginCtorArg {
    // GLTFParser instance shape is internal — opaque here.
    [key: string]: unknown;
  }

  export type GLTFLoaderPlugin = {
    name?: string;
    [key: string]: unknown;
  };

  export interface GLTF {
    scene: unknown;
    scenes: unknown[];
    animations: unknown[];
    cameras: unknown[];
    asset: { version?: string; [k: string]: unknown };
    parser: unknown;
    userData: Record<string, unknown>;
  }

  export class GLTFLoader {
    constructor(manager?: unknown);
    crossOrigin: string;
    register(callback: (parser: unknown) => GLTFLoaderPlugin): GLTFLoader;
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF>;
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: unknown) => void,
    ): void;
    setPath(path: string): GLTFLoader;
    setResourcePath(path: string): GLTFLoader;
  }
}
