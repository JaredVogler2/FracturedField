declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_ROOM_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
