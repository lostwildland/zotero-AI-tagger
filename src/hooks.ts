import { registerMenu, unregisterMenu } from "./modules/menu";
import { registerPrefs, unregisterPrefs } from "./modules/preferences";

export function onStartup() {
  Zotero.debug("[AI Tagger] Plugin started");
}

export function onMainWindowLoad(win: Window) {
  registerMenu(win);
  registerPrefs();
  Zotero.debug("[AI Tagger] Main window loaded");
}

export function onMainWindowUnload(win: Window) {
  unregisterMenu(win);
  Zotero.debug("[AI Tagger] Main window unloaded");
}

export function onShutdown() {
  unregisterPrefs();
  Zotero.debug("[AI Tagger] Plugin shutdown");
}
