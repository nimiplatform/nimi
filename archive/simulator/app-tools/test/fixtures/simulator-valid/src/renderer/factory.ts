import { z } from 'zod';

const SampleLabel = z.string().min(1);

export interface SampleRendererInstance {
  readonly surfaces: Readonly<{
    readonly main: {
      readonly id: 'main';
      render(): string;
    };
  }>;
  dispose(): void;
}

export const sampleCanonicalRendererFactory = Object.freeze({
  factoryId: 'sample-app/canonical-renderer',
  createInstance(
    bindings: Readonly<Record<string, unknown>>,
  ): SampleRendererInstance {
    const label = SampleLabel.parse(typeof bindings.label === 'string' ? bindings.label : 'Sample');
    let disposed = false;
    return {
      surfaces: Object.freeze({
        main: Object.freeze({
          id: 'main' as const,
          render() {
            if (disposed) throw new Error('sample renderer instance is disposed');
            return label;
          },
        }),
      }),
      dispose() {
        disposed = true;
      },
    };
  },
});
