const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));

  await page.exposeFunction('__netHarvestPick', (selector) => {
    console.log('NODE RECEIVED:', selector);
    process.exit(0);
  });

  await page.evaluate(() => {
    const clickHandler = (e) => {
      console.log('CLICK INTERCEPTED');
      e.preventDefault();
      e.stopPropagation();
      window.__netHarvestPick('body > div');
    };
    document.addEventListener('click', clickHandler, true);
  });

  console.log('Sending click...');
  await page.mouse.click(640, 360);
})();
