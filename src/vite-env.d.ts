/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TELNYX_LOGIN: string;
  readonly VITE_TELNYX_PASSWORD: string;
  readonly VITE_TELNYX_DESTINATION: string;
  readonly VITE_TELNYX_CALLER_NUMBER?: string;
  readonly VITE_APPLICATIONINSIGHTS_CONNECTION_STRING?: string;
  readonly [key: string]: string | undefined;
}
