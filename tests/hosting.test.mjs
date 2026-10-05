import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createStaticServer } from '../scripts/serve.mjs';

const context = { self: {} };
vm.runInNewContext(await readFile(new URL('../dist/precache-manifest.js', import.meta.url), 'utf8'), context);
const files = context.self.UNIVERSE_PRECACHE.files;

for (const basePath of ['/', '/solar/']) {
  test(`static host serves an unauthenticated, complete release at ${basePath}`, async t => {
    const server = createStaticServer({ basePath });
    server.listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const base = origin + basePath;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('set-cookie'), null);
    const html = await page.text();
    assert.ok(html.includes('src="./js/app.js"'));
    assert.ok(!/\b(?:src|href)="\/(?!\/)/.test(html));
    assert.ok(!html.includes('type="importmap"'));
    for (const file of files) {
      const response = await fetch(new URL(file.path, base));
      assert.equal(response.status, 200, file.path);
      const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('base64');
      assert.equal('sha256-' + digest, file.integrity, file.path);
      if (file.path.endsWith('.js')) assert.ok(response.headers.get('content-type').includes('javascript'));
    }
    assert.equal((await fetch(new URL('sw.js', base))).headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(new URL('manifest.webmanifest', base))).headers.get('content-type'), 'application/manifest+json');
    assert.equal((await fetch(new URL('missing.js', base))).status, 404);
    assert.equal((await fetch(new URL('.git/config', base))).status, 403);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
    if (basePath !== '/') {
      const redirect = await fetch(origin + '/solar', { redirect: 'manual' });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get('location'), '/solar/');
      assert.equal((await fetch(origin + '/assets/earth.jpg')).status, 404);
    }
  });
}

test('runtime resources are local and published byte hashes match', async () => {
  const css = await readFile(new URL('../dist/style.css', import.meta.url), 'utf8');
  assert.ok(!/@import|url\(["']?https?:/.test(css));
  for (const file of files) {
    if (!file.path.endsWith('.js')) continue;
    const source = await readFile(new URL('../dist/' + file.path, import.meta.url), 'utf8');
    // Imports in executable statements; vendor comments contain example imports.
    for (const match of source.matchAll(/^import\s+[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/gm)) {
      assert.ok(match[1].startsWith('.'), `${file.path} imports ${match[1]}`);
    }
  }
});
