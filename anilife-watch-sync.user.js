
 // ==UserScript==
 // @name         애니라이프 시청기록 자동 동기화 (Cloudflare D1 연동)
 // @namespace    https://github.com/LeeBaroo/tampermonkey-scripts
 // @version      8.2
 // @description  D1 시청기록, 회차 상단 단일 배지, 이어보기, 숫자패드8 호환 웹 전체화면 유지
 // @match        *://anilife01.tv/*
 // @match        *://*.anilife01.tv/*
 // @grant        GM_xmlhttpRequest
 // @connect      anilife-sync-api.cheol0758.workers.dev
 // @run-at       document-idle
 // ==/UserScript==

 (() => {
     'use strict';

     const API = 'https://anilife-sync-api.cheol0758.workers.dev';
     const KEY = 'anilife-my-secret-2026';
     const DONE_AT = 95;
     const CACHE_KEY = 'anilife-watch-history-cache-v1';
     const SEEK_KEY = 'anilife-resume-seek-v1';

     // 기존 v9.0 전체화면 유지 설정 사용
     const FULL_KEY = 'anilife-web-fullscreen-auto-v89';

     // 숫자패드 v2.2 전체화면 클래스
     const SHORTCUT_FULLSCREEN = 'anilife-web-fullscreen';
     const SHORTCUT_HTML_CLASS = 'anilife-web-fullscreen-active';

     // 시청기록 스크립트의 자동 전체화면 클래스
     const AUTO_FULLSCREEN = 'anilife-full-stage-v89';
     const AUTO_HTML_CLASS = 'anilife-full-active-v89';

     const readJSON = (storage, name, fallback) => {
         try {
             return JSON.parse(
                 storage.getItem(name)
             ) ?? fallback;
         } catch {
             return fallback;
         }
     };

     const cached = readJSON(
         localStorage,
         CACHE_KEY,
         {}
     );

     const all =
         cached?.histories &&
         typeof cached.histories === 'object'
             ? cached.histories
             : {};

     let page = null;
     let pageKey = '';
     let video = null;
     let lastSave = 0;
     let loadingAll = false;
     let lastAllFetch = 0;
     let generation = 0;
     let promptOpen = false;
     let lastDiagnosis = '';

     const hooked = new WeakSet();
     const contexts = new WeakMap();
     const restored = new WeakMap();
     const activePosts = new Map();

     let fullHold =
         sessionStorage.getItem(FULL_KEY) === '1';

     let fullOrigin = '';
     let fullTarget = null;

     // =========================================================
     // 공통 / 기록
     // =========================================================

     const current = () => {
         const m = location.pathname.match(
             /^\/content\/(\d+)\/(\d+)/
         );

         return m
             ? {
                 id: m[1],
                 ep: String(Number(m[2]))
             }
             : null;
     };

     const token = (id, ep) =>
         `${id}:${Number(ep)}`;

     const isDone = r => Boolean(
         r && (
             r.completed === true ||
             r.completed === 1 ||
             r.completed === '1' ||
             String(r.completed).toLowerCase() === 'true' ||
             Number(r.percent) >= DONE_AT
         )
     );

     const animeTitle = () => (
         document.querySelector('h1')?.textContent ||
         document.title ||
         ''
     )
         .replace(/\s+\d+\s*화.*$/, '')
         .replace(/\s*\|\s*애니라이프.*$/, '')
         .trim();

     const timeText = n => {
         n = Math.max(
             0,
             Math.floor(Number(n) || 0)
         );

         return (
             `${Math.floor(n / 60)}:` +
             String(n % 60).padStart(2, '0')
         );
     };

     function normalize(r, id, ep) {
         r ||= {};

         const completed = isDone(r);

         return {
             animeId: String(
                 r.animeId ?? r.anime_id ?? id
             ),

             episode: String(
                 Number(r.episode ?? ep)
             ),

             title: String(
                 r.title || animeTitle()
             ),

             currentTime: Math.max(
                 0,
                 Number(
                     r.currentTime ?? r.current_time
                 ) || 0
             ),

             duration: Math.max(
                 0,
                 Number(r.duration) || 0
             ),

             percent: completed
                 ? 100
                 : Math.max(
                     0,
                     Math.min(
                         100,
                         Number(r.percent) || 0
                     )
                 ),

             completed
         };
     }

     function merge(a, b, id, ep) {
         if (!a) {
             return normalize(b, id, ep);
         }

         if (!b) {
             return normalize(a, id, ep);
         }

         const x = normalize(a, id, ep);
         const y = normalize(b, id, ep);

         const completed =
             x.completed || y.completed;

         return {
             ...x,
             ...y,

             currentTime: Math.max(
                 x.currentTime,
                 y.currentTime
             ),

             duration: Math.max(
                 x.duration,
                 y.duration
             ),

             percent: completed
                 ? 100
                 : Math.max(
                     x.percent,
                     y.percent
                 ),

             completed
         };
     }

     // =========================================================
     // 로컬 캐시
     // =========================================================

     function remember() {
         try {
             localStorage.setItem(
                 CACHE_KEY,
                 JSON.stringify({
                     savedAt: Date.now(),
                     histories: all
                 })
             );

         } catch (e) {
             console.warn(
                 '[애니기록] 캐시 저장 오류',
                 e
             );
         }
     }

     const record = (id, ep) =>
         all[id]?.[String(Number(ep))] || null;

     function setRecord(id, ep, value) {
         id = String(id);
         ep = String(Number(ep));

         all[id] ||= {};

         all[id][ep] = merge(
             all[id][ep],
             value,
             id,
             ep
         );

         remember();

         return all[id][ep];
     }

     // =========================================================
     // Cloudflare D1 API
     // =========================================================

     function api(method, payload, callback) {
         GM_xmlhttpRequest({
             method,

             url: method === 'GET'
                 ? API + '?' +
                   new URLSearchParams(payload)
                 : API,

             headers: method === 'POST'
                 ? {
                     'Content-Type': 'application/json'
                 }
                 : undefined,

             data: method === 'POST'
                 ? JSON.stringify(payload)
                 : undefined,

             timeout: 15000,

             onload: res => {
                 let data;

                 try {
                     data = JSON.parse(
                         res.responseText
                     );
                 } catch {
                     data = null;
                 }

                 const ok =
                     res.status >= 200 &&
                     res.status < 300 &&
                     data?.ok === true;

                 if (!ok) {
                     console.warn(
                         '[애니기록] API 응답 오류',
                         method,
                         res.status,
                         data
                     );
                 }

                 callback?.(ok, data);
             },

             onerror: err => {
                 console.warn(
                     '[애니기록] API 연결 실패',
                     err
                 );

                 callback?.(false, null);
             },

             ontimeout: () => {
                 console.warn(
                     '[애니기록] API 시간초과'
                 );

                 callback?.(false, null);
             }
         });
     }

     // =========================================================
     // 현재 작품 기록 조회
     // =========================================================

     function loadEpisodeRecords() {
         if (!page) return;

         const { id } = page;
         const requestedGeneration = generation;

         api(
             'GET',
             {
                 key: KEY,
                 animeId: id,
                 _: Date.now()
             },

             (ok, data) => {
                 if (
                     !ok ||
                     requestedGeneration !== generation ||
                     page?.id !== id
                 ) {
                     return;
                 }

                 if (!Array.isArray(data?.episodes)) {
                     return;
                 }

                 for (const r of data.episodes) {
                     const ep = String(
                         Number(r.episode)
                     );

                     if (ep !== 'NaN') {
                         setRecord(id, ep, r);
                     }
                 }

                 if (id === '11008') {
                     console.info(
                         '[애니기록] API 수신 회차:',
                         data.episodes
                             .map(r => r.episode)
                             .join(', ')
                     );
                 }

                 renderEpisodes();
             }
         );
     }

     // =========================================================
     // 전체 기록 조회
     // =========================================================

     function loadAllRecords(force = false) {
         if (
             loadingAll ||
             (
                 !force &&
                 Date.now() - lastAllFetch < 30000
             )
         ) {
             return;
         }

         loadingAll = true;

         api(
             'GET',
             {
                 key: KEY,
                 action: 'all',
                 _: Date.now()
             },

             (ok, data) => {
                 loadingAll = false;

                 if (
                     !ok ||
                     !Array.isArray(data?.records)
                 ) {
                     return;
                 }

                 for (const r of data.records) {
                     const id = String(
                         r.animeId ??
                         r.anime_id ??
                         ''
                     );

                     const ep = String(
                         Number(r.episode)
                     );

                     if (
                         id &&
                         ep !== 'NaN'
                     ) {
                         setRecord(id, ep, r);
                     }
                 }

                 lastAllFetch = Date.now();

                 if (page) {
                     renderEpisodes();
                 } else {
                     renderMain();
                 }
             }
         );
     }

     // =========================================================
     // 진행률 저장
     // =========================================================

     function saveProgress(
         id,
         ep,
         currentTime,
         duration,
         percent,
         finished
     ) {
         const old = record(id, ep);

         const done =
             finished || isDone(old);

         const next = setRecord(
             id,
             ep,
             {
                 animeId: id,
                 episode: ep,
                 title: animeTitle(),

                 currentTime: done
                     ? duration
                     : Math.max(
                         currentTime,
                         Number(old?.currentTime) || 0
                     ),

                 duration,

                 percent: done
                     ? 100
                     : Math.max(
                         percent,
                         Number(old?.percent) || 0
                     ),

                 completed: done
             }
         );

         renderEpisodes();

         const k = token(id, ep);

         if (activePosts.has(k)) {
             activePosts.set(k, next);
             return;
         }

         activePosts.set(k, null);

         const send = value => api(
             'POST',
             {
                 key: KEY,
                 ...value
             },

             ok => {
                 const queued =
                     activePosts.get(k);

                 if (!ok) {
                     console.warn(
                         '[애니기록] 서버 저장 실패',
                         k
                     );
                 }

                 if (queued) {
                     activePosts.set(k, null);
                     send(queued);
                 } else {
                     activePosts.delete(k);
                 }
             }
         );

         send(next);
     }

     function saveVideo(v, force = false) {
         const ctx = contexts.get(v);

         if (
             !ctx ||
             !page ||
             token(ctx.id, ctx.ep) !== pageKey
         ) {
             return;
         }

         const t = Number(v.currentTime);
         const d = Number(v.duration);

         if (
             !Number.isFinite(t) ||
             !Number.isFinite(d) ||
             d <= 0
         ) {
             return;
         }

         if (
             t < 1 &&
             !v.ended &&
             !record(ctx.id, ctx.ep)
         ) {
             return;
         }

         if (
             !force &&
             Date.now() - lastSave < 10000
         ) {
             return;
         }

         lastSave = Date.now();

         saveProgress(
             ctx.id,
             ctx.ep,
             t,
             d,
             t / d * 100,

             v.ended ||
             t / d * 100 >= DONE_AT
         );
     }

     // =========================================================
     // 이어보기 위치 복원
     // =========================================================

     function restoreSeek(v) {
         if (
             !page ||
             v.readyState < 1
         ) {
             return;
         }

         const s = readJSON(
             sessionStorage,
             SEEK_KEY,
             null
         );

         if (
             !s ||
             token(s.animeId, s.episode) !== pageKey
         ) {
             return;
         }

         if (
             Date.now() -
             Number(s.savedAt || 0) > 60000
         ) {
             sessionStorage.removeItem(SEEK_KEY);
             return;
         }

         const duration =
             Number(v.duration);

         if (
             !Number.isFinite(duration) ||
             duration <= 0
         ) {
             return;
         }

         const seekToken =
             `${pageKey}:${s.savedAt}`;

         if (
             restored.get(v) === seekToken
         ) {
             return;
         }

         try {
             const t = Math.max(
                 0,
                 Math.min(
                     Number(s.currentTime) || 0,
                     duration - 1
                 )
             );

             if (
                 Math.abs(
                     Number(v.currentTime) - t
                 ) > 1
             ) {
                 v.currentTime = t;
             }

             restored.set(
                 v,
                 seekToken
             );

             sessionStorage.removeItem(
                 SEEK_KEY
             );

         } catch (e) {
             console.warn(
                 '[애니기록] 이어보기 위치 오류',
                 e
             );
         }
     }

     // =========================================================
     // VIDEO 이벤트 연결
     // =========================================================

     function hookPlayers() {
         if (!page) return;

         document.querySelectorAll(
             'video'
         ).forEach(v => {
             video = v;

             const old =
                 contexts.get(v);

             if (
                 !old ||
                 token(old.id, old.ep) !== pageKey
             ) {
                 contexts.set(
                     v,
                     { ...page }
                 );

                 lastSave = 0;
             }

             if (!hooked.has(v)) {
                 hooked.add(v);

                 v.addEventListener(
                     'loadedmetadata',
                     () => restoreSeek(v)
                 );

                 v.addEventListener(
                     'canplay',
                     () => restoreSeek(v)
                 );

                 v.addEventListener(
                     'timeupdate',
                     () => saveVideo(v)
                 );

                 [
                     'pause',
                     'seeked',
                     'ended'
                 ].forEach(name => {
                     v.addEventListener(
                         name,
                         () => saveVideo(v, true)
                     );
                 });
             }

             restoreSeek(v);
         });
     }

     // =========================================================
     // 회차 목록 찾기
     // =========================================================

     function episodeSection() {
         const walker =
             document.createTreeWalker(
                 document.body,
                 NodeFilter.SHOW_TEXT
             );

         let n;

         while (
             (n = walker.nextNode())
         ) {
             if (
                 (n.nodeValue || '')
                     .replace(/\s+/g, ' ')
                     .trim() !== '회차 목록'
             ) {
                 continue;
             }

             let ancestor =
                 n.parentElement;

             for (
                 let i = 0;
                 ancestor && i < 12;
                 i++, ancestor = ancestor.parentElement
             ) {
                 if (
                     (
                         ancestor.textContent || ''
                     ).match(
                         /\d{1,4}\s*화/g
                     )?.length >= 3
                 ) {
                     return {
                         area: ancestor,
                         heading: n.parentElement
                     };
                 }
             }
         }

         return null;
     }

     // =========================================================
     // 회차 카드 인식
     // =========================================================

     function episodeFromElement(el) {
         const href =
             el.getAttribute?.('href') || '';

         const h = href.match(
             /\/content\/(\d+)\/(\d+)/
         );

         if (
             h &&
             page &&
             h[1] === page.id
         ) {
             return String(Number(h[2]));
         }

         const attr =
             el.getAttribute?.('data-episode') ||
             el.getAttribute?.('data-episode-number');

         if (
             attr &&
             /^\d{1,4}$/.test(attr)
         ) {
             return String(Number(attr));
         }

         const raw = (
             el.textContent || ''
         )
             .replace(
                 /[\u200b\u200c\u00a0]/g,
                 ''
             )
             .trim();

         const match = raw.match(
             /^(\d{1,4})\s*화/
         );

         if (match) {
             return String(
                 Number(match[1])
             );
         }

         const playing = raw.match(
             /^(\d{1,4})\s*재생\s*중/
         );

         if (playing) {
             return String(
                 Number(playing[1])
             );
         }

         if (
             /^\d{1,4}$/.test(raw)
         ) {
             return String(Number(raw));
         }

         const firstText = (
             el.querySelector?.(
                 'span,div,strong'
             )?.textContent || ''
         ).trim();

         if (
             /^\d{1,4}$/.test(firstText)
         ) {
             return String(
                 Number(firstText)
             );
         }

         return '';
     }

     // =========================================================
     // 회차 카드 후보 탐색
     // =========================================================

     function episodeCandidates() {
         const section = episodeSection();

         if (
             !section ||
             !page
         ) {
             return new Map();
         }

         const {
             area,
             heading
         } = section;

         const headingBottom =
             heading.getBoundingClientRect().bottom;

         const found = new Map();

         for (
             const el of area.querySelectorAll('*')
         ) {
             if (
                 el.closest(
                     '#anilife-episode-overlay-v89, [hidden], [aria-hidden="true"]'
                 )
             ) {
                 continue;
             }

             if (
                 el === heading ||
                 heading.contains(el) ||
                 !el.getClientRects().length
             ) {
                 continue;
             }

             const rect =
                 el.getBoundingClientRect();

             if (
                 rect.width < 60 ||
                 rect.width > 380 ||
                 rect.height < 24 ||
                 rect.height > 160
             ) {
                 continue;
             }

             if (
                 rect.top < headingBottom - 8
             ) {
                 continue;
             }

             const ep =
                 episodeFromElement(el);

             if (
                 !ep ||
                 !record(page.id, ep)
             ) {
                 continue;
             }

             const hits = (
                 el.textContent || ''
             ).match(
                 /\d{1,4}\s*화/g
             ) || [];

             if (
                 new Set(
                     hits.map(
                         x => x.match(/\d+/)?.[0]
                     )
                 ).size > 1
             ) {
                 continue;
             }

             const tag =
                 el.tagName.toLowerCase();

             const cls =
                 typeof el.className === 'string'
                     ? el.className
                     : '';

             let score =
                 100 -
                 Math.abs(
                     rect.width - 128
                 ) / 6 -
                 Math.abs(
                     rect.height - 58
                 ) / 3;

             if (
                 tag === 'button' ||
                 tag === 'a' ||
                 el.getAttribute('role') === 'button'
             ) {
                 score += 12;
             }

             if (
                 /rounded|border|cursor-pointer|episode|hover/.test(cls)
             ) {
                 score += 7;
             }

             if (
                 /^\d{1,4}$/.test(
                     (el.textContent || '').trim()
                 )
             ) {
                 score -= 8;
             }

             if (
                 !found.has(ep) ||
                 score > found.get(ep).score
             ) {
                 found.set(
                     ep,
                     {
                         rect,
                         score,
                         element: el
                     }
                 );
             }
         }

         return found;
     }

     // =========================================================
     // 회차 배지 레이어
     // =========================================================

     function overlay() {
         let root =
             document.getElementById(
                 'anilife-episode-overlay-v89'
             );

         if (!root) {
             root = document.createElement(
                 'div'
             );

             root.id =
                 'anilife-episode-overlay-v89';

             document.body.appendChild(root);
         }

         return root;
     }

     // =========================================================
     // 회차별 상단 단일 배지
     // =========================================================

     function renderEpisodes() {
         const root = overlay();

         if (!page) {
             root.replaceChildren();
             return;
         }

         const candidates =
             episodeCandidates();

         const visible = new Set();

         const fullscreen = Boolean(
             document.fullscreenElement ||
             fullTarget ||
             activeShortcutFullscreen()
         );

         for (
             const [ep, item] of candidates
         ) {
             const r = record(
                 page.id,
                 ep
             );

             if (!r) continue;

             let badge = root.querySelector(
                 `[data-episode="${ep}"]`
             );

             if (!badge) {
                 badge = document.createElement(
                     'span'
                 );

                 badge.className =
                     'anilife-episode-overlay-badge';

                 badge.dataset.episode = ep;

                 root.appendChild(badge);
             }

             badge.textContent = isDone(r)
                 ? '✓100%'
                 : `▶${Math.round(r.percent)}%`;

             badge.dataset.done =
                 isDone(r) ? '1' : '0';

             const { rect } = item;

             badge.style.left =
                 Math.round(
                     rect.right - 58
                 ) + 'px';

             badge.style.top =
                 Math.round(
                     rect.top + 8
                 ) + 'px';

             badge.style.display =
                 fullscreen ||
                 rect.bottom <= 0 ||
                 rect.top >= innerHeight
                     ? 'none'
                     : 'inline-block';

             visible.add(ep);
         }

         root.querySelectorAll(
             '[data-episode]'
         ).forEach(el => {
             if (
                 !visible.has(
                     el.dataset.episode
                 )
             ) {
                 el.remove();
             }
         });

         if (page.id === '11008') {
             const report = [
                 '14',
                 '15',
                 '16'
             ].map(ep =>
                 `${ep}화: ${
                     record(page.id, ep)
                         ? '기록 있음'
                         : '기록 없음'
                 }, ${
                     candidates.has(ep)
                         ? '카드 탐지'
                         : '카드 미탐지'
                 }`
             ).join(' / ');

             if (report !== lastDiagnosis) {
                 lastDiagnosis = report;

                 console.info(
                     '[애니기록] 회차 카드 진단:',
                     report
                 );
             }
         }
     }

     // =========================================================
     // 메인 카드 정보
     // =========================================================

     function mainCardInfo(card) {
         let id = '';

         for (
             const a of card.querySelectorAll(
                 'a[href]'
             )
         ) {
             const m = (
                 a.getAttribute('href') || ''
             ).match(
                 /\/content\/(\d+)\/\d+/
             );

             if (m) {
                 id = m[1];
                 break;
             }
         }

         if (!id) {
             const p =
                 Object.keys(card).find(
                     k => k.startsWith(
                         '__reactFiber$'
                     )
                 );

             for (
                 let f = p && card[p], i = 0;
                 f && i < 12;
                 f = f.return, i++
             ) {
                 if (
                     /^\d+$/.test(
                         String(f.key)
                     )
                 ) {
                     id = String(f.key);
                     break;
                 }
             }
         }

         const m = card.querySelector(
             'span.episode'
         )?.textContent?.match(
             /^(\d+)\s*화/
         );

         return id && m
             ? {
                 id,
                 latest: String(
                     Number(m[1])
                 )
             }
             : null;
     }

     // =========================================================
     // 이어보기 회차 계산
     // =========================================================

     function nextEpisode(id, latest) {
         const records =
             all[id] || {};

         const newest =
             record(id, latest);

         if (newest) {
             return isDone(newest)
                 ? null
                 : {
                     ep: String(latest),
                     time:
                         Number(
                             newest.currentTime
                         ) || 0
                 };
         }

         const numbers =
             Object.keys(records)
                 .map(Number)
                 .filter(Number.isFinite);

         const lastComplete = Math.max(
             0,
             ...numbers.filter(
                 n => isDone(records[n])
             )
         );

         const partial = numbers
             .filter(
                 n =>
                     n > lastComplete &&
                     !isDone(records[n]) &&
                     Number(
                         records[n].percent
                     ) > 0
             )
             .sort(
                 (a, b) => a - b
             )[0];

         const ep =
             partial || lastComplete + 1;

         return ep <= Number(latest)
             ? {
                 ep: String(ep),

                 time: partial
                     ? Number(
                         records[partial].currentTime
                     ) || 0
                     : 0
             }
             : null;
     }

     // =========================================================
     // 메인 화면 배지
     // =========================================================

     function renderMain() {
         if (page) return;

         document.querySelectorAll(
             'article.anime-card'
         ).forEach(card => {
             const meta =
                 mainCardInfo(card);

             const wrap =
                 card.querySelector(
                     '.poster-wrap'
                 );

             if (
                 !meta ||
                 !wrap
             ) {
                 return;
             }

             const records =
                 all[meta.id] || {};

             const r = record(
                 meta.id,
                 meta.latest
             );

             let badge = wrap.querySelector(
                 ':scope > .anilife-main-badge-v89'
             );

             if (
                 !r &&
                 !Object.keys(records).length
             ) {
                 badge?.remove();
                 return;
             }

             if (!badge) {
                 badge =
                     document.createElement('div');

                 badge.className =
                     'anilife-main-badge-v89';

                 wrap.appendChild(badge);
             }

             const next = nextEpisode(
                 meta.id,
                 meta.latest
             );

             badge.textContent = r
                 ? (
                     isDone(r)
                         ? '✓ 완료'
                         : `▶ ${Math.round(r.percent)}%`
                 )
                 : (
                     '▶ 시청 필요 · ' +
                     (next?.ep || '1') +
                     '화부터'
                 );

             badge.dataset.done =
                 r && isDone(r) ? '1' : '0';
         });
     }

     // =========================================================
     // 이어보기 팝업
     // =========================================================

     function showPrompt(meta, next) {
         if (promptOpen) return;

         promptOpen = true;

         const layer =
             document.createElement('div');

         layer.className =
             'anilife-continue-layer-v89';

         const box =
             document.createElement('div');

         box.className =
             'anilife-continue-box-v89';

         const heading =
             document.createElement('strong');

         heading.textContent =
             next.ep === '1'
                 ? '1화부터 시청하시겠습니까?'
                 : '이어보기를 하시겠습니까?';

         const message =
             document.createElement('p');

         message.textContent =
             `${next.ep}화 ` +
             (
                 next.time > 0
                     ? timeText(next.time) +
                       '부터'
                     : '부터'
             ) +
             ' 시청합니다.';

         const yes =
             document.createElement('button');

         const no =
             document.createElement('button');

         yes.textContent = '네';
         no.textContent = '아니오';
         no.className = 'no';

         const close = () => {
             promptOpen = false;
             layer.remove();
         };

         yes.onclick = () => {
             close();

             if (next.time > 0) {
                 sessionStorage.setItem(
                     SEEK_KEY,
                     JSON.stringify({
                         animeId: meta.id,
                         episode: next.ep,
                         currentTime: next.time,
                         savedAt: Date.now()
                     })
                 );
             } else {
                 sessionStorage.removeItem(
                     SEEK_KEY
                 );
             }

             location.href =
                 `${location.origin}/content/` +
                 `${meta.id}/${next.ep}`;
         };

         no.onclick = () => {
             close();

             sessionStorage.removeItem(
                 SEEK_KEY
             );

             location.href =
                 `${location.origin}/content/` +
                 `${meta.id}/${meta.latest}`;
         };

         box.append(
             heading,
             message,
             yes,
             no
         );

         layer.append(box);
         document.body.append(layer);
     }

     // =========================================================
     // 메인 카드 클릭
     // =========================================================

     document.addEventListener(
         'click',
         e => {
             if (page) return;

             const target =
                 e.target?.nodeType === 1
                     ? e.target
                     : e.target?.parentElement;

             const card = target?.closest?.(
                 'article.anime-card'
             );

             if (
                 !card ||
                 target.closest(
                     '.bookmark,' +
                     '.bookmark-button,' +
                     '.favorite,' +
                     '.favorite-button,' +
                     '[aria-label*="북마크"]'
                 )
             ) {
                 return;
             }

             const meta =
                 mainCardInfo(card);

             if (!meta) return;

             const next =
                 nextEpisode(
                     meta.id,
                     meta.latest
                 );

             if (!next) return;

             e.preventDefault();
             e.stopPropagation();
             e.stopImmediatePropagation?.();

             showPrompt(meta, next);
         },
         true
     );

     // =========================================================
     // 숫자패드 v2.2와 호환되는 웹 전체화면
     // =========================================================

     function playerElement() {
         const v =
             video?.isConnected
                 ? video
                 : document.querySelector(
                     'video'
                 );

         const embed =
             v ||
             document.querySelector(
                 'iframe[src]'
             );

         if (!embed) return null;

         return embed.closest(
             '.artplayer,' +
             '.dplayer,' +
             '.plyr,' +
             '.video-js,' +
             '.jwplayer,' +
             '.xgplayer,' +
             '[class*="player-container"],' +
             '[class*="video-player"],' +
             '[class*="video-container"]'
         ) || embed.parentElement;
     }

     // 숫자패드 스크립트의 전체화면 상태 확인
     function activeShortcutFullscreen() {
         const el =
             document.querySelector(
                 '.' + SHORTCUT_FULLSCREEN
             );

         return Boolean(
             el?.isConnected &&
             el.getClientRects().length
         );
     }

     function looksFull() {
         if (
             document.fullscreenElement ||
             activeShortcutFullscreen()
         ) {
             return true;
         }

         const el = playerElement();

         if (!el) return false;

         const r =
             el.getBoundingClientRect();

         const st =
             getComputedStyle(el);

         return (
             r.width >= innerWidth * .88 &&
             r.height >= innerHeight * .82 &&
             Math.abs(r.left) < 25 &&
             Math.abs(r.top) < 25 &&
             (
                 st.position === 'fixed' ||
                 /fullpage|fullscreen|theater/i.test(
                     String(el.className)
                 )
             )
         );
     }

     // =========================================================
     // 자동 전체화면 CSS 제거
     // =========================================================

     function clearAutoFull() {
         document.querySelectorAll(
             '.' + AUTO_FULLSCREEN
         ).forEach(el => {
             el.classList.remove(
                 AUTO_FULLSCREEN
             );
         });

         document.documentElement
             .classList.remove(
                 AUTO_HTML_CLASS
             );

         fullTarget = null;
     }

     // =========================================================
     // 두 스크립트의 웹 전체화면 함께 해제
     // =========================================================

     function turnOffFull() {
         fullHold = false;
         fullOrigin = '';

         sessionStorage.removeItem(
             FULL_KEY
         );

         // 시청기록 자동 전체화면 해제
         clearAutoFull();

         // 숫자패드 스크립트 전체화면 해제
         document.querySelectorAll(
             '.' + SHORTCUT_FULLSCREEN
         ).forEach(el => {
             el.classList.remove(
                 SHORTCUT_FULLSCREEN
             );
         });

         document.documentElement
             .classList.remove(
                 SHORTCUT_HTML_CLASS
             );
     }

     // =========================================================
     // 전체화면 ON 상태 기억
     // =========================================================

     function detectFull() {
         if (
             !page ||
             fullHold
         ) {
             return;
         }

         if (looksFull()) {
             fullHold = true;
             fullOrigin = pageKey;

             sessionStorage.setItem(
                 FULL_KEY,
                 '1'
             );
         }
     }

     // =========================================================
     // 다음 화에서 자동 전체화면 적용
     // =========================================================

     function applyFull() {
         if (
             !page ||
             !fullHold
         ) {
             clearAutoFull();
             return;
         }

         // 숫자패드 스크립트가 이미
         // 전체화면을 켰다면 중복 적용하지 않음
         if (activeShortcutFullscreen()) {
             clearAutoFull();
             return;
         }

         // 처음 직접 전체화면을 켠 회차는
         // 기존 플레이어 상태를 유지
         if (
             fullOrigin === pageKey &&
             looksFull()
         ) {
             return;
         }

         const el =
             playerElement();

         if (!el) return;

         if (
             fullTarget &&
             fullTarget !== el
         ) {
             clearAutoFull();
         }

         fullTarget = el;

         el.classList.add(
             AUTO_FULLSCREEN
         );

         document.documentElement
             .classList.add(
                 AUTO_HTML_CLASS
             );
     }

     // =========================================================
     // 핵심 수정
     // 숫자패드 8 웹 전체화면 토글 충돌 방지
     // =========================================================

     // 숫자패드 v2.2는 document 캡처에서
     // stopImmediatePropagation()을 사용함.
     //
     // 따라서 window 캡처에서 먼저 감지하여
     // 전체화면 해제만 처리.
     //
     // 전체화면을 켜는 동작은 기존
     // 숫자패드 v2.2 스크립트에 맡김.

     window.addEventListener(
         'keydown',
         function (e) {
             if (
                 !page ||
                 e.repeat ||
                 e.code !== 'Numpad8'
             ) {
                 return;
             }

             if (
                 e.ctrlKey ||
                 e.altKey ||
                 e.metaKey
             ) {
                 return;
             }

             const target = e.target;

             if (
                 target instanceof HTMLInputElement ||
                 target instanceof HTMLTextAreaElement ||
                 target?.isContentEditable
             ) {
                 return;
             }

             // 웹 전체화면이 켜져 있다면
             // 두 스크립트 상태를 함께 해제
             if (
                 fullHold ||
                 fullTarget ||
                 document.documentElement
                     .classList.contains(
                         AUTO_HTML_CLASS
                     )
             ) {
                 e.preventDefault();
                 e.stopPropagation();
                 e.stopImmediatePropagation();

                 turnOffFull();
             }

             // 전체화면이 꺼져 있다면
             // 키 입력을 차단하지 않음.
             // 숫자패드 v2.2가 켜는 동작을 수행.
         },
         true
     );

     // =========================================================
     // 사이트 자체 전체화면 버튼 감지
     // =========================================================

     document.addEventListener(
         'click',
         e => {
             if (!page) return;

             const el =
                 e.target?.closest?.(
                     'button,' +
                     '[role="button"],' +
                     '[title],' +
                     '[aria-label]'
                 );

             if (!el) return;

             const text = [
                 el.getAttribute('title'),
                 el.getAttribute('aria-label'),
                 el.getAttribute('data-tooltip'),

                 typeof el.className === 'string'
                     ? el.className
                     : ''
             ]
                 .filter(Boolean)
                 .join(' ');

             if (
                 !/웹\s*전체\s*화면|web.?full.?screen|fullpage|theater|fullscreen/i
                     .test(text)
             ) {
                 return;
             }

             setTimeout(
                 () => {
                     if (looksFull()) {
                         detectFull();

                     } else if (fullHold) {
                         turnOffFull();
                     }
                 },
                 500
             );
         },
         true
     );

     document.addEventListener(
         'fullscreenchange',
         () => {
             if (
                 document.fullscreenElement
             ) {
                 detectFull();
             }
         }
     );

     // =========================================================
     // 수동 완료 처리
     // =========================================================

     function markComplete(ep) {
         if (!page) return;

         const r =
             record(page.id, ep) || {};

         const d = Number(
             r.duration ||
             r.currentTime
         ) || 0;

         saveProgress(
             page.id,
             String(ep),
             d,
             d,
             100,
             true
         );
     }

     // =========================================================
     // 현재 회차 기록 삭제
     // =========================================================

     function deleteCurrent() {
         if (!page) return;

         const { id, ep } = page;

         api(
             'POST',
             {
                 action: 'delete',
                 key: KEY,
                 animeId: id,
                 episode: ep
             },

             ok => {
                 if (!ok) return;

                 if (all[id]) {
                     delete all[id][ep];
                 }

                 remember();
                 renderEpisodes();

                 console.info(
                     '[애니기록] 기록 삭제 완료:',
                     ep + '화'
                 );
             }
         );
     }

     // =========================================================
     // 단축키
     // =========================================================

     document.addEventListener(
         'keydown',
         e => {
             if (
                 !page ||
                 e.repeat
             ) {
                 return;
             }

             // ESC: 웹 전체화면 유지 해제
             if (
                 e.key === 'Escape' &&
                 fullHold
             ) {
                 turnOffFull();
                 return;
             }

             // Ctrl + Alt + W
             // 회차 범위 완료 처리
             if (
                 e.ctrlKey &&
                 e.altKey &&
                 e.code === 'KeyW'
             ) {
                 e.preventDefault();

                 const answer = prompt(
                     '이미 시청한 회차 범위 (예: 14-16)',
                     ''
                 );

                 if (!answer) return;

                 const m = answer.trim().match(
                     /^(\d+)(?:\s*[-~]\s*(\d+))?$/
                 );

                 if (!m) return;

                 const a = Number(m[1]);
                 const b = Number(
                     m[2] || m[1]
                 );

                 if (
                     a < 1 ||
                     b < a ||
                     b - a >= 50
                 ) {
                     return;
                 }

                 if (
                     !confirm(
                         `${a}~${b}화를 완료로 저장할까요?`
                     )
                 ) {
                     return;
                 }

                 for (
                     let ep = a;
                     ep <= b;
                     ep++
                 ) {
                     markComplete(ep);
                 }

                 return;
             }

             // 숫자패드 +
             if (
                 e.code === 'NumpadAdd'
             ) {
                 e.preventDefault();

                 if (e.shiftKey) {
                     markComplete(page.ep);

                 } else if (video) {
                     saveVideo(video, true);
                 }

                 return;
             }

             // 숫자패드 -
             if (
                 e.code === 'NumpadSubtract'
             ) {
                 e.preventDefault();
                 deleteCurrent();
             }
         },
         true
     );

     // =========================================================
     // CSS
     // =========================================================

     const style =
         document.createElement('style');

     style.textContent = `

         /* 기존 하단 중복 진행률 숨김 */
         html body .anilife-episode-progress::after,
         html body .anilife-unified-status::after {
             content: none !important;
             display: none !important;
         }

         html body .anilife-episode-status-badge,
         html body .anilife-progress-chip,
         html body .anilife-progress-floating,
         html body .anilife-progress-badge,
         html body .anilife-fix-complete {
             display: none !important;
         }

         /* 회차 상단 진행률 배지 */
         #anilife-episode-overlay-v89 {
             position: fixed !important;
             inset: 0 !important;
             width: 0 !important;
             height: 0 !important;
             pointer-events: none !important;
             overflow: visible !important;
             z-index: 2147482000 !important;
         }

         .anilife-episode-overlay-badge {
             position: fixed !important;
             padding: 1px 2px !important;
             background: rgba(15,17,21,.9) !important;
             border-radius: 3px !important;
             color: #ffc107 !important;
             font: 800 11px/16px system-ui,sans-serif !important;
             white-space: nowrap !important;
             pointer-events: none !important;
         }

         .anilife-episode-overlay-badge[data-done="1"] {
             color: #20c997 !important;
         }

         /* 메인 화면 배지 */
         .poster-wrap {
             position: relative !important;
         }

         .anilife-main-badge-v89 {
             position: absolute !important;
             right: 7px !important;
             bottom: 40px !important;
             background: #e67e22 !important;
             color: #fff !important;
             z-index: 99 !important;
             border-radius: 7px !important;
             padding: 7px 9px !important;
             font: 800 12px system-ui,sans-serif !important;
             pointer-events: none !important;
         }

         .anilife-main-badge-v89[data-done="1"] {
             background: #129447 !important;
         }

         /* 시청기록 자동 웹 전체화면 */
         html.anilife-full-active-v89,
         html.anilife-full-active-v89 body {
             overflow: hidden !important;
         }

         html.anilife-full-active-v89 .anilife-full-stage-v89 {
             position: fixed !important;
             inset: 0 !important;
             width: 100vw !important;
             height: 100dvh !important;
             max-width: none !important;
             max-height: none !important;
             margin: 0 !important;
             padding: 0 !important;
             background: #000 !important;
             z-index: 2147483000 !important;
         }

         html.anilife-full-active-v89 .anilife-full-stage-v89 video {
             width: 100% !important;
             height: 100% !important;
             object-fit: contain !important;
         }

         /* 이어보기 팝업 */
         .anilife-continue-layer-v89 {
             position: fixed !important;
             inset: 0 !important;
             display: grid !important;
             place-items: center !important;
             z-index: 2147483640 !important;
             background: rgba(0,0,0,.75) !important;
         }

         .anilife-continue-box-v89 {
             width: 350px !important;
             max-width: 90vw !important;
             padding: 26px !important;
             border: 1px solid #444 !important;
             border-radius: 12px !important;
             box-sizing: border-box !important;
             background: #202024 !important;
             color: #fff !important;
             text-align: center !important;
         }

         .anilife-continue-box-v89 strong {
             display: block !important;
             font-size: 18px !important;
         }

         .anilife-continue-box-v89 p {
             margin: 18px 0 !important;
         }

         .anilife-continue-box-v89 button {
             width: 110px !important;
             padding: 10px !important;
             margin: 0 5px !important;
             border: 0 !important;
             border-radius: 7px !important;
             background: #129447 !important;
             color: white !important;
             cursor: pointer !important;
         }

         .anilife-continue-box-v89 button.no {
             background: #444 !important;
         }

     `;

     (
         document.head ||
         document.documentElement
     ).appendChild(style);

     // =========================================================
     // 페이지 이동 감지
     // =========================================================

     function tick() {
         const now = current();

         const nextKey = now
             ? token(now.id, now.ep)
             : '';

         if (nextKey !== pageKey) {
             pageKey = nextKey;
             page = now;
             video = null;
             lastSave = 0;
             lastDiagnosis = '';

             generation++;

             clearAutoFull();

             if (now) {
                 loadEpisodeRecords();
                 loadAllRecords(true);
             } else {
                 loadAllRecords(true);
             }
         }

         if (page) {
             hookPlayers();
             renderEpisodes();

             // 기존 또는 숫자패드 전체화면 감지
             detectFull();

             // 다음 화에서 전체화면 자동 복원
             if (fullHold) {
                 applyFull();
             }

         } else {
             document.getElementById(
                 'anilife-episode-overlay-v89'
             )?.replaceChildren();

             renderMain();
             loadAllRecords();
         }
     }

     // =========================================================
     // 페이지 숨김 / 종료 시 기록 저장
     // =========================================================

     document.addEventListener(
         'visibilitychange',
         () => {
             if (
                 document.hidden &&
                 video &&
                 page
             ) {
                 saveVideo(
                     video,
                     true
                 );
             }
         }
     );

     window.addEventListener(
         'pagehide',
         () => {
             if (
                 video &&
                 page
             ) {
                 saveVideo(
                     video,
                     true
                 );
             }
         }
     );

     // =========================================================
     // 스크롤 / 창 크기 변경 시 배지 위치 조정
     // =========================================================

     window.addEventListener(
         'scroll',
         () => {
             if (page) {
                 renderEpisodes();
             }
         },
         { passive: true }
     );

     window.addEventListener(
         'resize',
         () => {
             if (page) {
                 renderEpisodes();
             }
         }
     );

     // =========================================================
     // 실행
     // =========================================================

     tick();

     setInterval(
         tick,
         1000
     );

 })();
