// API Configuration
pref("extensions.zotero.ai-tagger.provider", "openai");
pref("extensions.zotero.ai-tagger.baseURL", "https://api.openai.com/v1");
pref("extensions.zotero.ai-tagger.apiKey", "");
pref("extensions.zotero.ai-tagger.model", "gpt-4.1-mini");

// Tagging Behavior
pref("extensions.zotero.ai-tagger.tagSource", "existing");
pref("extensions.zotero.ai-tagger.maxTags", 8);
pref("extensions.zotero.ai-tagger.temperature", "0.1");
pref("extensions.zotero.ai-tagger.includeFullText", true);
pref("extensions.zotero.ai-tagger.maxFullTextLength", 12000);
pref("extensions.zotero.ai-tagger.tagPrefixFilter", "_");
pref("extensions.zotero.ai-tagger.systemPrompt", "You are a research librarian helping categorize academic documents. Suggest only tags that best describe the document's content, methodology, and subject area.");
pref("extensions.zotero.ai-tagger.confirmationMode", false);

// Performance
pref("extensions.zotero.ai-tagger.concurrency", 3);
pref("extensions.zotero.ai-tagger.requestInterval", 1000);
