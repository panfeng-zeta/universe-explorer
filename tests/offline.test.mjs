import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { offlineCopy } from '../dist/js/offline.js';

const dist = new URL('../dist/', import.meta.url);
const workerSource = await readFile(new URL('sw.js', dist), 'utf8');
const manifestSource = await readFile(new URL('precache-manifest.js', dist), 'utf8');
const manifestContext = { self: {} };
vm.runInNewContext(manifestSource, manifestContext);
const manifest = manifestContext.self.UNIVERSE_PRECACHE;
const sourceBytes = new Map(await Promise.all(manifest.files.map(async file => [file.path, await readFile(new URL(file.path, dist))])));

// Execute the real Worker against an in-memory Cache API and a controllable network.
function makeStorage() {
  const storage = {
    stores: new Map(), fetchAsset: null,
    async keys() { return [...this.stores.keys()]; },
    async delete(name) { return this.stores.delete(name); }
  };
  storage.open = async name => {
    if (!storage.stores.has(name)) storage.stores.set(name, new Map());
    const entries = storage.stores.get(name);
    return {
      async addAll(requests) {
        const responses = await Promise.all(requests.map(async request => {
          const response = await storage.fetchAsset(request);
          if (!response.ok) throw new Error('Download failed');
          const data = Buffer.from(await response.clone().arrayBuffer());
          const digest = 'sha256-' + createHash('sha256').update(data).digest('base64');
          if (request.integrity !== digest) throw new Error('Integrity mismatch');
          return [request.url, response];
        }));
        responses.forEach(([key, value]) => entries.set(key, value));
      },
      async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); }
    };
  };
  return storage;
}

function makeWorker({ scope = 'https://example.test/solar/', version = manifest.version, storage = makeStorage(), failPath, corruptPath } = {}) {
  const listeners = new Map();
  let online = true;
  let networkCalls = 0;
  let claimed = false;
  const base = new URL(scope);
  async function fetchAsset(request) {
    networkCalls++;
    if (!online) throw new Error('Network is offline');
    const relative = new URL(request.url).pathname.slice(base.pathname.length);
    if (relative === failPath) return new Response('missing', { status: 404 });
    if (relative === corruptPath) return new Response('wrong release');
    return sourceBytes.has(relative) ? new Response(sourceBytes.get(relative)) : new Response('missing', { status: 404 });
  }
  storage.fetchAsset = fetchAsset;
  const context = {
    URL, Request, Response, caches: storage, fetch: fetchAsset,
    self: {
      registration: { scope },
      clients: { async claim() { claimed = true; } },
      addEventListener(name, callback) { listeners.set(name, callback); }
    },
    importScripts() { context.self.UNIVERSE_PRECACHE = { ...manifest, version }; }
  };
  vm.runInNewContext(workerSource, context);
  async function dispatch(type, data = {}) {
    let completion = Promise.resolve();
    let response;
    listeners.get(type)({ ...data, waitUntil(promise) { completion = promise; }, respondWith(promise) { response = promise; } });
    await completion;
    return response === undefined ? undefined : await response;
  }
  return {
    storage, scope, get networkCalls() { return networkCalls; }, get claimed() { return claimed; },
    setOffline() { online = false; },
    install: () => dispatch('install'), activate: () => dispatch('activate'),
    fetch: (url, method = 'GET') => dispatch('fetch', { request: new Request(url, { method }) }),
    async status(type = 'OFFLINE_STATUS') {
      let answer;
      await dispatch('message', { data: { type }, ports: [{ postMessage(value) { answer = value; } }] });
      return answer;
    }
  };
}

test('snapshot contains every texture and all three offline language dictionaries', () => {
  assert.equal(manifest.files.filter(file => file.path.startsWith('assets/')).length, 11);
  for (const path of ['index.html', 'js/offline.js', 'vendor/three.module.js', 'manifest.webmanifest', 'CREDITS.txt']) {
    assert.ok(manifest.files.some(file => file.path === path));
  }
  assert.deepEqual(Object.keys(offlineCopy.en).sort(), Object.keys(offlineCopy.zh).sort());
  assert.deepEqual(Object.keys(offlineCopy.ja).sort(), Object.keys(offlineCopy.zh).sort());
});

for (const scope of ['https://example.test/', 'https://example.test/learn/solar/']) {
  test(`all cached resources and navigation work with network disabled: ${scope}`, async () => {
    const worker = makeWorker({ scope });
    await worker.install(); await worker.activate();
    assert.equal(worker.claimed, true);
    assert.equal((await worker.status()).ready, true);
    worker.setOffline();
    const before = worker.networkCalls;
    for (const file of manifest.files) {
      const response = await worker.fetch(new URL(file.path, scope).href);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), sourceBytes.get(file.path));
    }
    const home = await worker.fetch(scope + '?source=shortcut');
    assert.ok((await home.text()).includes('Universe Explorer'));
    assert.equal(worker.networkCalls, before);
    assert.equal(await worker.fetch('https://other.test/'), undefined);
    assert.equal(await worker.fetch(new URL('unknown.js', scope).href), undefined);
    assert.equal(await worker.fetch(scope, 'POST'), undefined);
  });
}

test('failed and corrupted updates preserve the active release', async () => {
  for (const bad of [{ failPath: 'assets/mars.jpg' }, { corruptPath: 'js/app.js' }]) {
    const storage = makeStorage();
    const old = makeWorker({ storage, version: 'old' });
    await old.install(); await old.activate();
    const update = makeWorker({ storage, version: 'new', ...bad });
    await assert.rejects(update.install());
    assert.ok((await storage.keys()).some(name => name.endsWith(':old')));
    assert.ok(!(await storage.keys()).some(name => name.endsWith(':new')));
    assert.equal((await old.status()).ready, true);
  }
});

test('new activation cleans only this installation and never unrelated caches', async () => {
  const storage = makeStorage();
  const old = makeWorker({ storage, version: 'old' });
  await old.install(); await old.activate();
  await storage.open('another-app:cache');
  await storage.open('universe-explorer:%2Fother%2F:keep');
  const next = makeWorker({ storage, version: 'new' });
  await next.install();
  assert.ok((await storage.keys()).some(name => name.endsWith(':old')));
  await next.activate();
  assert.ok(!(await storage.keys()).some(name => name.endsWith(':old')));
  assert.ok((await storage.keys()).includes('another-app:cache'));
  assert.ok((await storage.keys()).includes('universe-explorer:%2Fother%2F:keep'));
});

test('partial upload with the active manifest version cannot delete its working cache', async () => {
  const storage = makeStorage();
  const old = makeWorker({ storage, version: 'same-manifest' });
  await old.install(); await old.activate();
  const update = makeWorker({ storage, version: 'same-manifest', corruptPath: 'js/app.js' });
  await assert.rejects(update.install());
  old.setOffline();
  assert.equal((await old.status()).ready, true);
  const response = await old.fetch(new URL('js/app.js', old.scope).href);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), sourceBytes.get('js/app.js'));
});

test('evicted cache is not reported ready, and explicit repair restores it', async () => {
  const worker = makeWorker();
  await worker.install(); await worker.activate();
  const entries = [...worker.storage.stores.values()][0];
  entries.delete(new URL('assets/earth.jpg', worker.scope).href);
  assert.equal((await worker.status()).ready, false);
  assert.equal((await worker.status('REPAIR_OFFLINE')).ready, true);
});

test('an already activating worker eventually reports offline readiness', { timeout: 5000 }, async () => {
  const uiSource = await readFile(new URL('js/offline.js', dist), 'utf8');
  const worker = new EventTarget();
  worker.state = 'activating';
  worker.postMessage = (_message, ports) => ports[0].postMessage({ ready: true });
  const registration = new EventTarget();
  Object.assign(registration, { active: worker, installing: null, waiting: null });
  const serviceWorker = new EventTarget();
  serviceWorker.register = async () => registration;
  const button = new EventTarget();
  button.dataset = {};
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  button.setAttribute = () => { if (button.dataset.state === 'ready') resolveReady(); };
  const window = new EventTarget();
  window.isSecureContext = true;
  const context = vm.createContext({
    URL, MessageChannel, setTimeout, clearTimeout, console, window,
    navigator: { serviceWorker, onLine: true }, button
  });
  vm.runInContext(uiSource.replace(/export /g, '').replace('import.meta.url', "'https://example.test/solar/js/offline.js'") + '\nsetupOffline(button, "zh");', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.dataset.state, 'preparing');
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(button.dataset.state, 'preparing');
  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await ready;
  assert.equal(button.textContent, offlineCopy.zh.ready);
});
