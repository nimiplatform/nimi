import type { Writable } from 'node:stream';

// Diagnostic output can lose its reader when the launching terminal closes.
// Keep that stream failure out of IPC, Runtime recovery, and quit cleanup.
export function createDesktopStderrWriter(stream: Writable): (line: string) => void {
  let unavailable = false;
  stream.on('error', () => {
    unavailable = true;
  });

  return (line) => {
    if (unavailable || stream.destroyed || stream.writableEnded || !stream.writable) return;
    try {
      stream.write(line);
    } catch {
      unavailable = true;
    }
  };
}

export const writeDesktopStderr = createDesktopStderrWriter(process.stderr);
