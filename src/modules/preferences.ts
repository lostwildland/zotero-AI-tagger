import { testConnection as testAIConnection } from "./ai-service";

const PREF_PREFIX = "extensions.zotero.ai-tagger.";

/**
 * Get a preference value.
 */
export function getPref(key: string): string | number | boolean {
  const fullKey = PREF_PREFIX + key;
  const type = Zotero.Prefs.get(fullKey);
  return type as string | number | boolean;
}

/**
 * Set a preference value.
 */
export function setPref(
  key: string,
  value: string | number | boolean,
): void {
  const fullKey = PREF_PREFIX + key;
  Zotero.Prefs.set(fullKey, value);
}

/**
 * Register the preference pane.
 */
export function registerPrefs(): void {
  Zotero.PreferencePanes.register({
    pluginID: "zotero-ai-tagger@github.com",
    src: rootURI + "content/preferences.xhtml",
    label: "AI Tagger",
    image: rootURI + "content/icons/favicon.png",
  });
}

/**
 * Unregister preference resources.
 */
export function unregisterPrefs(): void {
  // Nothing to clean up currently
}

/**
 * Called when provider dropdown changes in preferences UI.
 */
export function onProviderChange(provider: string): void {
  if (provider === "openai") {
    setPref("baseURL", "https://api.openai.com/v1");
  }
  // For "custom", user fills in their own baseURL
}

/**
 * Test the API connection from the preferences panel.
 */
export async function testConnection(): Promise<void> {
  const doc = Zotero.getMainWindow()?.document;
  if (!doc) return;

  const resultLabel = doc.getElementById("pref-test-result");
  if (resultLabel) {
    resultLabel.setAttribute("value", "Testing…");
    resultLabel.style.color = "";
  }

  try {
    const model = await testAIConnection();
    if (resultLabel) {
      resultLabel.setAttribute("value", `✅ Connected! Model: ${model}`);
      resultLabel.style.color = "green";
    }
  } catch (error) {
    const msg = (error as Error).message;
    if (resultLabel) {
      resultLabel.setAttribute("value", `❌ Failed: ${msg}`);
      resultLabel.style.color = "red";
    }
  }
}
