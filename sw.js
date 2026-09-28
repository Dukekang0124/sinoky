/* Sinoky service worker — network-first shell cache (kaikou pattern) */
var CACHE = 'sinoky-v0.29.2';
var ASSETS = [
  './',
  './index.html',
  './credits.html',   /* v0.23.8：合规页应离线可达（从产品内鸣谢块链出） */
  './manifest.webmanifest',
  './version.json',
  './data/flashcards.hsk1.json',
  './data/flashcards.hsk2.json',
  './data/flashcards.hsk3.json',
  './data/flashcards-levels.json',
  './data/connect-templates.json',
  './langs/zh.json', './langs/es.json', './langs/ru.json', './langs/vi.json', './langs/id.json', './langs/th.json',
  './icons/icon-192.png',
  './icons/icon-512.webp',
  './icons/favicon-32.png',
  /* v0.22.0 诺诺 IP：定妆图 + 8 姿态 + 3 空态。全部本地资源，接地即用。 */
  './icons/logo-header.png',
  /* v0.23.11 满版开屏图（首屏第一眼，必须离线可用；未预热则离线启动开屏是空的） */
  './assets/splash/a8_9x16.webp',
  './assets/brand/nono-splash.webp',
  './assets/brand/nono-hero.webp',
  './assets/brand/nono-share.webp',
  './assets/mascot/like.webp',
  './assets/mascot/cheer.webp',
  './assets/mascot/think.webp',
  './assets/mascot/listen.webp',
  './assets/mascot/sorry.webp',
  './assets/mascot/point.webp',
  './assets/mascot/wave.webp',
  './assets/mascot/note.webp',
  './assets/empty/general.webp',
  './assets/empty/network.webp',
  './assets/empty/study.webp',
  /* v0.24.0 UI 图标（Lucide · ISC）：攻略页首屏即用，必须离线可达 */
  './assets/icons/ui/zone-airport.svg','./assets/icons/ui/zone-payment.svg','./assets/icons/ui/zone-metro.svg',
  './assets/icons/ui/zone-taxi.svg','./assets/icons/ui/zone-food.svg','./assets/icons/ui/zone-ticket.svg',
  './assets/icons/ui/zone-hotel.svg','./assets/icons/ui/zone-emergency.svg','./assets/icons/ui/zone-departure.svg',
  './assets/icons/ui/icon-ask.svg','./assets/icons/ui/icon-pin.svg','./assets/icons/ui/icon-mic.svg',
  './assets/icons/ui/icon-check.svg','./assets/icons/ui/icon-eye.svg','./assets/icons/ui/icon-slow.svg',
  './assets/icons/ui/icon-city.svg','./assets/icons/ui/icon-days.svg','./assets/icons/ui/icon-dialog.svg',
  './assets/icons/ui/icon-review.svg','./assets/icons/ui/icon-feedback.svg',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* v0.1.1 fix (P2): cross-origin (TTS audio etc.) passes straight through —
     never cached, never polluting the shell cache */
  if (url.origin !== location.origin) return;
  /* v0.3.26: /api/tts 音频动态（音源随兜底链切换），绝不同进 SW Cache Storage，
     否则切音色/换引擎后仍可能播到旧音频。network-only，不缓存。 */
  if (url.pathname.indexOf('/api/tts') > -1) return;
  /* version.json: network always, cache-busting query must not create cache entries */
  if (url.pathname.indexOf('version.json') > -1) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match('./version.json');
      })
    );
    return;
  }
  /* network-first: always try fresh, fall back to cached shell when offline */
  e.respondWith(
    fetch(e.request).then(function (res) {
      /* 落盘规则（v0.28.0 收紧，三条都有实测证据）：
         ① 文档导航**不落** —— 深链 ?go=trip&city=… 走的就是导航请求，而 cache key 是完整 URL
            ⇒ 每点一次不同深链就多存一份仅 query 不同的完整 index.html（~1.5 MB/份），
            Cache Storage 会被慢慢撑爆（配额超了浏览器整体回收，连预缓存一起丢）。
            index.html 本来就在预缓存清单里，离线由下面的 isDoc 回落 './index.html' 兜住。
         ② 任何 /api/* **不落** —— 实测 /api/profile?uid=… 的整份用户 state 被写进了 Cache Storage
            （隐私数据落盘 + 磁盘可见），且这条 GET API 此前没有任何豁免（v0.3.26 只挡了 /api/tts）。
            API 响应一律直连网络，不进 shell cache。
         ③ 其余静态资源：**剥掉 cache-bust query** 后落盘 —— 语言包是 langs/zh.json?t=0.27.0，
            每换一次版本就多堆一份永不清理的条目（实测 3 次深链导航 +12 条，其中就有它）。
            剥 query 后与预缓存条目同 key，覆盖而非新增。 */
      var isApi = url.pathname.indexOf('/api/') > -1;
      if (e.request.mode !== 'navigate' && !isApi) {
        var copy = res.clone();
        var key = url.search ? (url.origin + url.pathname) : e.request;
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        /* 剥掉 cache-bust query 再试一次（langs/zh.json?t=x.y.z → langs/zh.json）。
           少了这一步，离线时带 ?t= 的语言包/语料会全部 miss —— 缓存剥了 query，
           读取也必须剥，否则省下的空间是用离线能力换的。 */
        var retry = url.search ? caches.match(url.origin + url.pathname) : Promise.resolve(null);
        return retry.then(function (h2) {
          if (h2) return h2;
          /* v0.23.8（UX 评审 M13，仍然有效）：**只给文档导航**回落 app shell。
             无条件回落 index.html 会让 data/*.json、vendor/*.js 抓不到时也拿到一坨 HTML，
             上层 r.json() 抛 `Unexpected token '<'`，用户看到解析错误而不是「离线不可用」。
             数据/脚本请求直接失败，由调用方走自己的降级文案。 */
          var acc = e.request.headers.get('accept') || '';
          var isDoc = e.request.mode === 'navigate' || acc.indexOf('text/html') > -1;
          return isDoc ? caches.match('./index.html') : Response.error();
        });
      });
    })
  );
});

/* v0.24.8：Web Push 每日召回（直接攻击 D1 留存 4.2%）
   push：后端 /api/push-send 经 VAPID 签名推到浏览器，这里弹通知。
   notificationclick：点通知回应用。 */
self.addEventListener('push', function (e) {
  var data = { title: 'Sinoky', body: 'Time for a quick Chinese practice?', url: './index.html' };
  try { if (e.data) data = Object.assign(data, e.data.json()); } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || './index.html' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var raw = (e.notification && e.notification.data && e.notification.data.url) || './index.html';
  var target = raw;
  try { target = new URL(raw, self.location.href).href; } catch (_) {}   /* 深链含 query，先解析成绝对 URL */
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cls) {
    for (var i = 0; i < cls.length; i++) {
      if ('focus' in cls[i]) {
        /* v0.28.0：navigate 到带 query 的深链会重载页面 → 前端 PRO.boot() 读 ?go= 直达练习。
           navigate 可能被拒（非同一 SW scope 控制等），失败就退回 openWindow，别让点击石沉大海。*/
        var nav = cls[i].navigate(target);
        if (nav && nav.catch) nav.catch(function () { clients.openWindow(target); });
        return cls[i].focus();
      }
    }
    return clients.openWindow(target);
  }));
});
