/** Shared navigation for the independent settings window. */
export const SETTINGS_SECTIONS = [
  "general",
  "browser",
  "ai",
  "agent",
  "voice",
  "privacy",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export function settingsSection(value: unknown): SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection)
    ? (value as SettingsSection)
    : "general";
}
