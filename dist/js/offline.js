export const offlineCopy = {
  zh: {
    preparing: '正在准备离线资源…', ready: '可离线使用', offline: '已离线 · 可以继续探索',
    unavailable: '此环境不支持离线缓存', failed: '离线资源未就绪 · 点击重试',
    update: '新版已备好 · 关闭网站后重开',
    readyHint: '页面、脚本和全部贴图已保存在此浏览器。清除网站数据会删除离线资源。',
    unavailableHint: '请通过 HTTPS 或本机 localhost 打开；浏览器也可能禁止离线存储。',
    failedHint: '请保持联网并重试。下载完成之前，不能保证断网后可用。',
    preparingHint: '首次下载整套太阳系资源。完成后会显示“可离线使用”。',
    updateHint: '关闭本网站的所有标签后重新打开，以使用完整的新版本。'
  },
  en: {
    preparing: 'Preparing offline files…', ready: 'Ready for offline use', offline: 'Offline · Keep exploring',
    unavailable: 'Offline cache unavailable', failed: 'Offline files incomplete · Retry',
    update: 'Update ready · Close and reopen',
    readyHint: 'The page, scripts, and all textures are saved in this browser. Clearing site data removes them.',
    unavailableHint: 'Use HTTPS or localhost. Your browser may also restrict offline storage.',
    failedHint: 'Stay connected and retry. Offline use is not ready until the download completes.',
    preparingHint: 'Downloading the complete solar system. Wait for “Ready for offline use”.',
    updateHint: 'Close every tab for this app, then reopen it to use the complete new version.'
  },
  ja: {
    preparing: 'オフライン用データを準備中…', ready: 'オフラインで利用できます', offline: 'オフライン · 探索を続けられます',
    unavailable: 'オフライン保存を利用できません', failed: 'オフライン準備未完了 · 再試行',
    update: '更新の準備完了 · 閉じて再度開く',
    readyHint: 'ページ、プログラム、全ての画像をこのブラウザーに保存しました。サイトデータを削除すると失われます。',
    unavailableHint: 'HTTPS または localhost で開いてください。ブラウザーが保存を制限している場合もあります。',
    failedHint: '接続を保って再試行してください。ダウンロード完了までオフライン利用はできません。',
    preparingHint: '太陽系の全データを保存中です。「オフラインで利用できます」と表示されるまでお待ちください。',
    updateHint: 'このサイトの全てのタブを閉じ、もう一度開くと新しいバージョンになります。'
  }
};

export function setupOffline(button, initialLanguage) {
  let language = initialLanguage;
  let state = 'preparing';
  let registration;
  let registering = false;
  const watched = new WeakSet();
  const base = new URL('../', import.meta.url);
  const workerUrl = new URL('sw.js', base);

  function render() {
    const copy = offlineCopy[language];
    const key = state === 'ready' && !navigator.onLine ? 'offline' : state;
    button.textContent = copy[key];
    button.title = copy[(state === 'ready' ? 'ready' : state) + 'Hint'] || copy.readyHint;
    button.dataset.state = state;
    button.setAttribute('aria-label', button.textContent + '. ' + button.title);
  }
  function setState(value) { state = value; render(); }

  async function requestWorker(worker, type) {
    const channel = new MessageChannel();
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Offline worker did not respond')), type === 'REPAIR_OFFLINE' ? 90000 : 5000);
        channel.port1.onmessage = event => resolve(event.data);
        worker.postMessage({ type }, [channel.port2]);
      });
    } finally { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); }
  }

  async function checkReady() {
    // Only trust our worker after it confirms the complete cache exists.
    const worker = registration?.active;
    if (!worker || worker.state !== 'activated') return;
    try {
      const answer = await requestWorker(worker, 'OFFLINE_STATUS');
      setState(answer?.ready ? (registration.waiting ? 'update' : 'ready') : 'failed');
    } catch { setState('failed'); }
  }

  function watch(worker) {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') void checkReady();
      if (worker.state === 'installed' && registration.active) setState('update');
      if (worker.state === 'redundant') {
        if (registration.active) void checkReady();
        else setState('failed');
      }
    });
  }

  async function register() {
    if (registering) return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      setState('unavailable'); return;
    }
    registering = true;
    setState('preparing');
    try {
      registration = await navigator.serviceWorker.register(workerUrl, {
        scope: base.href, updateViaCache: 'none'
      });
      watch(registration.installing);
      watch(registration.active);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      if (registration.active) await checkReady();
      else if (!registration.installing && !registration.waiting) setState('failed');
    } catch (error) {
      console.warn('Offline cache could not be prepared:', error);
      setState('failed');
    } finally { registering = false; }
  }

  button.addEventListener('click', () => {
    if (state !== 'failed') return;
    // Removing only this failed, inactive registration allows a fresh install.
    // Existing active versions and other sites are never unregistered.
    void (async () => {
      if (registration && !registration.active) await registration.unregister();
      await register();
      if (registration?.active && state === 'failed') {
        setState('preparing');
        const answer = await requestWorker(registration.active, 'REPAIR_OFFLINE');
        setState(answer?.ready ? 'ready' : 'failed');
        if (!answer?.ready) {
          try { await registration.update(); } catch { /* retain the failure status */ }
        }
      }
    })().catch(() => setState('failed'));
  });
  window.addEventListener('online', () => { render(); if (state === 'failed') void register(); });
  window.addEventListener('offline', render);
  window.addEventListener('pageshow', () => { if (registration?.active) void checkReady(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => void checkReady());
  render();
  void register();
  return { setLanguage(value) { language = value; render(); } };
}
