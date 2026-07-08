import { invokeChecked } from './invoke';

export async function setDesktopOpenIntentReady(ready: boolean): Promise<void> {
  await invokeChecked('desktop_open_intent_set_ready', { ready }, () => undefined);
}
