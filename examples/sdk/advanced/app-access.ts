/**
 * Session posture and typed failures in a Nimi App.
 *
 * The Host and Runtime own the App session and its access; the App never
 * supplies identity, tokens or an endpoint. Read the posture to decide what to
 * show, and keep a protected operation's typed reason visible to the user.
 */

import type { NimiLocalAppClient } from '@nimiplatform/sdk';

export type AppSessionPosture =
  | { readonly kind: 'bound' }
  | {
    readonly kind: 'unavailable';
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly retryable: boolean;
  };

export async function readAppSessionPosture(client: NimiLocalAppClient): Promise<AppSessionPosture> {
  const session = await client.auth.status();
  if (session.sessionBound) {
    return { kind: 'bound' };
  }
  return {
    kind: 'unavailable',
    reasonCode: session.reasonCode,
    actionHint: session.actionHint,
    retryable: session.retryable,
  };
}

export type AppOperationFailure = {
  readonly reasonCode: string | null;
  readonly actionHint: string | null;
  readonly message: string;
};

export function describeAppOperationFailure(error: unknown): AppOperationFailure {
  const fields = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    reasonCode: typeof fields.reasonCode === 'string' && fields.reasonCode ? fields.reasonCode : null,
    actionHint: typeof fields.actionHint === 'string' && fields.actionHint ? fields.actionHint : null,
    message: error instanceof Error ? error.message : String(error),
  };
}
