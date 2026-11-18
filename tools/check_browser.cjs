// Check a real exported catalog under the same project subpath as GitHub Pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../docs');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const prefix = '/long-horizon-real2sim/';
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!pathname.startsWith(prefix)) { res.writeHead(404); return res.end(); }
  const relative = pathname.slice(prefix.length) || 'index.html';
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); return res.end(); }
  const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
  res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
  fs.createReadStream(filename).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-gpu']});
  const failures = [];
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  async function loadedImage() {
    await page.waitForFunction(() => { const im = document.querySelector('#main-image'); return im && im.complete && im.naturalWidth > 0; });
  }
  try {
    await page.goto(base); await loadedImage();
    assert.equal(await page.getByRole('tab').count(), 4);
    assert.equal(await page.locator('.thumb').count(), 10);
    const first = await page.locator('#main-image').getAttribute('src');
    await page.getByRole('button', {name:'下一个视角',exact:true}).click();
    assert.notEqual(await page.locator('#main-image').getAttribute('src'), first);
    await page.getByRole('button',{name:'放大当前对比图'}).click();
    assert(await page.locator('#lightbox').isVisible());
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#lightbox-counter').innerText(), /^3 \/ 10/);
    await page.keyboard.press('Escape');
    assert(!(await page.locator('#lightbox').isVisible()));
    await page.getByRole('searchbox').fill('茶室');
    assert.equal(await page.locator('.scene-button').count(), 1);
    await page.locator('.scene-button').click();
    assert.equal(await page.locator('#scene-detail h2').innerText(), '茶室');
    await page.getByRole('searchbox').fill('definitely-no-scene');
    assert(await page.locator('.empty-list').isVisible());
    await page.getByRole('searchbox').fill('');

    for (const group of data.collections) {
      await page.locator(`[data-collection="${group.id}"]`).click();
      const available = group.scenes.find(s => s.images.length);
      await page.locator(`[data-scene="${available.id}"]`).click();
      await loadedImage();
      assert.equal(await page.locator('.thumb').count(), available.images.length);
      const missing = group.scenes.find(s => !s.images.length);
      if (missing) {
        await page.locator(`[data-scene="${missing.id}"]`).click();
        assert(await page.locator('.empty-scene').isVisible());
        assert.equal(await page.locator('#main-image').count(), 0);
      }
    }
    await page.getByRole('link',{name:'项目进度',exact:true}).click();
    assert(await page.locator('#progress').isVisible());
    assert.equal(await page.locator('.collection-row').count(), 4);
    await page.locator('#chart-kind').selectOption('2k');
    assert.equal(await page.locator('#daily-rows tr').count(), data.stats['2k'].days.length);
    await page.locator('[data-browse="2k"]').click();
    assert(await page.locator('#gallery').isVisible());
    assert.equal(await page.locator('[aria-selected=true]').getAttribute('data-collection'), '2k');

    await page.goto(base + '?part=2k&scene=2#gallery'); await loadedImage();
    assert.match(await page.locator('#scene-detail h2').innerText(), /02/);
    await page.locator('[data-scene="3"]').click();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#scene-detail h2')?.textContent.includes('02'));
    await page.reload(); await loadedImage();
    assert.match(await page.locator('#scene-detail h2').innerText(), /02/);

    for (const width of [390, 360]) {
      await page.setViewportSize({width,height:844});
      for (const section of ['gallery','progress','about']) {
        await page.goto(base + '#' + section);
        await page.locator('#overview').waitFor();
        const sizes = await page.evaluate(() => ({width:innerWidth, content:document.documentElement.scrollWidth}));
        assert(sizes.content <= sizes.width, `Horizontal overflow on ${section}: ${JSON.stringify(sizes)}`);
      }
    }
    const requests = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
    assert(requests.every(url => url.startsWith(base)), 'Unexpected external dependency');
    assert.deepEqual(failures, []);
    console.log('OK: GitHub Pages subpath, all four collections, search, no results, empty scenes, thumbnails, lightbox/keyboard, progress, history/reload, and 360/390px layouts');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
