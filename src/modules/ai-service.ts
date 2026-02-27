import { getPref } from "./preferences";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: ResponseFormat;
}

export interface ResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
}

export interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }[];
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Build the API URL based on provider config.
 */
function buildURL(): string {
  const baseURL = getPref("baseURL") as string;
  // Ensure no trailing slash
  const base = baseURL.replace(/\/+$/, "");

  // If user already included /chat/completions, use as-is
  if (base.endsWith("/chat/completions")) {
    return base;
  }

  return `${base}/chat/completions`;
}

/**
 * Build request headers.
 */
function buildHeaders(): Record<string, string> {
  const apiKey = getPref("apiKey") as string;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a chat completion request with retry logic.
 */
export async function chatCompletion(
  request: ChatCompletionRequest,
  options?: { maxRetries?: number; useStructuredOutput?: boolean },
): Promise<ChatCompletionResponse> {
  const maxRetries = options?.maxRetries ?? 3;
  const useStructuredOutput = options?.useStructuredOutput ?? true;

  const model = getPref("model") as string;
  const url = buildURL();
  const headers = buildHeaders();

  // Build request body
  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
  };

  if (useStructuredOutput && request.response_format) {
    body.response_format = request.response_format;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        // Rate limited - extract retry-after if available
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 30000);
        Zotero.debug(
          `[AI Tagger] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`,
        );
        await sleep(waitMs);
        continue;
      }

      if (response.status >= 500 && attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000);
        Zotero.debug(
          `[AI Tagger] Server error (${response.status}), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = (await response.json()) as any;
          errorMessage += ` - ${errorData.error?.message || ""}`;
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
      }

      const result = (await response.json()) as unknown as ChatCompletionResponse;
      return result;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000);
        Zotero.debug(
          `[AI Tagger] Request failed: ${lastError.message}, retrying in ${waitMs}ms (${attempt + 1}/${maxRetries})`,
        );
        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error("Request failed after all retries");
}

/**
 * Fallback: send request without structured output (for providers that don't support it).
 * Adds JSON instruction to the prompt instead.
 */
export async function chatCompletionWithFallback(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  try {
    // First try with structured output
    return await chatCompletion(request, { useStructuredOutput: true });
  } catch (error) {
    const err = error as Error;
    // If structured output is not supported, retry without it
    if (
      err.message.includes("response_format") ||
      err.message.includes("json_schema") ||
      err.message.includes("not supported")
    ) {
      Zotero.debug(
        "[AI Tagger] Structured output not supported, falling back to prompt-based JSON",
      );

      // Add JSON instruction to the last user message
      const modifiedMessages = [...request.messages];
      const lastMsg = modifiedMessages[modifiedMessages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content +=
          "\n\nIMPORTANT: You must respond with ONLY a valid JSON object, no other text. The JSON must have this exact structure: { \"tags\": [\"tag1\", \"tag2\"], \"reasoning\": \"explanation\" }";
      }

      return await chatCompletion(
        { ...request, response_format: undefined },
        { useStructuredOutput: false },
      );
    }
    throw error;
  }
}

/**
 * Test the API connection by sending a minimal request.
 * Returns the model name on success, throws on failure.
 */
export async function testConnection(): Promise<string> {
  const model = getPref("model") as string;
  const url = buildURL();
  const headers = buildHeaders();

  const body = {
    model,
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 5,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage += ` - ${(errorData as any).error?.message || ""}`;
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  const result = (await response.json()) as unknown as ChatCompletionResponse;
  return result.model || model;
}
