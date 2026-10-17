export interface SettingsFormState {
  dirty: boolean;
  busy: boolean;
  save: () => Promise<boolean>;
}
export type SettingsFormListener = (state: SettingsFormState) => void;
