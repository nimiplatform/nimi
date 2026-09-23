import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';

// Known model container formats. The extension moves out of the title and
// into a format chip so the list reads as models, not as a file listing.
const MODEL_FORMAT_BY_EXTENSION: Readonly<Record<string, string>> = {
  gguf: 'GGUF',
  ggml: 'GGML',
  safetensors: 'Safetensors',
  onnx: 'ONNX',
  mlmodel: 'Core ML',
  mlpackage: 'Core ML',
  tflite: 'TFLite',
  pt: 'PyTorch',
  pth: 'PyTorch',
  bin: 'BIN',
};

export function describeModelAssetPresentation(asset: NimiRuntimeModelAssetRecord): {
  readonly title: string;
  readonly format: string | null;
} {
  const rawTitle = asset.displayName || asset.entry || asset.modelAssetId;
  const candidates = [rawTitle, asset.entry, ...asset.files.map((file) => file.relativePath)];
  let format: string | null = null;
  for (const candidate of candidates) {
    const match = /\.([a-z0-9]+)$/iu.exec(candidate ?? '');
    const label = match ? MODEL_FORMAT_BY_EXTENSION[match[1]!.toLowerCase()] : undefined;
    if (label) {
      format = label;
      break;
    }
  }
  const titleMatch = /^(.+)\.([a-z0-9]+)$/iu.exec(rawTitle);
  const title = titleMatch && MODEL_FORMAT_BY_EXTENSION[titleMatch[2]!.toLowerCase()] && titleMatch[1]!.trim()
    ? titleMatch[1]!
    : rawTitle;
  return { title, format };
}
