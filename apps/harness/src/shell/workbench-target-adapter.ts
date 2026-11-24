import { createDesktopNimiAppSession } from '@nimiplatform/kit/auth/app/desktop';

// One Kit-owned lifetime. Account and operation authority stay in Home/Runtime.
let session: ReturnType<typeof createDesktopNimiAppSession> | null = null;
export function getTargetAppSession() {
  session ??= createDesktopNimiAppSession();
  return session;
}

export function endTargetAppSession(current: ReturnType<typeof createDesktopNimiAppSession>) {
  if (session === current) session = null;
  current.dispose();
}
