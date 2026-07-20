import { useEffect, useState } from 'react';
import { NimiRendererHostProvider, type NimiRendererHostBindingV1, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';

import { testerCanonicalRendererFactory } from '../renderer/factory.js';
import { createTesterProductionBindings } from '../renderer/production-bindings.js';
import '../renderer/styles.css';
import { AuthGate } from './auth/auth-gate.js';

export function App(props: {
  readonly rendererHost: NimiRendererHostBindingV1<NimiRendererHostMethodMap>;
}) {
  const [canonical, setCanonical] = useState<ReturnType<
    typeof testerCanonicalRendererFactory.createInstance
  > | null>(null);
  useEffect(() => {
    const instance = testerCanonicalRendererFactory.createInstance(
      createTesterProductionBindings(props.rendererHost.facade),
    );
    setCanonical(instance);
    return () => { void instance.dispose(); };
  }, [props.rendererHost]);
  return (
    <NimiRendererHostProvider binding={props.rendererHost}>
      <AuthGate>
        {canonical?.surfaces.main.render() ?? null}
      </AuthGate>
    </NimiRendererHostProvider>
  );
}
