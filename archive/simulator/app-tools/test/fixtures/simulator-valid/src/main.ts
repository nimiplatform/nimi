import { sampleCanonicalRendererFactory } from './renderer/factory';
import './renderer/styles.css';

export function startSampleProductionRenderer(bindings: Readonly<Record<string, unknown>>) {
  return sampleCanonicalRendererFactory.createInstance(bindings);
}
