import { useLabRendererHost } from '../renderer/context.js';
import { KitRecipesGallery } from '../product-modules/kit-recipes/gallery.js';

export function KitComponentGallery(_props: { onOpenSection?: (target: string) => void }) {
  const rendererHost = useLabRendererHost();
  return (
    <KitRecipesGallery
      copyText={(value) => rendererHost.app.commands.copyText(value)}
      exampleAppId="nimi.lab"
      testId="nimi-lab-ui-recipes"
    />
  );
}
