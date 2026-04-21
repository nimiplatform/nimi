// Minimal type shape for the official Live2D Cubism Core runtime (binary, loaded via <script>).
// Full SDK Framework integration is deferred to M3-extended; Phase 1 only needs to verify
// Core is loaded and expose a stub plugin API for NAS handlers.

export type CubismMocVersion = number;

export interface CubismCoreGlobal {
  Version: {
    csmGetVersion(): number;
    csmGetLatestMocVersion(): number;
  };
  Moc: {
    fromArrayBuffer(buffer: ArrayBuffer): unknown | null;
  };
  Model: {
    fromMoc(moc: unknown): unknown | null;
  };
  Logging: {
    csmSetLogFunction(fn: (message: string) => void): void;
  };
}

declare global {
  interface Window {
    Live2DCubismCore?: CubismCoreGlobal;
  }
}

export {};
