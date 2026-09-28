import { generateUrlsFromPattern } from './pattern';

export type DiscoveryMode = 'pattern' | 'index' | 'spider';

export interface DiscoveryOptions {
  mode: DiscoveryMode;
  startUrl: string;
  maxPages?: number;
}

export class DiscoveryEngine {
  /**
   * Discovers URLs based on the provided mode and executes a callback for each one.
   */
  async discover(options: DiscoveryOptions, onUrlDiscovered: (url: string) => void) {
    let count = 0;
    
    if (options.mode === 'pattern') {
      const generator = generateUrlsFromPattern(options.startUrl);
      for (const url of generator) {
        if (options.maxPages && count >= options.maxPages) {
          break; // Stop if we hit the limit defined in the job scope
        }
        onUrlDiscovered(url);
        count++;
      }
    } else {
      // We will implement index and spider modes later when we have our HTML fetcher/parser built!
      throw new Error(`Mode '${options.mode}' is not yet implemented for MVP`);
    }
    
    return count; // Return total discovered
  }
}
