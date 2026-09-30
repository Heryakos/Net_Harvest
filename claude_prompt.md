# NetHarvest - Cambridge Reader Extraction Project (Handover Context)

## 🤖 Who I Am (Antigravity AI)
I am the AI assistant that has been working on this project so far. I have been pair programming with the user to build a web scraper (NetHarvest) capable of extracting protected ebook pages from the Cambridge Reader.

## 🎯 What We Want to Achieve
The goal is to build a tool that allows the user to log into their Cambridge Reader account via an interactive browser (powered by Playwright) and extract the book pages. 
Right now, **we are strictly focusing on perfecting the "Single Page MVP"**. We only want to capture the exact book element for a single page. Once the single page extraction is 100% perfect, we will move on to the multi-page/full-book crawler.

## 🏗️ The Architecture & The Challenge
The Cambridge Reader has a complex, nested DOM structure:
1. **Main Frame:** The main wrapper page (`cambridge.org`).
2. **Outer Iframe:** A cross-origin iframe (`elevate-s3.cambridge.org/Reader_GO/viewer.html`).
3. **Inner Iframes (The Pages):** Inside that outer iframe, the actual book pages are rendered as individual `.xhtml` iframes (e.g., `page04.xhtml`).

Because of these cross-origin iframes, standard Playwright `page.$('#readium-right-content')` calls fail on the main page.

## 🛠️ What I (Antigravity AI) Have Built So Far
We have an `engine.ts` (CambridgeReaderEngine) that runs in a Node.js backend, receiving commands via a WebSocket connection from a React frontend.

1. **The Single Image Screenshot (MVP):** 
   I built a `captureSingleImage` function that actively pierces through the iframes. It loops through `page.frames()`, searches for the user's target selector (e.g., `#readium-right-content`), and when it finds it, it takes an `elementHandle.screenshot()`. 
   **This works perfectly** — it successfully finds the iframe, crops the screenshot to just the book element (e.g. 900x535px), and zips it up as a PNG!

2. **The Multi-Page Attempt:**
   I attempted to write a `listVisibleIframes()` function to find all visible `.xhtml` iframes and extract their actual DOM/CSS/Images. However, this has proven difficult due to the nested iframes and potential CORS issues when evaluating fetch scripts inside cross-origin frames.

## 🚧 What the User Wants From You (Claude)
The user wants you to review this architecture and tell us exactly how to proceed.
Even though the PNG screenshot of the single element works, the user wants a perfect plan for the next step.

Please review our approach and provide:
1. **Your understanding of the project and the iframe structure.**
2. **If we want to extract the actual HTML/CSS/Images of that single page instead of just a PNG screenshot, how should we modify our single-page MVP to handle the cross-origin CORS restrictions within that deeply nested iframe?**
3. **A step-by-step prompt or plan that I (Antigravity) can follow to implement the best possible Single Page extraction.**

Once we agree on your proposed plan and you give us a perfect prompt, the user will feed that prompt back to me so I can implement it. Remember, **all we are doing right now is focusing on the single page.** We will worry about multiple pages later.
