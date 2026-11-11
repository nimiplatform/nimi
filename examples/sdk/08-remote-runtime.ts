import { connectRemoteRuntime } from '@nimiplatform/sdk/runtime/remote';
import type { RuntimeClientSession } from '@nimiplatform/sdk/realm/runtime-client';

/** Receives a current session established by official Runtime-client login.
 * The App owns UI lifetime; this one-shot example closes only its connection. */
export async function generateThroughPrimaryRuntime(
  session: RuntimeClientSession,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const connection = await connectRemoteRuntime(session, { signal });
  try {
    if (connection.role !== 'app') throw new Error('An ordinary App session is required.');
    const result = await connection.ai.text.generateCandidate({
      messages: [{ role: 'user', text: prompt }],
    });
    signal.throwIfAborted();
    return result.text;
  } finally {
    connection.close();
  }
}
