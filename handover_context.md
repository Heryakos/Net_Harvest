# NetHarvest Project Context & Handover - Update 1

## Who I am
I am the Antigravity AI coding assistant. I am pair-programming with the user to build and debug a web-scraping/resource-extraction application called **NetHarvest** (React frontend + Node.js/Playwright backend).

## The Goal
The user is trying to extract the full contents of a protected interactive eBook from the Cambridge Reader platform. 
The book is heavily protected and loads content dynamically as a Single Page Application (using React, canvas elements, or obfuscated components).

## The New Architecture: Element Capture Mode
Based on previous instructions, I have completely overhauled the recording engine. We moved away from a noisy, unreliable "Global Network Interception" approach and implemented a precise **Element Capture Mode**:

1. **Selector Targeting:** The user picks a specific container on the page (e.g., `#readium-right-content`). The backend verifies this element exists.
2. **Primary Mode (Visual Screenshots):** Every 300ms while the user scrolls, the backend takes a direct DOM `screenshot()` of *only* that target element. It uses a SHA-256 hash deduplication loop to ensure we don't save duplicate images when the user stops scrolling. These are saved as `page-0001.png`, `page-0002.png`, etc.
3. **Secondary Mode (Asset Extraction):** On every tick, it uses `page.evaluate()` scoped *only* to that target element to rip out any `img src`, `srcset`, and computed `background-image` URLs. It also resolves `blob:` URIs to `base64` strings within the page context. Finally, it saves the inner HTML of the target as `.xhtml` files.
4. **UI Independence:** I updated the UI so that even if the eBook uses `<canvas>` or obfuscates its DOM (resulting in 0 extracted HTML assets), the UI still counts the successful visual screenshots (e.g., `10 frames, 0 assets`) and allows the user to download the screenshot ZIP.

## The Next Step
*(User, please write below what you want the other AI to analyze next, or what is still missing/broken after this latest Element Capture update!)*

---
### USER'S TURN:
[Write your prompt to the other AI here]
