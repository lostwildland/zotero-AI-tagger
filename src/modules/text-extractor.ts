/**
 * Extract full text from a web snapshot (HTML attachment).
 */
function getFullTextFromSnapshot(attachment: Zotero.Item): string | null {
  try {
    if (
      !attachment ||
      (attachment as any).attachmentMIMEType !== "text/html"
    ) {
      return null;
    }

    const filePath = attachment.getFilePath();
    if (!filePath) return null;

    const file = Components.classes[
      "@mozilla.org/file/local;1"
    ].createInstance(Components.interfaces.nsIFile);
    file.initWithPath(filePath);

    if (!file.exists()) return null;

    const inputStream = Components.classes[
      "@mozilla.org/network/file-input-stream;1"
    ].createInstance(Components.interfaces.nsIFileInputStream);
    inputStream.init(file, -1, -1, 0);

    const scriptableStream = Components.classes[
      "@mozilla.org/scriptableinputstream;1"
    ].createInstance(Components.interfaces.nsIScriptableInputStream);
    scriptableStream.init(inputStream);

    let htmlContent = "";
    let available = scriptableStream.available();
    while (available > 0) {
      htmlContent += scriptableStream.read(available);
      available = scriptableStream.available();
    }

    scriptableStream.close();
    inputStream.close();

    // Simple HTML text extraction (remove tags)
    const textContent = htmlContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return textContent;
  } catch (e) {
    Zotero.debug(`[AI Tagger] Snapshot extraction error: ${e}`);
    return null;
  }
}

export interface ExtractionResult {
  text: string;
  source: "pdf" | "snapshot" | "none";
}

/**
 * Extract full text from a Zotero item's attachments.
 * Tries PDF first, falls back to HTML snapshot.
 *
 * @param targetItem - The parent Zotero item
 * @param sourceAttachment - If the trigger was an attachment itself, pass it here
 * @param maxLength - Maximum text length to return
 */
export async function extractFullText(
  targetItem: Zotero.Item,
  sourceAttachment?: Zotero.Item,
  maxLength: number = 12000,
): Promise<ExtractionResult> {
  let fullText = "";
  let source: ExtractionResult["source"] = "none";

  // Collect attachments to process
  let attachmentsToProcess: Zotero.Item[] = [];

  if (sourceAttachment) {
    attachmentsToProcess = [sourceAttachment];
  } else {
    let attachmentIDs = targetItem.getAttachments();

    // Wait up to 10 seconds for attachments to appear (browser import case)
    if (attachmentIDs.length === 0) {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attachmentIDs = targetItem.getAttachments();
        if (attachmentIDs.length > 0) break;
      }
    }

    attachmentsToProcess = attachmentIDs.map((id: number) =>
      Zotero.Items.get(id),
    );
  }

  for (const attachment of attachmentsToProcess) {
    // Try PDF
    if (attachment.isPDFAttachment()) {
      try {
        const filePath = await attachment.getFilePathAsync();
        if (!filePath) continue;

        const file = Components.classes[
          "@mozilla.org/file/local;1"
        ].createInstance(Components.interfaces.nsIFile);
        file.initWithPath(filePath);
        if (!file.exists()) continue;

        const pdfText = await attachment.attachmentText;
        if (pdfText && pdfText.length > 100) {
          fullText = pdfText;
          source = "pdf";
          break;
        }
      } catch (e) {
        Zotero.debug(`[AI Tagger] PDF extraction error: ${e}`);
      }
    }
    // Try HTML snapshot
    else if ((attachment as any).attachmentMIMEType === "text/html") {
      const snapshotText = getFullTextFromSnapshot(attachment);
      if (snapshotText && snapshotText.length > 100) {
        fullText = snapshotText;
        source = "snapshot";
        // Continue looking for PDF (prefer PDF)
      }
    }
  }

  // Truncate if too long
  if (fullText.length > maxLength) {
    fullText = fullText.substring(0, maxLength) + "...[truncated]";
  }

  return { text: fullText, source };
}
