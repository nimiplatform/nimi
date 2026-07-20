export declare function createMaterializedIntegrityVerifier(options: {
  readonly generatedRoot: string;
}): Readonly<{
  verifyAll(): void;
  verifyTransform(code: string, id: string): boolean;
}>;
