// Overtone Tauri OAuth bridge.
//
// Uses the kit's `createTauriOAuthBridge` factory verbatim so the kit's
// `<DesktopShellAuthPage>` desktop-browser flow can drive the Overtone
// login: runtime BeginLogin returns the realm OAuth authorize URL, the kit
// opens the system browser, listens on the loopback redirect_uri for the
// raw OAuth `code`, and the runtime broker exchanges it. Overtone never
// observes any access or refresh token.
//
// The previous hand-rolled wrapper passed `tokenUrl`, `clientSecret`, and
// `extra` fields that do not exist on the kit's `OauthTokenExchangePayload`
// — this caused 3 TS errors and was a holdover from an older kit shape.
// The factory below subsumes that surface with the current type.
import { createTauriOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';

export const overtoneTauriOAuthBridge = createTauriOAuthBridge();
