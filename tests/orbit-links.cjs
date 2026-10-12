// Run with Playwright installed: node tests/orbit-links.cjs
// Uses an isolated Chrome profile and local files; no web server is required.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const deviceScaleFactor of [1, 2]) {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 900 }, deviceScaleFactor,
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'orbit.test') return route.abort();
        return route.fulfill({ path: path.join(__dirname, '..',
          url.pathname === '/' ? 'index.html' : url.pathname) });
      });
      await page.addInitScript(() => {
        // Advance the real animation deterministically, recording actual draws.
        window.orbitTest = { draws: [], frames: 1 };
        window.requestAnimationFrame = callback => { window.orbitTest.nextFrame = callback; };
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
          window.orbitTest.draws.push({ text, x, y });
          return fillText.call(this, text, x, y, ...rest);
        };
        window.open = url => { window.orbitTest.opened = url; };
      });
      await page.goto('https://orbit.test/');
      await page.waitForSelector('#overlayCanvas');

      async function check(label, advance = false) {
        const result = await page.evaluate(advance => {
          const test = window.orbitTest;
          if (advance) {
            test.draws = [];
            test.nextFrame();
            test.frames++;
          }
          const canvas = document.querySelector('#overlayCanvas');
          const bounds = canvas.getBoundingClientRect();
          const headshot = document.querySelector('#headshot').getBoundingClientRect();
          const cv = test.draws.find(draw => draw.text === 'cv');
          const expected = {
            x: headshot.x + headshot.width / 2 + 125 * Math.cos(test.frames * 0.0045),
            y: headshot.y + headshot.height / 2 + 60 * Math.sin(test.frames * 0.0045),
          };
          // Click where the label is actually painted, including canvas offset.
          const destinations = {};
          for (const text of ['cv', 'scholar', 'email']) {
            const draw = test.draws.find(draw => draw.text === text);
            test.opened = null;
            document.dispatchEvent(new MouseEvent('click', {
              clientX: bounds.x + draw.x, clientY: bounds.y + draw.y, ctrlKey: true,
            }));
            destinations[text] = test.opened;
          }
          return { origin: [bounds.x, bounds.y], cv, expected,
            destinations, backingWidth: canvas.width,
            expectedWidth: innerWidth * devicePixelRatio };
        }, advance);
        assert.deepEqual(result.origin, [0, 0], `${label}: canvas uses viewport origin`);
        assert.ok(Math.abs(result.cv.x - result.expected.x) < 0.01, `${label}: orbit x follows headshot`);
        assert.ok(Math.abs(result.cv.y - result.expected.y) < 0.01, `${label}: orbit y follows headshot`);
        assert.deepEqual(result.destinations, {
          cv: 'pdfs/dunivin_CV.pdf',
          scholar: 'https://scholar.google.com/citations?user=qZadTtcAAAAJ&hl=en',
          email: 'mailto:zdunivin@ucdavis.edu',
        }, `${label}: all visible labels are clickable`);
        assert.equal(result.backingWidth, result.expectedWidth, `${label}: pixel density`);
        assert.deepEqual(errors, [], `${label}: browser errors`);
        console.log(`PASS DPR ${deviceScaleFactor}: ${label}`);
      }

      await check('wide window');
      for (const width of [2560, 1100, 650, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() => document.querySelector('canvas').width === innerWidth * devicePixelRatio, null, { polling: 50 });
        await check(`resize to ${width}px`, true);
      }
      await page.evaluate(() => {
        document.querySelector('.left-side').style.height = '350px';
        document.querySelector('.left-side').scrollTop = 65;
      });
      await check('independent left-column scrolling', true);
      await page.evaluate(() => { document.querySelector('h1').style.marginBottom = '70px'; });
      await check('layout shift without resize', true);
      // Simulate the pixel ratio change caused by browser zoom / changing screens.
      await page.evaluate(() => Object.defineProperty(window, 'devicePixelRatio', { value: 1.5 }));
      await check('pixel ratio change after initialization', true);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
