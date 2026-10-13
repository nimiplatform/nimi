import type { appPreviewMessagesZh } from '../content/app-preview-messages.zh.js';

export type PreviewMessageKey = keyof typeof appPreviewMessagesZh;
export type PreviewMessages = Readonly<Record<PreviewMessageKey, string>>;
export type PreviewTranslate = (
  key: PreviewMessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

/** Explicit semantic keys only. Supplied values, including visitor text, stay verbatim. */
export function createPreviewTranslate(messages: PreviewMessages): PreviewTranslate {
  return (key, values) => {
    const message = messages[key];
    if (!Object.hasOwn(messages, key)) throw new Error(`Missing App preview message: ${key}`);
    if (!values) return message;
    return message.replace(/\{([a-zA-Z]\w*)\}/gu, (_, name: string) => {
      if (!Object.hasOwn(values, name))
        throw new Error(`Missing App preview parameter: ${key}.${name}`);
      return String(values[name]);
    });
  };
}

export class PreviewMessageError extends Error {
  constructor(readonly key: PreviewMessageKey) {
    super(key);
    this.name = 'PreviewMessageError';
  }
}
