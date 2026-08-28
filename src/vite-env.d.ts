/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORTYGUARD_OPTIONAL_EVIDENCE?: string;
  readonly VITE_FORTYGUARD_PAID_ANALYSIS?: string;
}

interface ImportMetaEnv {
  readonly VITE_MOCK_MODE?: string;
  readonly VITE_SITEMORPH_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
