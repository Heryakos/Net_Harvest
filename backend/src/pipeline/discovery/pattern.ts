/**
 * Expands a pattern like "http://example.com/page{001-100}.xhtml"
 * into a sequence of URLs, yielding them one by one.
 */
export function* generateUrlsFromPattern(urlPattern: string): Generator<string> {
  // Look for a pattern like {001-100}
  const match = urlPattern.match(/\{(\d+)-(\d+)\}/);
  
  if (!match) {
    // If no pattern is found, just yield the original URL
    yield urlPattern;
    return;
  }

  const [fullMatch, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  
  // Detect how much padding is needed based on the first number (e.g., '001' -> length 3)
  const padLength = startStr.length;

  // Sanity check to prevent accidental infinite loops or memory crashes
  if (start > end || (end - start) > 100000) {
    throw new Error("Invalid pattern range or range too large (max 100000 allowed)");
  }

  for (let i = start; i <= end; i++) {
    // Format the number to match the original padding (e.g., 2 -> '002')
    const numStr = i.toString().padStart(padLength, '0');
    yield urlPattern.replace(fullMatch, numStr);
  }
}
