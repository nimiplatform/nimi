export type VideoFoodMapIntakeTarget =
  | { kind: 'video'; normalizedUrl: string; helperText: string }
  | { kind: 'creator'; normalizedUrl: string; helperText: string }
  | { kind: 'invalid'; normalizedUrl: string; helperText: string };

const VIDEO_HOSTS = new Set([
  'www.bilibili.com',
  'm.bilibili.com',
  'bilibili.com',
  'b23.tv',
  'bili2233.cn',
]);

function normalizeRawInput(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(space\.)?bilibili\.com/i.test(trimmed) || /^(www\.|m\.)?bilibili\.com/i.test(trimmed) || /^(b23\.tv|bili2233\.cn)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!VIDEO_HOSTS.has(host)) {
    return false;
  }
  if (host === 'b23.tv' || host === 'bili2233.cn') {
    return true;
  }
  return /\/video\/(BV|av)/i.test(url.pathname) || /\/video\//i.test(url.pathname);
}

function isCreatorUrl(url: URL): boolean {
  return url.hostname.toLowerCase() === 'space.bilibili.com' && /^\/\d+(\/|$)/.test(url.pathname);
}

export function detectVideoFoodMapIntakeTarget(value: string): VideoFoodMapIntakeTarget {
  const normalizedInput = normalizeRawInput(value);
  if (!normalizedInput) {
    return {
      kind: 'invalid',
      normalizedUrl: '',
      helperText: '贴一个 Bilibili 视频链接或博主主页链接。',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedInput);
  } catch {
    return {
      kind: 'invalid',
      normalizedUrl: normalizedInput,
      helperText: '现在只能识别完整的 Bilibili 视频链接或博主主页链接。',
    };
  }

  if (isVideoUrl(parsedUrl)) {
    return {
      kind: 'video',
      normalizedUrl: parsedUrl.toString(),
      helperText: '识别成视频链接，会直接开始解析店铺信息。',
    };
  }

  if (isCreatorUrl(parsedUrl)) {
    return {
      kind: 'creator',
      normalizedUrl: parsedUrl.toString(),
      helperText: '识别成博主主页，会同步最近发布的视频。',
    };
  }

  return {
    kind: 'invalid',
    normalizedUrl: parsedUrl.toString(),
    helperText: '这个链接现在不支持。只支持 Bilibili 视频页和博主主页。',
  };
}
