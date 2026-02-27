/**
 * AI Tag Suggester for Zotero
 * @author Joshua McDonald
 * @usage Suggests and applies tags to selected item using Azure OpenAI based on existing library tags
 */

/************* Configurations Start *************/
// Azure OpenAI Configuration
let azureEndpoint = "https://YOUR-RESOURCE-NAME.openai.azure.com";
let apiKey = "YOUR-AZURE-OPENAI-API-KEY-HERE";
let deploymentName = "gpt-4.1-mini"; // e.g., "gpt-4", "gpt-35-turbo"
let apiVersion = "2024-12-01-preview";

// Full text settings
// For academic papers (arXiv, journal articles), we want enough context to understand
// the paper's content, methodology, and conclusions. This is approximately:
// - Introduction: ~800 chars
// - Abstract/Summary: ~1000 chars
// - Key sections: ~4000 chars
// - Conclusion: ~800 chars
// Total: ~6600 chars, rounded up to 12000 for safety margin
// Note: ~12000 chars ≈ 3000 tokens for GPT-4, leaving ~5000 tokens for metadata and response
let maxFullTextLength = 12000;
let includeFullText = true; // Set to false to use metadata-only
let aiTemperature = 0.1; // Temperature: 0.1 - Low for consistent, deterministic tag selection
let aiMaxTokens = 1000; // Conservative estimate for structured JSON response
/************* Configurations End *************/

if (!item) return;

// Helper function to get full text from web snapshot
function getFullTextFromSnapshot(attachment) {
    try {
        if (!attachment || attachment.attachmentMIMEType !== 'text/html') return null;
        
        const filePath = attachment.getFilePath();
        if (!filePath) return null;
        
        // Read HTML file
        const file = Components.classes["@mozilla.org/file/local;1"]
                              .createInstance(Components.interfaces.nsIFile);
        file.initWithPath(filePath);
        
        if (!file.exists()) return null;
        
        const inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                     .createInstance(Components.interfaces.nsIFileInputStream);
        inputStream.init(file, -1, -1, 0);
        
        const scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                                          .createInstance(Components.interfaces.nsIScriptableInputStream);
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
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')   // Remove styles
            .replace(/<[^>]*>/g, ' ')                          // Remove HTML tags
            .replace(/\s+/g, ' ')                              // Normalize whitespace
            .trim();
        
        return textContent;
    } catch (e) {
        return null;
    }
}

let progressWindow = undefined;
let itemProgress = undefined;

try {
    // Check if this is an attachment itself or a regular item
    const isAttachment = item.isAttachment();
    const isRegular = item.isRegularItem() && item.isTopLevelItem();
    
    if (!isRegular && !isAttachment) {
        return;
    }
    
    // If this is an attachment, get the parent item
    let targetItem = item;
    if (isAttachment) {
        const parentID = item.parentID;
        if (parentID) {
            targetItem = Zotero.Items.get(parentID);
        } else {
            // Standalone attachment without parent - can't tag properly
            return;
        }
    }
    
    // Now use targetItem for everything
    const shortTitle = targetItem.getField('title').length > 50 ? 
        targetItem.getField('title').substring(0, 50) + "..." : 
        targetItem.getField('title');
    
    progressWindow = new Zotero.ProgressWindow({
        "closeOnClick": true,
    });
    progressWindow.addDescription(shortTitle);
    itemProgress = new progressWindow.ItemProgress();
    itemProgress.setText("Getting tags...");
    progressWindow.show();

    // Get all library tags (excluding those starting with '_')
    const libraryID = targetItem.libraryID;
    
    // Get tags using the correct API
    let allTagsData;
    try {
        allTagsData = await Zotero.Tags.getAll(libraryID);
    } catch (e) {
        // Fallback: get tags from all items in the library
        const allItems = await Zotero.Items.getAll(libraryID, true);
        const tagSet = new Set();
        
        for (const libItem of allItems) {
            if (libItem.isRegularItem()) {
                const itemTags = libItem.getTags();
                for (const tag of itemTags) {
                    if (tag.tag) {
                        tagSet.add(tag.tag);
                    }
                }
            }
        }
        allTagsData = Array.from(tagSet).map(tag => ({ tag }));
    }
    
    const availableTags = allTagsData
        .map(tagObj => tagObj.tag)
        .filter(tagName => tagName && typeof tagName === 'string') // Filter out undefined/null tags
        .filter(tagName => !tagName.startsWith('_'))
        .sort();

    if (availableTags.length === 0) {
        throw new Error(`No available tags found in library. Library ID: ${libraryID}, Total tags found: ${allTagsData.length}`);
    }

    itemProgress.setProgress(30);
    itemProgress.setText("Extracting text...");

    // Get full text from attachments
    let fullText = "";
    if (includeFullText) {
        // Collect attachments - either from the item or use the item itself if it's an attachment
        let attachmentsToProcess = [];
        
        if (isAttachment) {
            attachmentsToProcess = [item];
        } else {
            let attachmentIDs = targetItem.getAttachments();
            
            // If no attachments and this looks like a browser import, wait a bit for attachment to be created
            if (attachmentIDs.length === 0) {
                itemProgress.setText("⏳ Waiting for PDF...");
                
                // Wait up to 10 seconds for attachments to appear
                for (let i = 0; i < 10; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attachmentIDs = targetItem.getAttachments();
                    if (attachmentIDs.length > 0) {
                        itemProgress.setText(`✅ Found ${attachmentIDs.length} file(s)`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        break;
                    }
                }
                
                if (attachmentIDs.length === 0) {
                    itemProgress.setText("⚠️ No files found");
                }
            }
            
            attachmentsToProcess = attachmentIDs.map(id => Zotero.Items.get(id));
        }
        
        for (const attachment of attachmentsToProcess) {
            if (attachment.isPDFAttachment()) {
                itemProgress.setText("📄 Processing PDF...");
                
                try {
                    // First check if the file exists locally
                    const filePath = await attachment.getFilePathAsync();
                    
                    if (!filePath) {
                        itemProgress.setText("⚠️ PDF not local");
                        continue;
                    }
                    
                    // Check if the file actually exists on disk
                    const file = Components.classes["@mozilla.org/file/local;1"]
                                          .createInstance(Components.interfaces.nsIFile);
                    file.initWithPath(filePath);
                    
                    if (!file.exists()) {
                        itemProgress.setText("⚠️ PDF not on disk");
                        continue;
                    }
                    
                    itemProgress.setText("📄 Extracting...");
                    
                    // Use Zotero's built-in text extraction
                    const pdfText = await attachment.attachmentText;
                    
                    if (pdfText && pdfText.length > 100) {
                        fullText = pdfText;
                        itemProgress.setText("✅ Text extracted");
                        await new Promise(resolve => setTimeout(resolve, 500));
                        break; // Use first available PDF text
                    } else {
                        itemProgress.setText("⚠️ Text too short");
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (e) {
                    itemProgress.setText("⚠️ Extraction failed");
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } else if (attachment.attachmentMIMEType === 'text/html') {
                // Try to get text from web snapshot
                const snapshotText = getFullTextFromSnapshot(attachment);
                if (snapshotText && snapshotText.length > 100) {
                    fullText = snapshotText;
                    itemProgress.setText("✅ Snapshot extracted");
                    await new Promise(resolve => setTimeout(resolve, 500));
                    // Continue looking for PDF text (prefer PDF over snapshot)
                }
            }
        }
        
        // Truncate if too long
        if (fullText.length > maxFullTextLength) {
            fullText = fullText.substring(0, maxFullTextLength) + "...[truncated]";
        }
    }

    itemProgress.setProgress(50);
    itemProgress.setText("Analyzing with AI...");

    // Prepare item metadata (use targetItem, not item)
    const title = targetItem.getField('title') || '';
    const abstractNote = targetItem.getField('abstractNote') || '';
    const creators = targetItem.getCreators().map(creator => 
        (creator.firstName + ' ' + creator.lastName).trim()
    ).join('; ');
    const itemType = targetItem.itemType || '';
    const publicationTitle = targetItem.getField('publicationTitle') || '';
    const date = targetItem.getField('date') || '';
    const currentTags = targetItem.getTags().map(tag => tag.tag);
    const url = targetItem.getField('url') || '';
    const doi = targetItem.getField('DOI') || '';
    const extra = targetItem.getField('extra') || '';

    // Create prompt for AI
    let prompt = `Analyze this document and suggest relevant tags from the available list.

DOCUMENT:
Title: ${title}
Authors: ${creators}
Type: ${itemType}
Publication: ${publicationTitle}
Date: ${date}
Abstract: ${abstractNote}
Current Tags: ${currentTags.join(', ')}
DOI: ${doi}
URL: ${url}
Extra: ${extra}`;

    // Add full text if available
    if (fullText.length > 0) {
        prompt += `

FULL TEXT CONTENT:
${fullText}`;
    }

    prompt += `

AVAILABLE TAGS TO CHOOSE FROM:
${availableTags.join(', ')}

Please suggest up to 8 relevant tags from the available list that would categorize this document well. ${fullText.length > 0 ? 'Use both the metadata and full text content to make accurate suggestions.' : 'Base suggestions on the available metadata.'} Only suggest tags that exist in the available list above.`;

    // Define the JSON schema for structured output with enum constraint
    const responseFormat = {
        type: "json_schema",
        json_schema: {
            name: "tag_suggestions",
            strict: true,
            schema: {
                type: "object",
                properties: {
                    tags: {
                        type: "array",
                        description: "List of suggested tags from the available tags list",
                        items: {
                            type: "string",
                            enum: availableTags
                        }
                    },
                    reasoning: {
                        type: "string",
                        description: "Brief explanation of why these tags were chosen"
                    }
                },
                required: ["tags", "reasoning"],
                additionalProperties: false
            }
        }
    };

    // Call Azure OpenAI with structured outputs
    const response = await fetch(
        `${azureEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "system",
                        content: "You are a research librarian helping categorize academic documents. Suggest only tags that exist in the provided available tags list."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: responseFormat,
                max_tokens: aiMaxTokens,
                temperature: aiTemperature
            })
        }
    );

    if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
            const errorData = await response.json();
            errorMessage += ` - ${errorData.error?.message || errorData.detail || ''}`;
        } catch (e) {}
        throw new Error(`Azure OpenAI API error: ${errorMessage}`);
    }

    const result = await response.json();
    const aiResponseContent = result.choices[0].message.content;
    
    // Parse the structured JSON response
    const aiResponse = JSON.parse(aiResponseContent);

    itemProgress.setProgress(90);
    itemProgress.setText("Applying tags...");

    // Extract tags from structured response
    // No need to validate against availableTags since enum ensures only valid tags are returned
    const suggestedTags = aiResponse.tags
        .filter(tag => !currentTags.includes(tag)); // Don't add existing tags

    // Remove duplicates (though enum should prevent this)
    const uniqueSuggestedTags = [...new Set(suggestedTags)];

    // Apply tags to item (use targetItem, not item)
    let appliedCount = 0;
    for (const tagName of uniqueSuggestedTags) {
        targetItem.addTag(tagName);
        appliedCount++;
    }

    if (appliedCount > 0) {
        await targetItem.saveTx();
    }

    itemProgress.setProgress(100);
    if (appliedCount > 0) {
        // Add each tag as a separate description line to ensure the window grows
        for (const tag of uniqueSuggestedTags) {
            progressWindow.addDescription(`• ${tag}`);
        }
        itemProgress.setText(`✅ Added ${appliedCount} tag(s)`);
    } else {
        itemProgress.setText("No new tags found");
    }
    progressWindow.startCloseTimer(5000, true); // true enables manual close button

} catch (error) {
    if (itemProgress) {
        itemProgress.setError();
        itemProgress.setText(`Error: ${error.message}`);
        progressWindow.startCloseTimer(8000, true); // true enables manual close button
    } else {
        Zotero.alert(null, "AI Tag Suggester Error", error.message);
    }
}