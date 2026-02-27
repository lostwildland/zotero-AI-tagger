# Zotero AI Tagger

AI-powered tag suggestions for [Zotero](https://www.zotero.org/) using OpenAI-compatible APIs.

The plugin analyzes your documents' metadata and full text, then suggests relevant tags from your existing library — or lets the AI create new ones.

## Features

- **OpenAI-compatible**: Works with OpenAI, DeepSeek, Ollama, and any OpenAI-compatible API
- **Smart tagging**: Uses document metadata + full text (PDF/HTML) for accurate suggestions
- **Existing tags or new**: Choose between library-only tags or allow AI to create new ones
- **Batch processing**: Tag multiple items or entire collections at once
- **Concurrency control**: Configurable parallel requests with rate-limit awareness
- **Confirmation mode**: Optionally review AI suggestions before applying
- **Custom prompts**: Override the system prompt for specialized tagging strategies
- **Localization**: English and Chinese interface

## Installation

1. Download the latest `.xpi` from [Releases](../../releases)
2. In Zotero, go to **Tools → Add-ons**
3. Drag the `.xpi` file onto the Add-ons window

**Requires Zotero 7.**

## Configuration

Go to **Zotero → Settings → AI Tagger** to configure:

### API Configuration
- **Provider**: OpenAI or Custom (any OpenAI-compatible endpoint)
- **Base URL**: API endpoint (auto-filled for OpenAI)
- **API Key**: Your API key
- **Model**: Model name (e.g., `gpt-4.1-mini`, `deepseek-chat`)
- **Test Connection**: Verify your settings work

### Tagging Behavior
- **Tag Source**: Only existing library tags, or allow AI to create new tags
- **Max tags per item**: Default 8
- **Temperature**: Lower = more consistent (default 0.1)
- **Include full text**: Extract PDF/snapshot text for better accuracy
- **Custom system prompt**: Override the AI's role instruction
- **Confirmation mode**: Review tags before applying

### Performance
- **Concurrent requests**: How many items to process in parallel (default 3)
- **Request interval**: Delay between requests in ms (default 1000)

## Usage

### Single/Multiple Items
1. Select one or more items in Zotero
2. Right-click → **Generate AI Tags**

### Entire Collection
1. Right-click a collection → **AI Tag Entire Collection**
2. Confirm the operation

## Building from Source

```bash
git clone https://github.com/lostwildland/zotero-AI-tagger.git
cd zotero-ai-tagger
npm install
npm run build
```

The `.xpi` file will be in the `.scaffold/build/` directory.

## Development

```bash
npm start  # Watch mode with hot reload
```

## License

AGPL-3.0-or-later
