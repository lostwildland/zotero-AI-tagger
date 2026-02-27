import { processBatch, type BatchProgress } from "./batch-processor";
import { suggestTags, applyTags, type TagResult } from "./tag-engine";
import { getPref } from "./preferences";

const MENU_ID = "ai-tagger-generate-tags";
const MENU_COLLECTION_ID = "ai-tagger-generate-tags-collection";

/**
 * Show a tag confirmation dialog.
 * Returns the selected tags, or null if cancelled.
 */
async function showConfirmationDialog(
  result: TagResult,
): Promise<string[] | null> {
  const win = Zotero.getMainWindow();
  if (!win) return null;

  // Build a simple checkbox dialog using Zotero's prompt service
  const shortTitle =
    result.title.length > 60
      ? result.title.substring(0, 60) + "…"
      : result.title;

  const promptText = `AI suggests these tags for "${shortTitle}":\n\n${result.suggestedTags.map((t) => `• ${t}`).join("\n")}\n\nReasoning: ${result.reasoning}\n\nApply all tags?`;

  const ps = Components.classes[
    "@mozilla.org/embedcomp/prompt-service;1"
  ].getService(Components.interfaces.nsIPromptService);

  // Simple confirm dialog: Apply All / Cancel
  // For a more granular per-tag selection, a custom XUL dialog would be needed
  const confirmed = ps.confirm(win, "AI Tagger - Confirm Tags", promptText);

  return confirmed ? result.suggestedTags : null;
}

/**
 * Handle tagging for selected items (single or batch).
 */
async function handleTagSelected(win: Window): Promise<void> {
  const zoteroPane = win.ZoteroPane;
  if (!zoteroPane) return;

  const items = zoteroPane.getSelectedItems();
  if (!items || items.length === 0) {
    Zotero.alert(win, "AI Tagger", "No items selected.");
    return;
  }

  // Filter to regular items and attachments with parents
  const validItems = items.filter(
    (item: Zotero.Item) =>
      item.isRegularItem() ||
      (item.isAttachment() && item.parentID),
  );

  if (validItems.length === 0) {
    Zotero.alert(win, "AI Tagger", "No taggable items selected.");
    return;
  }

  const confirmationMode = getPref("confirmationMode") as boolean;

  if (validItems.length === 1) {
    // Single item mode
    await handleSingleItem(win, validItems[0], confirmationMode);
  } else {
    // Batch mode
    await handleBatchItems(win, validItems, confirmationMode);
  }
}

/**
 * Handle single item tagging with progress window.
 */
async function handleSingleItem(
  win: Window,
  item: Zotero.Item,
  confirmationMode: boolean,
): Promise<void> {
  const shortTitle =
    (item.getField("title") || "").length > 50
      ? item.getField("title").substring(0, 50) + "…"
      : item.getField("title") || "(untitled)";

  const progressWindow = new Zotero.ProgressWindow({ closeOnClick: true });
  progressWindow.addDescription(shortTitle);
  const itemProgress = new progressWindow.ItemProgress("", "");
  itemProgress.setText("Analyzing with AI…");
  progressWindow.show();

  try {
    itemProgress.setProgress(30);
    const result = await suggestTags(item);

    if (result.error) {
      itemProgress.setError();
      itemProgress.setText(`Error: ${result.error}`);
      progressWindow.startCloseTimer(8000, true);
      return;
    }

    if (result.suggestedTags.length === 0) {
      itemProgress.setProgress(100);
      itemProgress.setText("No new tags found");
      progressWindow.startCloseTimer(5000, true);
      return;
    }

    itemProgress.setProgress(70);

    // Confirmation mode
    let tagsToApply = result.suggestedTags;
    if (confirmationMode) {
      itemProgress.setText("Waiting for confirmation…");
      const confirmed = await showConfirmationDialog(result);
      if (!confirmed) {
        itemProgress.setText("Cancelled by user");
        progressWindow.startCloseTimer(3000, true);
        return;
      }
      tagsToApply = confirmed;
    }

    // Apply tags
    itemProgress.setProgress(90);
    itemProgress.setText("Applying tags…");
    await applyTags(result.itemID, tagsToApply);

    itemProgress.setProgress(100);
    for (const tag of tagsToApply) {
      progressWindow.addDescription(`• ${tag}`);
    }
    itemProgress.setText(`✅ Added ${tagsToApply.length} tag(s)`);
    progressWindow.startCloseTimer(5000, true);
  } catch (error) {
    itemProgress.setError();
    itemProgress.setText(`Error: ${(error as Error).message}`);
    progressWindow.startCloseTimer(8000, true);
  }
}

/**
 * Handle batch item tagging with progress dialog.
 */
async function handleBatchItems(
  win: Window,
  items: Zotero.Item[],
  confirmationMode: boolean,
): Promise<void> {
  const progressWindow = new Zotero.ProgressWindow({ closeOnClick: false });
  progressWindow.addDescription(
    `AI Tagger: Processing ${items.length} items…`,
  );
  const itemProgress = new progressWindow.ItemProgress("", "");
  itemProgress.setText(`0 / ${items.length}`);
  progressWindow.show();

  const confirmFn = confirmationMode ? showConfirmationDialog : null;

  const { cancel, promise } = processBatch(
    items,
    (progress: BatchProgress) => {
      const pct = Math.round((progress.current / progress.total) * 100);
      itemProgress.setProgress(pct);
      itemProgress.setText(`${progress.current} / ${progress.total}`);
    },
    confirmFn,
  );

  // Store cancel function so it could be called from UI
  // For now, the progress window's close will cancel
  progressWindow.addDescription("Close this window to cancel.");

  try {
    const result = await promise;

    const totalTags = result.results.reduce(
      (sum, r) => sum + r.appliedTags.length,
      0,
    );
    const errors = result.results.filter((r) => r.error).length;

    itemProgress.setProgress(100);

    let summary = `✅ Done: ${totalTags} tags added across ${result.current} items`;
    if (errors > 0) {
      summary += ` (${errors} errors)`;
    }
    if (result.cancelled) {
      summary = `⚠️ Cancelled: processed ${result.current} of ${result.total}`;
    }

    itemProgress.setText(summary);
    progressWindow.startCloseTimer(8000, true);
  } catch (error) {
    itemProgress.setError();
    itemProgress.setText(`Error: ${(error as Error).message}`);
    progressWindow.startCloseTimer(8000, true);
  }
}

/**
 * Handle tagging for an entire collection.
 */
async function handleTagCollection(win: Window): Promise<void> {
  const zoteroPane = win.ZoteroPane;
  if (!zoteroPane) return;

  const collection = zoteroPane.getSelectedCollection();
  if (!collection) {
    Zotero.alert(win, "AI Tagger", "No collection selected.");
    return;
  }

  const items = collection.getChildItems();
  const regularItems = items.filter((item: Zotero.Item) =>
    item.isRegularItem(),
  );

  if (regularItems.length === 0) {
    Zotero.alert(
      win,
      "AI Tagger",
      "No regular items found in this collection.",
    );
    return;
  }

  // Confirm before processing entire collection
  const ps = Components.classes[
    "@mozilla.org/embedcomp/prompt-service;1"
  ].getService(Components.interfaces.nsIPromptService);

  const confirmed = ps.confirm(
    win,
    "AI Tagger",
    `Generate AI tags for ${regularItems.length} items in "${collection.name}"?\n\nThis may take a while and use API credits.`,
  );

  if (!confirmed) return;

  const confirmationMode = getPref("confirmationMode") as boolean;
  await handleBatchItems(win, regularItems, confirmationMode);
}

/**
 * Register context menu items and toolbar button.
 */
export function registerMenu(win: Window): void {
  const doc = win.document;

  // --- Item context menu ---
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu) {
    const sep = doc.createXULElement("menuseparator");
    sep.id = MENU_ID + "-sep";
    itemMenu.appendChild(sep);

    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = MENU_ID;
    menuItem.setAttribute("data-l10n-id", "menuitem-generate-tags");
    menuItem.setAttribute("label", "Generate AI Tags");
    menuItem.addEventListener("command", () => handleTagSelected(win));
    itemMenu.appendChild(menuItem);
  }

  // --- Collection context menu ---
  const collectionMenu = doc.getElementById(
    "zotero-collectionmenu",
  );
  if (collectionMenu) {
    const sep = doc.createXULElement("menuseparator");
    sep.id = MENU_COLLECTION_ID + "-sep";
    collectionMenu.appendChild(sep);

    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = MENU_COLLECTION_ID;
    menuItem.setAttribute(
      "data-l10n-id",
      "menuitem-generate-tags-collection",
    );
    menuItem.setAttribute("label", "AI Tag Entire Collection");
    menuItem.addEventListener("command", () =>
      handleTagCollection(win),
    );
    collectionMenu.appendChild(menuItem);
  }

  Zotero.debug("[AI Tagger] Menus registered");
}

/**
 * Unregister context menu items.
 */
export function unregisterMenu(win: Window): void {
  const doc = win.document;

  for (const id of [
    MENU_ID,
    MENU_ID + "-sep",
    MENU_COLLECTION_ID,
    MENU_COLLECTION_ID + "-sep",
  ]) {
    const el = doc.getElementById(id);
    if (el) el.remove();
  }

  Zotero.debug("[AI Tagger] Menus unregistered");
}
