export interface AiSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  configured: boolean;
  environmentOverride: boolean;
}

export interface AiSettingsInput {
  baseUrl: string;
  model: string;
  /** Omit to keep the saved key; an empty string clears it. */
  apiKey?: string;
}

export interface AiSettingsResult {
  ok: boolean;
  settings?: AiSettings;
  error?: string;
}
