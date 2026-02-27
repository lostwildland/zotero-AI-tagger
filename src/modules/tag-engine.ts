import { chatCompletionWithFallback, type ResponseFormat } from "./ai-service";
import { extractFullText } from "./text-extractor";
import { getPref } from "./preferences";

export interface TagResult {
  itemID: number;
  title: string;
  suggestedTags: string[];
  appliedTags: string[];
  reasoning: string;
  error?: string;
}

/**
 * Get all available library tags, filtering out excluded prefixes.
 */
async function getAvailableTags(libraryID: number): Promise<string[]> {
  const prefixFilter = (getPref("tagPrefixFilter") as string) || "_";

  let allTagsData: Array<{ tag: string }>;
  try {
    allTagsData = await Zotero.Tags.getAll(libraryID);
  } catch {
    // Fallback: collect tags from all items
    const allItems = await Zotero.Items.getAll(libraryID, true);
    const tagSet = new Set<string>();
    for (const libItem of allItems) {
      if (libItem.isRegularItem()) {
        for (const tag of libItem.getTags()) {
          if (tag.tag) tagSet.add(tag.tag);
        }
      }
    }
    allTagsData = Array.from(tagSet).map((tag) => ({ tag }));
  }

  return allTagsData
    .map((t) => t.tag)
    .filter((name) => name && typeof name === "string")
    .filter((name) => !name.startsWith(prefixFilter))
    .sort();
}

/**
 * Build the prompt for AI tag suggestion.
 */
function buildPrompt(
  metadata: Record<string, string>,
  fullText: string,
  availableTags: string[],
  tagSource: string,
  maxTags: number,
): string {
  let prompt = `Analyze this document and suggest relevant tags.\n\nDOCUMENT:\nTitle: ${metadata.title}\nAuthors: ${metadata.creators}\nType: ${metadata.itemType}\nPublication: ${metadata.publicationTitle}\nDate: ${metadata.date}\nAbstract: ${metadata.abstractNote}\nCurrent Tags: ${metadata.currentTags}\nDOI: ${metadata.doi}\nURL: ${metadata.url}\nExtra: ${metadata.extra}`;

  if (fullText.length > 0) {
    prompt += `\n\nFULL TEXT CONTENT:\n${fullText}`;
  }

  if (tagSource === "existing") {
    prompt += `\n\nAVAILABLE TAGS TO CHOOSE FROM:\n${availableTags.join(", ")}`;
    prompt += `\n\nPlease suggest up to ${maxTags} relevant tags from the available list that would categorize this document well. ${fullText.length > 0 ? "Use both the metadata and full text content to make accurate suggestions." : "Base suggestions on the available metadata."} Only suggest tags that exist in the available list above.`;
  } else {
    if (availableTags.length > 0) {
      prompt += `\n\nEXISTING LIBRARY TAGS (for reference):\n${availableTags.join(", ")}`;
    }
    prompt += `\n\nPlease suggest up to ${maxTags} relevant tags that would categorize this document well. ${fullText.length > 0 ? "Use both the metadata and full text content to make accurate suggestions." : "Base suggestions on the available metadata."} You may suggest existing tags from the list above or create new descriptive tags.`;
  }

  return prompt;
}

/**
 * Build the JSON schema for structured output.
 */
function buildResponseFormat(
  availableTags: string[],
  tagSource: string,
): ResponseFormat {
  const tagItemSchema: Record<string, unknown> =
    tagSource === "existing"
      ? { type: "string", enum: availableTags }
      : { type: "string" };

  return {
    type: "json_schema",
    json_schema: {
      name: "tag_suggestions",
      strict: true,
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            description: "List of suggested tags",
            items: tagItemSchema,
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of why these tags were chosen",
          },
        },
        required: ["tags", "reasoning"],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Extract metadata from a Zotero item.
 */
function getItemMetadata(item: Zotero.Item): Record<string, string> {
  return {
    title: item.getField("title") || "",
    abstractNote: item.getField("abstractNote") || "",
    creators: item
      .getCreators()
      .map((c: { firstName?: string; lastName?: string }) =>
        `${c.firstName || ""} ${c.lastName || ""}`.trim(),
      )
      .join("; "),
    itemType: item.itemType || "",
    publicationTitle: item.getField("publicationTitle") || "",
    date: item.getField("date") || "",
    currentTags: item
      .getTags()
      .map((t: { tag: string }) => t.tag)
      .join(", "),
    doi: item.getField("DOI") || "",
    url: item.getField("url") || "",
    extra: item.getField("extra") || "",
  };
}

/**
 * Run AI tagging on a single Zotero item.
 * Returns the result without applying tags (caller decides based on confirmation mode).
 */
export async function suggestTags(
  item: Zotero.Item,
): Promise<TagResult> {
  const title = item.getField("title") || "(untitled)";

  try {
    // Resolve the target item (if attachment, get parent)
    let targetItem = item;
    let sourceAttachment: Zotero.Item | undefined;

    if (item.isAttachment()) {
      const parentID = item.parentID;
      if (parentID) {
        targetItem = Zotero.Items.get(parentID);
        sourceAttachment = item;
      } else {
        return {
          itemID: item.id,
          title,
          suggestedTags: [],
          appliedTags: [],
          reasoning: "",
          error: "Standalone attachment without parent",
        };
      }
    }

    if (!targetItem.isRegularItem()) {
      return {
        itemID: item.id,
        title,
        suggestedTags: [],
        appliedTags: [],
        reasoning: "",
        error: "Not a regular item",
      };
    }

    // Get preferences
    const tagSource = getPref("tagSource") as string;
    const maxTags = getPref("maxTags") as number;
    const temperature = parseFloat(getPref("temperature") as string);
    const includeFullText = getPref("includeFullText") as boolean;
    const maxFullTextLength = getPref("maxFullTextLength") as number;
    const customPrompt = getPref("systemPrompt") as string;
    const maxTokens = 1000;

    // Get available tags
    const availableTags = await getAvailableTags(targetItem.libraryID);
    if (tagSource === "existing" && availableTags.length === 0) {
      return {
        itemID: targetItem.id,
        title,
        suggestedTags: [],
        appliedTags: [],
        reasoning: "",
        error: "No available tags found in library",
      };
    }

    // Extract full text
    let fullText = "";
    if (includeFullText) {
      const extraction = await extractFullText(
        targetItem,
        sourceAttachment,
        maxFullTextLength,
      );
      fullText = extraction.text;
    }

    // Build prompt and schema
    const metadata = getItemMetadata(targetItem);
    const prompt = buildPrompt(
      metadata,
      fullText,
      availableTags,
      tagSource,
      maxTags,
    );
    const responseFormat = buildResponseFormat(availableTags, tagSource);

    const systemPrompt =
      customPrompt ||
      "You are a research librarian helping categorize academic documents. Suggest only tags that best describe the document's content, methodology, and subject area.";

    // Call AI
    const result = await chatCompletionWithFallback({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat,
    });

    // Parse response
    const content = result.choices[0].message.content;
    const parsed = JSON.parse(content) as {
      tags: string[];
      reasoning: string;
    };

    // Filter: remove duplicates and already-existing tags
    const currentTags = targetItem
      .getTags()
      .map((t: { tag: string }) => t.tag);
    const suggestedTags = [...new Set(parsed.tags)].filter(
      (tag) => !currentTags.includes(tag),
    );

    return {
      itemID: targetItem.id,
      title: targetItem.getField("title") || "(untitled)",
      suggestedTags,
      appliedTags: [],
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      itemID: item.id,
      title,
      suggestedTags: [],
      appliedTags: [],
      reasoning: "",
      error: (error as Error).message,
    };
  }
}

/**
 * Apply tags to a Zotero item and save.
 */
export async function applyTags(
  itemID: number,
  tags: string[],
): Promise<void> {
  const item = Zotero.Items.get(itemID);
  for (const tag of tags) {
    item.addTag(tag);
  }
  if (tags.length > 0) {
    await item.saveTx();
  }
}
