import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { parse as parseYaml } from 'yaml';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
export function validateAppIcon(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('App icon must be a PNG of at most 512 KiB');
  }
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length || type === 'acTL') throw new Error('App icon must be a complete static PNG');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error('App icon PNG header is invalid');
    if (type === 'IHDR') {
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width < 128 || width > 1024 || width !== height) throw new Error('App icon must be square, 128–1024 pixels');
    }
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!ended) throw new Error('App icon PNG is truncated or has trailing content');
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  for (let index = 3; index < decoded.data.length; index += 4) {
    if (decoded.data[index] !== 0) return bytes;
  }
  throw new Error('App icon is fully transparent; supply actual App artwork');
}

export function readAppIcon(root, { required = true } = {}) {
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  const relative = manifest?.metadata?.icon;
  if (relative === undefined && !required) return null;
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')
    || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('metadata.icon must name an App-relative resource');
  }
  const file = path.join(root, relative);
  let stat;
  try { stat = lstatSync(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!required) return null;
    throw new Error(`metadata.icon resource is missing: ${relative}`);
  }
  const physicalRelative = path.relative(realpathSync(root), realpathSync(file));
  if (physicalRelative.startsWith(`..${path.sep}`) || physicalRelative === '..' || path.isAbsolute(physicalRelative)
    || !stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) {
    throw new Error('metadata.icon must be a regular PNG inside the App repository, at most 512 KiB');
  }
  return validateAppIcon(readFileSync(file));
}

// Area sampling in premultiplied alpha avoids dark borders around transparent artwork.
function resizedPng(source, size) {
  if (size === source.width) return PNG.sync.write(source);
  const target = new PNG({ width: size, height: size });
  const scale = source.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = Math.floor(y * scale); sy < Math.ceil((y + 1) * scale); sy++) {
        const wy = Math.min(sy + 1, (y + 1) * scale) - Math.max(sy, y * scale);
        for (let sx = Math.floor(x * scale); sx < Math.ceil((x + 1) * scale); sx++) {
          const weight = wy * (Math.min(sx + 1, (x + 1) * scale) - Math.max(sx, x * scale));
          const offset = (sy * source.width + sx) * 4;
          const alpha = source.data[offset + 3] * weight;
          for (let channel = 0; channel < 3; channel++) sum[channel] += source.data[offset + channel] * alpha;
          sum[3] += alpha;
        }
      }
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) target.data[offset + channel] = sum[3] ? Math.round(sum[channel] / sum[3]) : 0;
      target.data[offset + 3] = Math.round(sum[3] / (scale * scale));
    }
  }
  return PNG.sync.write(target);
}

export function encodeWindowsIcon(bytes) {
  const source = PNG.sync.read(validateAppIcon(bytes));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256].filter(size => size <= source.width);
  const images = sizes.map(size => resizedPng(source, size));
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let position = directory.length;
  sizes.forEach((size, index) => {
    const offset = 6 + index * 16;
    directory[offset] = directory[offset + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(images[index].length, offset + 8);
    directory.writeUInt32LE(position, offset + 12);
    position += images[index].length;
  });
  return Buffer.concat([directory, ...images]);
}

export function encodeMacIcon(bytes) {
  const source = PNG.sync.read(validateAppIcon(bytes));
  const chunks = [[128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]
    .filter(([size]) => size <= source.width).map(([size, type]) => {
      const png = resizedPng(source, size);
      const header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([header, png]);
    });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

export function prepareElectronIcons(root, { required = false } = {}) {
  const output = path.join(root, 'dist-electron');
  // Remove only our derived files, including when artwork was removed or became invalid.
  const files = ['app-icon.png', 'app-icon.ico', 'app-icon.icns'];
  for (const file of files) rmSync(path.join(output, file), { force: true });
  const bytes = readAppIcon(root, { required });
  if (!bytes) {
    process.stderr.write('[nimi-app] No App artwork yet: supply metadata.icon for native window and Dock icons. Production packaging requires it.\n');
    return null;
  }
  const ico = encodeWindowsIcon(bytes);
  const icns = encodeMacIcon(bytes);
  mkdirSync(output, { recursive: true });
  for (const [index, content] of [bytes, ico, icns].entries()) writeFileSync(path.join(output, files[index]), content);
  return { png: path.join(output, files[0]), ico: path.join(output, files[1]), icns: path.join(output, files[2]) };
}
