// Minimal type shape for the official Live2D Cubism Core runtime (binary, loaded via <script>).
// Full SDK Framework integration is owned by the Live2D branch; this type shape
// verifies Core loading and exposes the minimal Live2D runtime plugin API.

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
