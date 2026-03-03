/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LANDING_APP_URL?: string;
  readonly VITE_LANDING_DOCS_URL?: string;
  readonly VITE_LANDING_GITHUB_URL?: string;
  readonly VITE_LANDING_PROTOCOL_URL?: string;
  readonly VITE_LANDING_DEFAULT_LOCALE?: 'en' | 'zh';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
