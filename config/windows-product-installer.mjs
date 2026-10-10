import { open } from 'node:fs/promises';
import { ProductUpdateError } from './product-update-contract.mjs';

// The final unsigned NSIS file still needs an authenticated release envelope
// and exact digest/size at its caller. This only validates the admitted PE
// architecture and absence of a development Authenticode substitution.
export async function verifyWindowsUnsignedInstaller(file) {
  const handle = await open(file, 'r');
  try {
    const dos = Buffer.alloc(64); if ((await handle.read(dos, 0, 64, 0)).bytesRead !== 64 || dos.readUInt16LE(0) !== 0x5a4d) throw new Error('PE');
    const offset = dos.readUInt32LE(0x3c); if (offset > 1024 * 1024) throw new Error('PE');
    const header = Buffer.alloc(264); if ((await handle.read(header, 0, header.length, offset)).bytesRead !== header.length || header.readUInt32LE(0) !== 0x00004550) throw new Error('PE');
    const x64 = header.readUInt16LE(4) === 0x8664 && header.readUInt16LE(24) === 0x20b;
    const x86 = header.readUInt16LE(4) === 0x14c && header.readUInt16LE(24) === 0x10b;
    // Mature NSIS uses a 32-bit setup stub for its 64-bit product payload.
    // RunningX64 and the admitted payload architecture enforce the target.
    if ((!x64 && !x86) || header.readUInt32LE(24 + (x64 ? 108 : 92)) < 5
      || header.readUInt32LE(24 + (x64 ? 112 : 96) + 4 * 8) !== 0 || header.readUInt32LE(24 + (x64 ? 112 : 96) + 4 * 8 + 4) !== 0) throw new Error('PE');
  } catch { throw new ProductUpdateError('UPDATE_INSTALLER_TRUST_FAILED'); }
  finally { await handle.close(); }
}
