/* eslint-disable no-undef */
var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.uiReadyPromise;

  // Load the main script
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/index.js",
    // Pass rootURI in a scope object so the script can access it
  );

  if (typeof Zotero.AiTagger !== "undefined") {
    Zotero.AiTagger.hooks.onStartup();
  }
}

function onMainWindowLoad({ window }) {
  if (typeof Zotero.AiTagger !== "undefined") {
    Zotero.AiTagger.hooks.onMainWindowLoad(window);
  }
}

function onMainWindowUnload({ window }) {
  if (typeof Zotero.AiTagger !== "undefined") {
    Zotero.AiTagger.hooks.onMainWindowUnload(window);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (typeof Zotero.AiTagger !== "undefined") {
    Zotero.AiTagger.hooks.onShutdown();
  }

  // Unregister chrome resource
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }

  // Release all resources
  Zotero.AiTagger = undefined;
}

function uninstall(data, reason) {}
