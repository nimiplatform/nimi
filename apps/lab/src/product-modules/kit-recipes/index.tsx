import { KitRecipesGallery } from './gallery.js';

async function copyText(value: string): Promise<void> {
  if (!globalThis.navigator?.clipboard?.writeText) {
    throw new Error('Clipboard write is unavailable.');
  }
  await globalThis.navigator.clipboard.writeText(value);
}

export function KitRecipesCapability({
  exampleAppId = 'example.app',
}: {
  readonly exampleAppId?: string;
}) {
  return <KitRecipesGallery copyText={copyText} exampleAppId={exampleAppId} />;
}

export { KitRecipesGallery } from './gallery.js';
export type { KitRecipesCopyText } from './gallery.js';
