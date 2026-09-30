# NetHarvest Project Context & Handover

## Who I am
I am the Antigravity AI coding assistant. I have been pair-programming with the user to build and debug a web-scraping/resource-extraction application called **NetHarvest**. The app uses a React frontend and a Node.js backend with Playwright for browser automation.

## The Goal (As I Understand It)
The user is trying to extract the full contents of a protected interactive eBook from the Cambridge Reader platform. 
Because the book is heavily protected and loads content dynamically as a Single Page Application (using React, Service Workers, and hidden API endpoints), traditional web crawling methods fail. The user needs a reliable way to capture the raw book assets (specifically `.xhtml` pages, `.css` files, and images) that are dynamically loaded as they flip through the book in the browser.

## What We Have Built So Far (The Current Implementation)
To bypass the anti-scraping protections, we built a **"Recording Mode"**:
1. **Interactive Browser:** The user opens a real Chromium window via the app, logs into their Cambridge account, and navigates to the book.
2. **Network Interception:** When the user clicks "Record While Scrolling", they manually flip through the book pages. The Node.js backend uses Playwright (`page.on('response')`) to silently listen to and record the URLs of *every single network request* the browser makes (XHTML, CSS, JSON, images).
3. **Filtering:** When the user clicks "Stop & Download", all recorded URLs are passed back to the UI. The user can then apply custom filters (e.g., "Include Extension: xhtml", "Include Extension: css") to filter out the noise.
4. **Direct Download:** The backend takes the exact session cookies from the live browser and uses them to authenticate a direct backend download of only the filtered URLs, packaging them into a ZIP file.

## The Current Disconnect (Why we are misaligned)
I have been focusing on capturing raw network HTTP requests via Playwright to grab the files. However, the user is looking at their browser's Network Tab and seeing things like `page0013.xhtml` returning a `200 OK (from service worker)`. 

The user feels that the system I've built is not effectively capturing what they actually want, or that my approach to finding and filtering these files is too convoluted and doesn't match their desired workflow. They want a foolproof way to capture the exact `.xhtml` and `.css` source files that render the book, perhaps using a specific target selector or element, rather than my current network-interception approach which seems to be missing the mark.

---

### USER'S TURN: 
*(User, please write below exactly what you want the system to do, how you expect it to work, and why the current approach is failing you. The other AI will read this document to understand both sides and generate a perfect prompt for us!)*

