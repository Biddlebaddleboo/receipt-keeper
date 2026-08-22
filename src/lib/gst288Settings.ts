export interface Gst288NameSettings {
  firstName: string;
  lastName: string;
}

export const GST288_SETTINGS_STORAGE_PREFIX = "gst288.settings.v1.";

const DEFAULT_SETTINGS: Gst288NameSettings = { firstName: "", lastName: "" };

export const gst288SettingsStorageKey = (identity: string): string =>
  `${GST288_SETTINGS_STORAGE_PREFIX}${encodeURIComponent(identity)}`;

export const readGst288NameSettings = (
  identity: string,
  storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): Gst288NameSettings => {
  if (!identity || !storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(gst288SettingsStorageKey(identity));
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : "",
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const writeGst288NameSettings = (
  identity: string,
  settings: Gst288NameSettings,
  storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): void => {
  if (!identity || !storage) return;
  try {
    storage.setItem(
      gst288SettingsStorageKey(identity),
      JSON.stringify({ firstName: settings.firstName, lastName: settings.lastName }),
    );
  } catch {
    // Settings persistence is best effort and must never block exporting.
  }
};
