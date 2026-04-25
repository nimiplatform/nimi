// Minimal type shape for the official Live2D Cubism Core runtime (binary, loaded via <script>).
// Full SDK Framework integration is deferred to M3-extended; Phase 1 only needs to verify
// Core is loaded and expose a stub plugin API for NAS handlers.

export type CubismMocVersion = number;

export type CubismMocHandle = {
  _release?(): void;
};

export type CubismModelHandle = {
  update?(): void;
  release?(): void;
};

export interface CubismCoreGlobal {
  Version: {
    csmGetVersion(): number;
    csmGetLatestMocVersion(): number;
  };
  Moc: {
    fromArrayBuffer(buffer: ArrayBuffer): CubismMocHandle | null;
  };
  Model: {
    fromMoc(moc: CubismMocHandle): CubismModelHandle | null;
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
