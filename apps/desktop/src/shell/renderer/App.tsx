import { useLayoutEffect, useState } from 'react';

import { desktopCanonicalRendererFactory } from './renderer/factory.js';
import { createDesktopProductionBindings } from './renderer/production-bindings.js';
import {
  createDesktopProductionRendererHost,
  type DesktopProductionRendererHost,
} from './renderer/production-host.js';

type DesktopProductionComposition = {
  readonly host: DesktopProductionRendererHost;
  readonly instance: ReturnType<typeof desktopCanonicalRendererFactory.createInstance>;
};

export default function App() {
  const [composition, setComposition] = useState<DesktopProductionComposition | null>(null);

  useLayoutEffect(() => {
    const renderer = document.getElementById('root');
    if (!renderer) throw new Error('ROOT_MOUNT_NODE_MISSING');
    const host = createDesktopProductionRendererHost({
      opaqueScopePrefix: 'nimi-desktop-product',
      renderer,
    });
    let instance: DesktopProductionComposition['instance'];
    try {
      const bindings = createDesktopProductionBindings(host.binding.facade);
      instance = desktopCanonicalRendererFactory.createInstance(bindings);
    } catch (error) {
      host.dispose();
      throw error;
    }
    const next = Object.freeze({ host, instance });
    setComposition(next);
    return () => {
      setComposition((current) => current === next ? null : current);
      instance.dispose();
      host.dispose();
    };
  }, []);

  return composition?.instance.surfaces.main.render() ?? null;
}
