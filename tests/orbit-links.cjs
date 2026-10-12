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
        window.orbitTest = { frames: 1, clicks: [] };
        window.requestAnimationFrame = callback => { window.orbitTest.nextFrame = callback; };
        // Record real browser link activation without leaving the test page.
        document.addEventListener('click', event => {
          const anchor = event.target.closest('a');
          if (anchor) {
            window.orbitTest.clicks.push(anchor.getAttribute('href'));
            event.preventDefault();
          }
        });
      });
      await page.goto('https://orbit.test/');
      await page.waitForSelector('#orbit-links');
      const links = page.locator('.orbit-link');
      assert.equal(await links.count(), 3);
      assert.equal(await page.locator('canvas').count(), 0);

      async function advance(count = 1) {
        await page.evaluate(count => {
          for (let i = 0; i < count; i++) {
            window.orbitTest.nextFrame();
            window.orbitTest.frames++;
          }
        }, count);
      }
      async function checkGeometry(label) {
        const result = await page.evaluate(() => {
          const headshot = document.querySelector('#headshot').getBoundingClientRect();
          const layer = document.querySelector('#orbit-links').getBoundingClientRect();
          const cv = document.querySelector('.orbit-link').getBoundingClientRect();
          const angle = window.orbitTest.frames * 0.0045;
          return { origin: [layer.x, layer.y],
            actual: [cv.x + cv.width / 2, cv.y + cv.height / 2],
            expected: [headshot.x + headshot.width / 2 + 125 * Math.cos(angle),
              headshot.y + headshot.height / 2 + 60 * Math.sin(angle)] };
        });
        assert.deepEqual(result.origin, [0, 0]);
        result.actual.forEach((value, i) => assert.ok(Math.abs(value - result.expected[i]) < 0.1, `${label}: orbit follows headshot`));
        assert.deepEqual(errors, []);
        console.log(`PASS DPR ${deviceScaleFactor}: ${label}`);
      }
      await checkGeometry('wide window');
      for (const width of [2560, 1100, 650, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await advance();
        await checkGeometry(`resize to ${width}px`);
      }
      await page.evaluate(() => {
        document.querySelector('.left-side').style.height = '350px';
        document.querySelector('.left-side').scrollTop = 65;
      });
      await advance();
      await checkGeometry('independent column scrolling');
      await page.evaluate(() => { document.querySelector('h1').style.marginBottom = '70px'; });
      await advance();
      await checkGeometry('layout shift without resize');
      await page.evaluate(() => {
        document.querySelector('.left-side').style.height = '';
        document.querySelector('.left-side').scrollTop = 0;
        document.querySelector('h1').style.marginBottom = '';
      });
      await advance();

      async function pointOnLabel(link) {
        return link.locator('.orbit-label').first().evaluate(label => {
          const r = label.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
      }
      // Regression: first hover, leave without clicking, then re-enter and click.
      for (let round = 0; round < 8; round++) {
        for (const name of ['Google Scholar', 'email', 'cv']) {
          const link = page.getByRole('link', { name, exact: true });
          let point = await pointOnLabel(link);
          await page.mouse.move(point.x, point.y);
          const before = await link.boundingBox();
          await advance(20);
          assert.deepEqual(await link.boundingBox(), before, `${name}: pauses while hovered`);
          assert.equal(await link.evaluate(a => getComputedStyle(a).color), 'rgb(224, 108, 117)');
          await page.mouse.move(1800, 800);
          await advance(30);
          assert.notDeepEqual(await link.boundingBox(), before, `${name}: resumes after leaving`);
          point = await pointOnLabel(link);
          assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'), point), await link.getAttribute('href'), `${name}: visible label is browser hit target`);
          await page.mouse.move(point.x, point.y);
          await advance(10);
          await page.mouse.click(point.x, point.y);
          assert.equal(await page.evaluate(() => window.orbitTest.clicks.at(-1)), await link.getAttribute('href'), `${name}: activates after re-entry`);
          await page.mouse.move(1800, 800);
        }
      }
      assert.equal(await page.evaluate(() => window.orbitTest.clicks.length), 24);
      console.log(`PASS DPR ${deviceScaleFactor}: 24 hover / leave / re-entry / native click sequences`);
      const scholar = page.getByRole('link', { name: 'Google Scholar' });
      await scholar.focus();
      const focused = await scholar.boundingBox();
      await advance(20);
      assert.deepEqual(await scholar.boundingBox(), focused, 'keyboard focus pauses orbit');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.orbitTest.clicks.at(-1)), await scholar.getAttribute('href'));
      assert.deepEqual(errors, []);
      console.log(`PASS DPR ${deviceScaleFactor}: keyboard focus and activation`);
      if (deviceScaleFactor === 1) await page.screenshot({ path: '/tmp/orbit-native-links.png' });
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
