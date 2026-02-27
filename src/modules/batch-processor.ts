import { suggestTags, applyTags, type TagResult } from "./tag-engine";
import { getPref } from "./preferences";

export interface BatchProgress {
  total: number;
  current: number;
  results: TagResult[];
  cancelled: boolean;
}

export type ProgressCallback = (progress: BatchProgress) => void;

/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process multiple Zotero items concurrently with AI tagging.
 *
 * @param items - Array of Zotero items to tag
 * @param onProgress - Callback for progress updates
 * @param confirmFn - Optional function to let user confirm/select tags per item.
 *                    If provided, it receives the TagResult and returns the tags to apply.
 *                    If null, tags are applied automatically.
 * @returns Object with cancel() method and promise for final results
 */
export function processBatch(
  items: Zotero.Item[],
  onProgress: ProgressCallback,
  confirmFn?: ((result: TagResult) => Promise<string[] | null>) | null,
): { cancel: () => void; promise: Promise<BatchProgress> } {
  const concurrency = (getPref("concurrency") as number) || 3;
  const interval = (getPref("requestInterval") as number) || 1000;

  const semaphore = new Semaphore(concurrency);
  let cancelled = false;
  let requestCount = 0;

  const progress: BatchProgress = {
    total: items.length,
    current: 0,
    results: [],
    cancelled: false,
  };

  const cancel = () => {
    cancelled = true;
    progress.cancelled = true;
  };

  const promise = (async (): Promise<BatchProgress> => {
    const processItem = async (item: Zotero.Item) => {
      if (cancelled) return;

      await semaphore.acquire();
      try {
        if (cancelled) return;

        // Rate-limit: wait between requests
        if (requestCount > 0 && interval > 0) {
          await sleep(interval);
        }
        requestCount++;

        if (cancelled) return;

        // Get tag suggestions
        const result = await suggestTags(item);

        if (cancelled) return;

        // Apply tags (with optional confirmation)
        if (!result.error && result.suggestedTags.length > 0) {
          let tagsToApply: string[] | null = result.suggestedTags;

          if (confirmFn) {
            tagsToApply = await confirmFn(result);
          }

          if (tagsToApply && tagsToApply.length > 0) {
            await applyTags(result.itemID, tagsToApply);
            result.appliedTags = tagsToApply;
          }
        }

        progress.results.push(result);
      } finally {
        semaphore.release();
        progress.current++;
        onProgress({ ...progress });
      }
    };

    // Process all items concurrently (semaphore controls parallelism)
    await Promise.all(items.map((item) => processItem(item)));

    return progress;
  })();

  return { cancel, promise };
}
