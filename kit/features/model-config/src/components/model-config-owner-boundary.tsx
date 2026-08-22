import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type { ModelConfigOwnerContext } from '../types.js';

export type ModelConfigOwnerBoundaryProps = {
  readonly context: ModelConfigOwnerContext;
  readonly children: ReactNode;
  readonly className?: string;
};

// @nimi-authority: definition.nimi.platform.ui-design-system.model-config-surface
// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-001
function assertOwnerContext(context: ModelConfigOwnerContext): void {
  if (context.owner === 'app-ai-config' && !context.appId.trim()) {
    throw new Error('Model Config App AIConfig mode requires an appId.');
  }
}

export function ModelConfigOwnerBoundary({ context, children, className }: ModelConfigOwnerBoundaryProps) {
  assertOwnerContext(context);
  return (
    <div
      className={cn('min-w-0 max-w-full', className)}
      data-nimi-model-config-owner={context.owner}
      {...(context.owner === 'app-ai-config' ? { 'data-nimi-model-config-app-id': context.appId } : {})}
    >
      {children}
    </div>
  );
}
