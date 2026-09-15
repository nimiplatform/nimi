import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

export const rgbaPng = await readFile(new URL('../fixtures/basic-character/pixel.png', import.meta.url));

// Deliberately incomplete character data, never a successful admission fixture.
export async function unverifiedCharacterPackage() {
  return YAML.parse(await readFile(new URL('./fixtures/unverified-character-package.yaml', import.meta.url), 'utf8'));
}

// Wardrobe assets exercise independent byte, geometry and mask checks.
// This package is still unadmitted: absent mandatory channels are not proven.
export async function wardrobePackage() {
  const value = await unverifiedCharacterPackage();
  value.package_kind = 'wardrobe_asset_package';
  value.base_body = null;
  value.wardrobe.default_outfit_ref = null;
  value.wardrobe.assets[0].wardrobe_kind = 'outfit';
  value.assets = value.assets.filter((asset) => asset.asset_kind === 'wardrobe_layer');
  value.render_layers = value.render_layers.filter((layer) => layer.layer_kind === 'wardrobe_layer');
  value.render_layers[0].draw_order_index = 0;
  value.integrity.asset_count = value.assets.length;
  return value;
}
