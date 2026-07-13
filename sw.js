/* ─────────────────────────────────────────────────────────
   即カウントタイマー — Service Worker
   役割: アプリ本体を Cache Storage に保存し、
         オフライン(ネット接続なし)でも起動できるようにする。
   ───────────────────────────────────────────────────────── */

// ★ ファイルを更新したら必ずこの数字を上げること。
//   キャッシュ名が変わる → install が走り直す → 新しい内容が配信される。
const VERSION = 'v2';
const CACHE_NAME = 'sokucount-' + VERSION;

// アプリの動作に必要な最小限のファイル(app shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

// 無くてもアプリは動くファイル。
// これを PRECACHE_URLS に入れると、ファイルが 1 つでも欠けた瞬間に
// cache.addAll() 全体が失敗し、オフライン機能ごと死ぬ。分けておく。
const OPTIONAL_URLS = [
  './alarm.mp3',
];

// ─── install: 初回インストール時に app shell を全部取得して保存 ───
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache.addAll は 1 つでも失敗すると全体が失敗する(=中途半端な
    // キャッシュを作らない)ので、app shell の取得にはこれが適している。
    await cache.addAll(PRECACHE_URLS);

    // 任意ファイルは allSettled で「失敗しても先へ進む」
    await Promise.allSettled(OPTIONAL_URLS.map(u => cache.add(u)));

    await self.skipWaiting(); // 古い SW の終了を待たずに新しい SW を有効化
  })());
});

// ─── activate: 古いバージョンのキャッシュを削除 ───
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim(); // 既に開いているページもこの SW の管理下に入れる
  })());
});

// ─── fetch: stale-while-revalidate ───
//   1. キャッシュがあれば即座に返す(= オフラインでも表示できる / 高速)
//   2. 同時に裏でネットワーク取得を走らせ、成功したらキャッシュを更新
//   → 次回アクセス時に新しい内容が反映される。
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;                       // POST 等は素通し
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 外部ドメインは素通し

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // ignoreSearch: true → "index.html?v=2" のようなクエリ違いでも
    // 同じエントリにヒットさせる。
    const cached = await cache.match(req, { ignoreSearch: true });

    const networkPromise = fetch(req)
      .then((res) => {
        // res.ok = ステータス 200〜299。エラーページを保存しないためのガード。
        if (res && res.ok && res.type === 'basic') {
          cache.put(req, res.clone()); // Response は 1 回しか読めないので clone
        }
        return res;
      })
      .catch(() => null); // オフライン時は null

    if (cached) {
      event.waitUntil(networkPromise); // 裏の更新処理が中断されないようにする
      return cached;
    }

    const res = await networkPromise;
    if (res) return res;

    // キャッシュにもネットにも無い場合:
    // ナビゲーション(ページ遷移)なら index.html を返してアプリを起動させる。
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
