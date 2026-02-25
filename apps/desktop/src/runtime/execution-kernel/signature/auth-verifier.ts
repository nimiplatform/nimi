import type { AccessMode } from '../contracts/types';
import { RuntimeControlPlaneClient } from '../../control-plane/client';

export class AuthVerifier {
  constructor(private readonly controlPlane = new RuntimeControlPlaneClient()) {}

  async verify(input: {
    modId: string;
    version: string;
    signerId?: string;
    signature?: string;
    digest?: string;
    mode: AccessMode;
  }): Promise<{ ok: boolean; reasonCodes: string[] }> {
    const signerId = String(input.signerId || '');
    const signature = String(input.signature || '');
    const digest = String(input.digest || '');

    if (!signerId || !signature || !digest) {
      if (input.mode === 'local-dev' || input.mode === 'sideload') {
        return { ok: true, reasonCodes: ['SIGNATURE_MISSING_ALLOW_WITH_WARNING'] };
      }
      return { ok: false, reasonCodes: ['SIGNATURE_MISSING'] };
    }

    const result = await this.controlPlane.verifySignature({
      modId: input.modId,
      version: input.version,
      signerId,
      signature,
      digest,
      mode: input.mode,
    });

    if (result.verified) {
      return { ok: true, reasonCodes: result.reasonCodes };
    }
    if (input.mode === 'local-dev' || input.mode === 'sideload') {
      return { ok: true, reasonCodes: ['SIGNATURE_UNVERIFIED_ALLOW_WITH_WARNING', ...result.reasonCodes] };
    }
    return { ok: false, reasonCodes: result.reasonCodes };
  }
}

