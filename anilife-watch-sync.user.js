// ==UserScript==
// @name         애니라이프 시청기록 자동 동기화
// @namespace    https://github.com/LeeBaroo/tampermonkey-scripts
// @version      7.0
// @description  시청기록 저장 + 진행률 + 시청필요 + 메인 이어보기 + 재생위치 복원 + 기록 삭제
// @match        *://anilife01.tv/*
// @match        *://*.anilife01.tv/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/LeeBaroo/tampermonkey-scripts/main/anilife-watch-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/LeeBaroo/tampermonkey-scripts/main/anilife-watch-sync.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 설정 / 상태
    // =========================================================

    const API_URL = 'https://script.google.com/macros/s/AKfycbxgN5zZYdlBdCuDPVBmHpFQvdZax-ubhGqOAc4Wrxgtm6j7ZiRhGAVUvR2oWI_3cOOb/exec';
    const API_KEY = 'anilife-my-secret-2026';
    const SAVE_INTERVAL = 10;
    const COMPLETE_PERCENT = 95;
    const MAIN_CACHE_KEY = 'anilife-watch-history-cache-v1';
    const RESUME_SEEK_KEY = 'anilife-resume-seek-v1';

    let animeId = '';
    let episode = '';
    let histories = {};
    let currentVideo = null;
    let lastSaveTime = 0;
    let lastUrl = '';
    let suppressedSaveKey = '';

    let allHistories = {};
    let allHistoryLoading = false;
    let allHistoryLoaded = false;
    let lastAllHistoryLoad = 0;

    let continuePromptOpen = false;

    const videoContexts = new WeakMap();

    // =========================================================
    // CSS
    // =========================================================

    function installStyle() {
        if (document.getElementById('anilife-watch-style')) return;

        const style = document.createElement('style');
        style.id = 'anilife-watch-style';

        style.textContent = `
.anilife-episode-progress::after {
    content: attr(data-anilife-progress);
    display: inline-block !important;
    margin-left: 7px !important;
    font-size: 11px !important;
    font-weight: 700 !important;
    white-space: nowrap !important;
    color: #ffc107 !important;
}

.anilife-episode-progress[data-anilife-complete="1"]::after {
    color: #20c997 !important;
}

.poster-wrap.anilife-main-has-progress {
    position: relative !important;
}

.anilife-main-progress-badge {
    position: absolute !important;
    right: 7px !important;
    bottom: 40px !important;
    z-index: 100 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-width: 66px !important;
    height: 29px !important;
    padding: 0 9px !important;
    box-sizing: border-box !important;
    border-radius: 7px !important;
    font-size: 14px !important;
    font-weight: 800 !important;
    line-height: 29px !important;
    white-space: nowrap !important;
    color: #111111 !important;
    background: #ffb300 !important;
    border: 1px solid rgba(255,255,255,0.80) !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.85) !important;
    pointer-events: none !important;
}

.anilife-main-progress-badge[data-anilife-complete="1"] {
    color: #ffffff !important;
    background: #129447 !important;
    border: 1px solid #67df91 !important;
}

.anilife-main-progress-badge[data-anilife-status="need-watch"] {
    color: #ffffff !important;
    background: #e67e22 !important;
    border: 1px solid #ffbd73 !important;
    height: auto !important;
    min-height: 42px !important;
    min-width: 86px !important;
    padding: 5px 8px !important;
    flex-direction: column !important;
    line-height: 1.15 !important;
}

.anilife-main-progress-title {
    display: block !important;
    font-size: 13px !important;
    font-weight: 800 !important;
    line-height: 16px !important;
}

.anilife-main-progress-sub {
    display: block !important;
    margin-top: 2px !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    line-height: 13px !important;
    white-space: nowrap !important;
}

.anilife-continue-overlay {
    position: fixed !important;
    inset: 0 !important;
    z-index: 999999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: rgba(0,0,0,0.68) !important;
}

.anilife-continue-dialog {
    width: 350px !important;
    padding: 26px 24px 22px !important;
    box-sizing: border-box !important;
    border-radius: 12px !important;
    background: #1c1c1f !important;
    border: 1px solid #3a3a40 !important;
    box-shadow: 0 10px 40px rgba(0,0,0,0.65) !important;
    text-align: center !important;
    color: #ffffff !important;
}

.anilife-continue-title {
    margin-bottom: 10px !important;
    font-size: 18px !important;
    font-weight: 800 !important;
}

.anilife-continue-message {
    margin-bottom: 22px !important;
    font-size: 14px !important;
    line-height: 1.6 !important;
    color: #cccccc !important;
}

.anilife-continue-message strong {
    color: #20c997 !important;
    font-size: 16px !important;
}

.anilife-continue-buttons {
    display: flex !important;
    gap: 10px !important;
    justify-content: center !important;
}

.anilife-continue-buttons button {
    width: 120px !important;
    height: 40px !important;
    border-radius: 7px !important;
    border: 1px solid #555555 !important;
    font-size: 14px !important;
    font-weight: 700 !important;
    cursor: pointer !important;
}

.anilife-continue-yes {
    color: #ffffff !important;
    background: #129447 !important;
}

.anilife-continue-no {
    color: #dddddd !important;
    background: #333337 !important;
}

.anilife-continue-yes:focus,
.anilife-continue-no:focus {
    outline: 3px solid #67df91 !important;
    outline-offset: 3px !important;
}
`;

        document.head.appendChild(style);
    }

    // =========================================================
    // 공통
    // =========================================================

    function getCurrentPageInfo() {
        const match = location.pathname.match(/^\/content\/(\d+)\/(\d+)/);

        if (!match) return null;

        return {
            animeId: String(match[1]),
            episode: String(match[2])
        };
    }

    function isWatchPage() {
        return getCurrentPageInfo() !== null;
    }

    function toBoolean(value) {
        return value === true || String(value).toLowerCase() === 'true';
    }

    function getSaveKey(id, ep) {
        return String(id) + ':' + String(ep);
    }

    function getAnimeTitle() {
        let title = '';

        const h1 = document.querySelector('h1');

        if (h1) title = h1.textContent.trim();
        if (!title) title = document.title || '';

        return title
            .replace(/\s+\d+\s*화.*$/, '')
            .replace(/\s*\|\s*애니라이프.*$/, '')
            .trim();
    }

    function formatTime(seconds) {
        seconds = Math.floor(Number(seconds) || 0);

        const hour = Math.floor(seconds / 3600);
        const minute = Math.floor((seconds % 3600) / 60);
        const second = seconds % 60;

        if (hour > 0) {
            return hour + ':' +
                String(minute).padStart(2, '0') + ':' +
                String(second).padStart(2, '0');
        }

        return minute + ':' + String(second).padStart(2, '0');
    }

    function goEpisode(targetAnimeId, targetEpisode) {
        location.href =
            location.origin +
            '/content/' +
            encodeURIComponent(String(targetAnimeId)) +
            '/' +
            encodeURIComponent(String(targetEpisode));
    }

    // =========================================================
    // 표시 제거
    // =========================================================

    function clearWatchLabels() {
        document.querySelectorAll('.anilife-episode-progress').forEach(function (element) {
            element.classList.remove('anilife-episode-progress');
            element.removeAttribute('data-anilife-progress');
            element.removeAttribute('data-anilife-complete');
        });

        document.querySelectorAll('.anilife-player-watch-info').forEach(function (element) {
            element.remove();
        });
    }

    function clearMainLabels() {
        document.querySelectorAll('.anilife-main-progress-badge').forEach(function (element) {
            element.remove();
        });

        document.querySelectorAll('.anilife-main-has-progress').forEach(function (element) {
            element.classList.remove('anilife-main-has-progress');
        });
    }

    // =========================================================
    // 현재 작품 조회
    // =========================================================

    function loadHistory() {
        if (!API_KEY || !animeId) return;

        const requestedAnimeId = animeId;

        const url =
            API_URL +
            '?key=' + encodeURIComponent(API_KEY) +
            '&animeId=' + encodeURIComponent(requestedAnimeId) +
            '&_=' + Date.now();

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,

            onload: function (response) {
                try {
                    const current = getCurrentPageInfo();

                    if (!current || current.animeId !== requestedAnimeId) return;

                    const data = JSON.parse(response.responseText);

                    if (!data || !data.ok) {
                        console.error('[애니기록] 조회 API 오류', data);
                        return;
                    }

                    histories = {};

                    (data.episodes || []).forEach(function (item) {
                        const ep = String(item.episode);

                        histories[ep] = {
                            animeId: String(item.animeId || ''),
                            title: String(item.title || ''),
                            episode: ep,
                            currentTime: Number(item.currentTime) || 0,
                            duration: Number(item.duration) || 0,
                            percent: Number(item.percent) || 0,
                            completed: toBoolean(item.completed)
                        };
                    });

                    refreshLabels();

                } catch (e) {
                    console.error('[애니기록] 조회 오류', e);
                }
            },

            onerror: function (error) {
                console.error('[애니기록] Google 조회 실패', error);
            }
        });
    }

    // =========================================================
    // 메인 캐시
    // =========================================================

    function loadLocalMainCache() {
        try {
            const text = localStorage.getItem(MAIN_CACHE_KEY);

            if (!text) return;

            const data = JSON.parse(text);

            if (!data || !data.histories) return;

            allHistories = data.histories;
            allHistoryLoaded = true;

        } catch (e) {
            console.error('[애니 메인] 캐시 읽기 오류', e);
        }
    }

    function saveLocalMainCache() {
        try {
            localStorage.setItem(
                MAIN_CACHE_KEY,
                JSON.stringify({
                    savedAt: Date.now(),
                    histories: allHistories
                })
            );

        } catch (e) {
            console.error('[애니 메인] 캐시 저장 오류', e);
        }
    }

    // =========================================================
    // 전체 기록 조회
    // =========================================================

    function loadAllHistory(force) {
        if (!API_KEY || allHistoryLoading) return;

        const now = Date.now();

        if (
            !force &&
            allHistoryLoaded &&
            now - lastAllHistoryLoad < 30000
        ) {
            return;
        }

        allHistoryLoading = true;

        const url =
            API_URL +
            '?key=' + encodeURIComponent(API_KEY) +
            '&action=all&_=' + now;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,

            onload: function (response) {
                allHistoryLoading = false;

                try {
                    const data = JSON.parse(response.responseText);

                    if (
                        !data ||
                        !data.ok ||
                        !Array.isArray(data.records)
                    ) {
                        console.error('[애니 메인] 전체 조회 오류', data);
                        return;
                    }

                    const newHistory = {};

                    data.records.forEach(function (item) {
                        const id = String(item.animeId || '');
                        const ep = String(item.episode || '');

                        if (!id || !ep) return;

                        if (!newHistory[id]) {
                            newHistory[id] = {};
                        }

                        newHistory[id][ep] = {
                            animeId: id,
                            episode: ep,
                            title: String(item.title || ''),
                            currentTime: Number(item.currentTime) || 0,
                            duration: Number(item.duration) || 0,
                            percent: Number(item.percent) || 0,
                            completed: toBoolean(item.completed)
                        };
                    });

                    allHistories = newHistory;
                    allHistoryLoaded = true;
                    lastAllHistoryLoad = Date.now();

                    saveLocalMainCache();
                    updateMainCards();

                } catch (e) {
                    console.error(
                        '[애니 메인] 전체 JSON 오류',
                        e,
                        response.responseText
                    );
                }
            },

            onerror: function (error) {
                allHistoryLoading = false;

                console.error(
                    '[애니 메인] 전체 조회 실패',
                    error
                );
            }
        });
    }

    // =========================================================
    // 기록 저장
    // =========================================================

    function saveProgress(
        saveAnimeId,
        saveEpisode,
        currentTime,
        duration,
        percent,
        completed
    ) {
        if (!API_KEY) return;

        suppressedSaveKey = '';

        const data = {
            key: API_KEY,
            animeId: saveAnimeId,
            title: getAnimeTitle(),
            episode: saveEpisode,
            currentTime: Math.floor(currentTime),
            duration: Math.floor(duration),
            percent: Math.round(percent * 10) / 10,
            completed: completed
        };

        if (animeId === saveAnimeId) {
            histories[saveEpisode] = {
                animeId: saveAnimeId,
                title: data.title,
                episode: saveEpisode,
                currentTime: data.currentTime,
                duration: data.duration,
                percent: data.percent,
                completed: data.completed
            };

            refreshLabels();
        }

        if (!allHistories[saveAnimeId]) {
            allHistories[saveAnimeId] = {};
        }

        allHistories[saveAnimeId][saveEpisode] = {
            animeId: saveAnimeId,
            title: data.title,
            episode: saveEpisode,
            currentTime: data.currentTime,
            duration: data.duration,
            percent: data.percent,
            completed: data.completed
        };

        allHistoryLoaded = true;

        saveLocalMainCache();

        GM_xmlhttpRequest({
            method: 'POST',
            url: API_URL,

            headers: {
                'Content-Type': 'application/json'
            },

            data: JSON.stringify(data),

            onload: function () {
                console.log(
                    '[애니기록] 저장 완료',
                    saveEpisode + '화',
                    data.percent + '%',
                    formatTime(data.currentTime)
                );
            },

            onerror: function (error) {
                console.error(
                    '[애니기록] 저장 실패',
                    error
                );
            }
        });
    }

    // =========================================================
    // 숫자패드 + : 현재 위치 강제 덮어쓰기
    // =========================================================

    function overwriteCurrentProgress() {
        if (!isWatchPage()) return;

        const video =
            currentVideo ||
            document.querySelector('video');

        const info =
            getCurrentPageInfo();

        if (!video || !info) return;

        const currentTime =
            Number(video.currentTime);

        const duration =
            Number(video.duration);

        if (
            !Number.isFinite(currentTime) ||
            !Number.isFinite(duration) ||
            duration <= 0
        ) {
            return;
        }

        suppressedSaveKey = '';

        videoContexts.set(
            video,
            {
                animeId: info.animeId,
                episode: info.episode
            }
        );

        const percent =
            (currentTime / duration) * 100;

        saveProgress(
            info.animeId,
            info.episode,
            currentTime,
            duration,
            percent,
            percent >= COMPLETE_PERCENT
        );

        lastSaveTime =
            Date.now();

        console.log(
            '[애니기록] 강제 덮어쓰기',
            info.episode + '화',
            formatTime(currentTime)
        );
    }

    // =========================================================
    // 숫자패드 - : 현재 회차 기록 삭제
    // =========================================================

    function deleteCurrentHistory() {
        const info =
            getCurrentPageInfo();

        if (!info) return;

        GM_xmlhttpRequest({
            method: 'POST',
            url: API_URL,

            headers: {
                'Content-Type': 'application/json'
            },

            data: JSON.stringify({
                action: 'delete',
                key: API_KEY,
                animeId: info.animeId,
                episode: info.episode
            }),

            onload: function (response) {
                try {
                    const data =
                        JSON.parse(
                            response.responseText
                        );

                    if (!data || !data.ok) {
                        console.error(
                            '[애니기록] 삭제 API 오류',
                            data
                        );

                        return;
                    }

                    suppressedSaveKey =
                        getSaveKey(
                            info.animeId,
                            info.episode
                        );

                    lastSaveTime =
                        Date.now();

                    delete histories[
                        info.episode
                    ];

                    if (
                        allHistories[
                            info.animeId
                        ]
                    ) {
                        delete allHistories[
                            info.animeId
                        ][
                            info.episode
                        ];

                        if (
                            Object.keys(
                                allHistories[
                                    info.animeId
                                ]
                            ).length === 0
                        ) {
                            delete allHistories[
                                info.animeId
                            ];
                        }
                    }

                    saveLocalMainCache();

                    clearWatchLabels();
                    refreshLabels();

                    console.log(
                        '[애니기록] 기록 삭제 완료',
                        info.episode + '화',
                        '삭제 행=' +
                        Number(
                            data.deleted || 0
                        )
                    );

                } catch (e) {
                    console.error(
                        '[애니기록] 삭제 응답 오류',
                        e,
                        response.responseText
                    );
                }
            },

            onerror: function (error) {
                console.error(
                    '[애니기록] 삭제 실패',
                    error
                );
            }
        });
    }

    // =========================================================
    // VIDEO 저장
    // =========================================================

    function bindVideoContext(video) {
        if (!video) return;

        const info =
            getCurrentPageInfo();

        if (!info) return;

        videoContexts.set(
            video,
            {
                animeId: info.animeId,
                episode: info.episode
            }
        );
    }

    function saveVideoProgress(
        video,
        force
    ) {
        if (!video) return;

        const context =
            videoContexts.get(
                video
            );

        if (!context) return;

        const saveAnimeId =
            context.animeId;

        const saveEpisode =
            context.episode;

        if (
            suppressedSaveKey ===
            getSaveKey(
                saveAnimeId,
                saveEpisode
            )
        ) {
            return;
        }

        const currentTime =
            Number(video.currentTime);

        const duration =
            Number(video.duration);

        if (
            !Number.isFinite(currentTime) ||
            !Number.isFinite(duration) ||
            duration <= 0
        ) {
            return;
        }

        const now =
            Date.now();

        if (
            !force &&
            now - lastSaveTime <
                SAVE_INTERVAL * 1000
        ) {
            return;
        }

        lastSaveTime =
            now;

        let saveCurrentTime =
            currentTime;

        let savePercent =
            (currentTime / duration) *
            100;

        const oldHistory =
            histories[
                saveEpisode
            ];

        if (oldHistory) {
            if (
                Number(
                    oldHistory.currentTime
                ) >
                saveCurrentTime
            ) {
                saveCurrentTime =
                    Number(
                        oldHistory.currentTime
                    );
            }

            if (
                Number(
                    oldHistory.percent
                ) >
                savePercent
            ) {
                savePercent =
                    Number(
                        oldHistory.percent
                    );
            }
        }

        let completed =
            video.ended ||
            savePercent >=
                COMPLETE_PERCENT;

        if (
            oldHistory &&
            oldHistory.completed
        ) {
            completed = true;
        }

        saveProgress(
            saveAnimeId,
            saveEpisode,
            saveCurrentTime,
            duration,
            savePercent,
            completed
        );
    }

    // =========================================================
    // 이어보기 위치
    // =========================================================

    function saveResumeSeek(
        targetAnimeId,
        targetEpisode,
        currentTime
    ) {
        currentTime =
            Number(currentTime) || 0;

        if (currentTime <= 0) {
            sessionStorage.removeItem(
                RESUME_SEEK_KEY
            );

            return;
        }

        sessionStorage.setItem(
            RESUME_SEEK_KEY,
            JSON.stringify({
                animeId:
                    String(
                        targetAnimeId
                    ),

                episode:
                    String(
                        targetEpisode
                    ),

                currentTime:
                    currentTime,

                savedAt:
                    Date.now()
            })
        );
    }

    function restoreResumePosition(
        video
    ) {
        if (!video) return;

        let data;

        try {
            const text =
                sessionStorage.getItem(
                    RESUME_SEEK_KEY
                );

            if (!text) return;

            data =
                JSON.parse(
                    text
                );

        } catch (e) {
            sessionStorage.removeItem(
                RESUME_SEEK_KEY
            );

            return;
        }

        if (
            !data ||
            !data.animeId ||
            !data.episode
        ) {
            return;
        }

        if (
            Date.now() -
            Number(
                data.savedAt || 0
            ) >
            60000
        ) {
            sessionStorage.removeItem(
                RESUME_SEEK_KEY
            );

            return;
        }

        const info =
            getCurrentPageInfo();

        if (!info) return;

        if (
            String(
                info.animeId
            ) !==
            String(
                data.animeId
            ) ||

            String(
                info.episode
            ) !==
            String(
                data.episode
            )
        ) {
            return;
        }

        const targetTime =
            Number(
                data.currentTime
            ) || 0;

        const duration =
            Number(
                video.duration
            );

        if (
            targetTime <= 0 ||
            !Number.isFinite(
                duration
            ) ||
            duration <= 0
        ) {
            return;
        }

        const seekTime =
            Math.min(
                targetTime,
                Math.max(
                    0,
                    duration - 1
                )
            );

        try {
            video.currentTime =
                seekTime;

            console.log(
                '[애니기록] 이어보기 위치 이동',
                info.episode + '화',
                formatTime(
                    seekTime
                )
            );

            // 플레이어가 초기화하는 경우 다시 이동
            setTimeout(
                function () {
                    if (
                        video &&
                        Math.abs(
                            Number(
                                video.currentTime
                            ) -
                            seekTime
                        ) >
                        3
                    ) {
                        video.currentTime =
                            seekTime;
                    }
                },
                500
            );

            setTimeout(
                function () {
                    if (
                        video &&
                        Math.abs(
                            Number(
                                video.currentTime
                            ) -
                            seekTime
                        ) >
                        3
                    ) {
                        video.currentTime =
                            seekTime;
                    }

                    sessionStorage.removeItem(
                        RESUME_SEEK_KEY
                    );
                },
                1500
            );

        } catch (e) {
            console.error(
                '[애니기록] 이어보기 위치 이동 실패',
                e
            );
        }
    }

    // =========================================================
    // VIDEO 연결
    // =========================================================

    function hookVideo(video) {
        if (!video) return;

        currentVideo =
            video;

        if (
            video.dataset
                .anilifeWatchHooked ===
            '1'
        ) {
            if (
                video.readyState >= 1
            ) {
                restoreResumePosition(
                    video
                );
            }

            return;
        }

        video.dataset
            .anilifeWatchHooked =
            '1';

        bindVideoContext(
            video
        );

        if (
            video.readyState >= 1
        ) {
            restoreResumePosition(
                video
            );
        }

        video.addEventListener(
            'loadedmetadata',
            function () {
                currentVideo =
                    video;

                bindVideoContext(
                    video
                );

                restoreResumePosition(
                    video
                );
            }
        );

        video.addEventListener(
            'canplay',
            function () {
                currentVideo =
                    video;

                restoreResumePosition(
                    video
                );
            }
        );

        video.addEventListener(
            'play',
            function () {
                currentVideo =
                    video;

                bindVideoContext(
                    video
                );

                restoreResumePosition(
                    video
                );
            }
        );

        video.addEventListener(
            'timeupdate',
            function () {
                currentVideo =
                    video;

                saveVideoProgress(
                    video,
                    false
                );
            }
        );

        video.addEventListener(
            'pause',
            function () {
                currentVideo =
                    video;

                saveVideoProgress(
                    video,
                    true
                );
            }
        );

        video.addEventListener(
            'seeked',
            function () {
                currentVideo =
                    video;

                saveVideoProgress(
                    video,
                    true
                );
            }
        );

        video.addEventListener(
            'ended',
            function () {
                currentVideo =
                    video;

                saveVideoProgress(
                    video,
                    true
                );
            }
        );
    }

    function findPlayer() {
        if (!isWatchPage()) return;

        document
            .querySelectorAll(
                'video'
            )
            .forEach(
                function (video) {
                    hookVideo(
                        video
                    );
                }
            );
    }

    // =========================================================
    // 회차목록 영역
    // =========================================================

    function findEpisodeListArea() {
        if (!isWatchPage()) {
            return null;
        }

        const walker =
            document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            node =
            walker.nextNode()
        ) {
            const text =
                (
                    node.nodeValue ||
                    ''
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim();

            if (
                text !==
                '회차 목록'
            ) {
                continue;
            }

            let parent =
                node.parentElement;

            for (
                let i = 0;
                i < 8 &&
                parent;
                i++
            ) {
                const matches =
                    (
                        parent.textContent ||
                        ''
                    )
                    .match(
                        /\d+\s*화/g
                    );

                if (
                    matches &&
                    matches.length >= 3
                ) {
                    return parent;
                }

                parent =
                    parent.parentElement;
            }
        }

        return null;
    }

    // =========================================================
    // 회차목록 진행률
    // =========================================================

    function findEpisodeTitleNodes() {
        const area =
            findEpisodeListArea();

        if (!area) {
            return [];
        }

        const candidates = {};

        const walker =
            document.createTreeWalker(
                area,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            node =
            walker.nextNode()
        ) {
            if (
                !node.parentElement
            ) {
                continue;
            }

            const match =
                (
                    node.nodeValue ||
                    ''
                )
                .trim()
                .match(
                    /^(\d+)\s*화$/
                );

            if (!match) {
                continue;
            }

            const ep =
                String(
                    match[1]
                );

            if (
                !histories[
                    ep
                ]
            ) {
                continue;
            }

            const parent =
                node.parentElement;

            const rect =
                parent.getBoundingClientRect();

            if (
                rect.width <= 0 ||
                rect.height <= 0
            ) {
                continue;
            }

            const style =
                getComputedStyle(
                    parent
                );

            const fontSize =
                parseFloat(
                    style.fontSize
                ) || 0;

            let fontWeight =
                parseInt(
                    style.fontWeight,
                    10
                );

            if (
                !Number.isFinite(
                    fontWeight
                )
            ) {
                fontWeight =
                    style.fontWeight ===
                    'bold'
                        ? 700
                        : 400;
            }

            const candidate = {
                element:
                    parent,

                episode:
                    ep,

                fontSize:
                    fontSize,

                fontWeight:
                    fontWeight
            };

            const old =
                candidates[
                    ep
                ];

            if (
                !old ||
                candidate.fontSize >
                    old.fontSize ||
                (
                    candidate.fontSize ===
                        old.fontSize &&
                    candidate.fontWeight >
                        old.fontWeight
                )
            ) {
                candidates[
                    ep
                ] =
                    candidate;
            }
        }

        return Object.values(
            candidates
        );
    }

    function updateEpisodeCardLabels() {
        if (!isWatchPage()) return;

        findEpisodeTitleNodes()
            .forEach(
                function (item) {
                    const history =
                        histories[
                            item.episode
                        ];

                    if (!history) {
                        return;
                    }

                    let percent =
                        Math.round(
                            Number(
                                history.percent
                            ) || 0
                        );

                    percent =
                        Math.max(
                            0,
                            Math.min(
                                100,
                                percent
                            )
                        );

                    item.element
                        .classList
                        .add(
                            'anilife-episode-progress'
                        );

                    if (
                        history.completed ||
                        percent >=
                            COMPLETE_PERCENT
                    ) {
                        item.element
                            .setAttribute(
                                'data-anilife-progress',
                                '✓100%'
                            );

                        item.element
                            .setAttribute(
                                'data-anilife-complete',
                                '1'
                            );

                    } else {
                        item.element
                            .setAttribute(
                                'data-anilife-progress',
                                '▶' +
                                percent +
                                '%'
                            );

                        item.element
                            .setAttribute(
                                'data-anilife-complete',
                                '0'
                            );
                    }
                }
            );
    }

    // =========================================================
    // 플레이어 아래 진행률
    // =========================================================

    function updatePlayerAreaLabels() {
        if (!isWatchPage()) return;

        const video =
            currentVideo ||
            document.querySelector(
                'video'
            );

        if (!video) return;

        const listArea =
            findEpisodeListArea();

        const videoRect =
            video
                .getBoundingClientRect();

        const walker =
            document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            node =
            walker.nextNode()
        ) {
            if (
                !node.parentElement
            ) {
                continue;
            }

            if (
                node.parentElement
                    .classList
                    .contains(
                        'anilife-player-watch-info'
                    )
            ) {
                continue;
            }

            if (
                listArea &&
                listArea.contains(
                    node.parentElement
                )
            ) {
                continue;
            }

            const match =
                (
                    node.nodeValue ||
                    ''
                )
                .match(
                    /^\s*(\d+)\s*화/
                );

            if (!match) continue;

            const ep =
                String(
                    match[1]
                );

            const history =
                histories[
                    ep
                ];

            if (!history) continue;

            const rect =
                node.parentElement
                    .getBoundingClientRect();

            if (
                rect.top <
                    videoRect.bottom -
                    60 ||
                rect.top >
                    videoRect.bottom +
                    220
            ) {
                continue;
            }

            let next =
                node.nextSibling;

            while (
                next &&
                next.nodeType ===
                    Node.TEXT_NODE &&
                !(
                    next.nodeValue ||
                    ''
                ).trim()
            ) {
                next =
                    next.nextSibling;
            }

            let badge = null;

            if (
                next &&
                next.nodeType ===
                    Node.ELEMENT_NODE &&
                next.classList
                    .contains(
                        'anilife-player-watch-info'
                    )
            ) {
                badge = next;
            }

            if (!badge) {
                const originalText =
                    node.nodeValue;

                const episodeMatch =
                    originalText
                        .match(
                            /^(\s*\d+\s*화)/
                        );

                if (
                    !episodeMatch
                ) {
                    continue;
                }

                const length =
                    episodeMatch[1]
                        .length;

                let restNode = null;

                if (
                    length <
                    originalText.length
                ) {
                    restNode =
                        node.splitText(
                            length
                        );
                }

                badge =
                    document.createElement(
                        'span'
                    );

                badge.className =
                    'anilife-player-watch-info';

                badge.style
                    .setProperty(
                        'margin-left',
                        '7px',
                        'important'
                    );

                badge.style
                    .setProperty(
                        'display',
                        'inline-block',
                        'important'
                    );

                badge.style
                    .setProperty(
                        'font-size',
                        '11px',
                        'important'
                    );

                badge.style
                    .setProperty(
                        'font-weight',
                        '700',
                        'important'
                    );

                badge.style
                    .setProperty(
                        'white-space',
                        'nowrap',
                        'important'
                    );

                if (restNode) {
                    node.parentNode
                        .insertBefore(
                            badge,
                            restNode
                        );
                } else {
                    node.parentNode
                        .insertBefore(
                            badge,
                            node.nextSibling
                        );
                }
            }

            const percent =
                Math.round(
                    Number(
                        history.percent
                    ) || 0
                );

            if (
                history.completed ||
                percent >=
                    COMPLETE_PERCENT
            ) {
                badge.textContent =
                    '✓100% · ' +
                    formatTime(
                        history.currentTime
                    );

                badge.style
                    .setProperty(
                        'color',
                        '#20c997',
                        'important'
                    );

            } else {
                badge.textContent =
                    '▶' +
                    percent +
                    '% · ' +
                    formatTime(
                        history.currentTime
                    );

                badge.style
                    .setProperty(
                        'color',
                        '#ffc107',
                        'important'
                    );
            }
        }
    }

    function updateAllLabels() {
        if (!isWatchPage()) return;

        updateEpisodeCardLabels();
        updatePlayerAreaLabels();
    }

    function refreshLabels() {
        updateAllLabels();

        setTimeout(
            updateAllLabels,
            100
        );

        setTimeout(
            updateAllLabels,
            300
        );

        setTimeout(
            updateAllLabels,
            800
        );

        setTimeout(
            updateAllLabels,
            1500
        );
    }

    // =========================================================
    // 메인 카드 정보
    // =========================================================

    function getMainEpisodeInfo(card) {
        const element =
            card.querySelector(
                'span.episode'
            );

        if (!element) return null;

        const match =
            (
                element.textContent ||
                ''
            )
            .trim()
            .match(
                /^(\d+)\s*화$/
            );

        if (!match) return null;

        return {
            episode:
                String(
                    match[1]
                ),

            element:
                element
        };
    }

    function getMainAnimeId(card) {
        if (!card) return '';

        // 실제 링크에서 작품 ID 찾기
        const links =
            card.querySelectorAll(
                'a[href]'
            );

        for (
            const link of links
        ) {
            const href =
                link.getAttribute(
                    'href'
                ) || '';

            const match =
                href.match(
                    /\/content\/(\d+)\/(\d+)/
                );

            if (match) {
                return String(
                    match[1]
                );
            }
        }

        // 기존 React Fiber 방식 fallback
        const propertyName =
            Object.keys(card)
                .find(
                    function (key) {
                        return key
                            .startsWith(
                                '__reactFiber$'
                            );
                    }
                );

        if (!propertyName) {
            return '';
        }

        let fiber =
            card[
                propertyName
            ];

        for (
            let i = 0;
            fiber &&
            i < 12;
            i++
        ) {
            const key =
                fiber.key;

            if (
                key !== null &&
                key !== undefined &&
                /^\d+$/
                    .test(
                        String(key)
                    )
            ) {
                return String(
                    key
                );
            }

            fiber =
                fiber.return;
        }

        return '';
    }

    // =========================================================
    // 이어볼 회차 계산
    // =========================================================

    function getResumeInfo(
        animeHistory
    ) {
        let lastCompletedEpisode = 0;
        let watchingEpisode = 0;
        let watchingPercent = 0;
        let watchingTime = 0;

        Object.keys(
            animeHistory || {}
        )
        .forEach(
            function (ep) {
                const history =
                    animeHistory[
                        ep
                    ];

                const episodeNumber =
                    Number(ep);

                if (
                    !Number.isFinite(
                        episodeNumber
                    )
                ) {
                    return;
                }

                const percent =
                    Number(
                        history.percent
                    ) || 0;

                const completed =
                    history.completed ||
                    percent >=
                        COMPLETE_PERCENT;

                if (completed) {
                    if (
                        episodeNumber >
                        lastCompletedEpisode
                    ) {
                        lastCompletedEpisode =
                            episodeNumber;
                    }

                } else if (
                    percent > 0 &&
                    episodeNumber >
                        watchingEpisode
                ) {
                    watchingEpisode =
                        episodeNumber;

                    watchingPercent =
                        percent;

                    watchingTime =
                        Number(
                            history.currentTime
                        ) || 0;
                }
            }
        );

        const targetEpisode =
            watchingEpisode >
                lastCompletedEpisode
                ? watchingEpisode
                : lastCompletedEpisode +
                    1;

        return {
            lastCompletedEpisode:
                lastCompletedEpisode,

            watchingEpisode:
                watchingEpisode,

            watchingPercent:
                watchingPercent,

            watchingTime:
                watchingTime,

            targetEpisode:
                targetEpisode
        };
    }

    // =========================================================
    // 메인 카드 클릭 시 동작 계산
    //
    // dataset에 의존하지 않고 클릭할 때 다시 계산
    // =========================================================

    function getMainCardAction(
        card
    ) {
        const id =
            getMainAnimeId(
                card
            );

        const epInfo =
            getMainEpisodeInfo(
                card
            );

        if (
            !id ||
            !epInfo
        ) {
            return null;
        }

        const latestEpisode =
            String(
                epInfo.episode
            );

        const animeHistory =
            allHistories[
                id
            ] || {};

        const latestHistory =
            animeHistory[
                latestEpisode
            ];

        // 최신화 기록 존재
        if (latestHistory) {
            const percent =
                Number(
                    latestHistory.percent
                ) || 0;

            const completed =
                latestHistory.completed ||
                percent >=
                    COMPLETE_PERCENT;

            // 최신화까지 완료했으면 팝업 필요 없음
            if (completed) {
                return null;
            }

            // 최신화 시청중
            return {
                animeId:
                    id,

                targetEpisode:
                    latestEpisode,

                latestEpisode:
                    latestEpisode,

                promptType:
                    'continue',

                resumeTime:
                    Number(
                        latestHistory.currentTime
                    ) || 0
            };
        }

        const keys =
            Object.keys(
                animeHistory
            );

        // 아예 시청기록 없는 작품
        if (
            keys.length === 0
        ) {
            return {
                animeId:
                    id,

                targetEpisode:
                    '1',

                latestEpisode:
                    latestEpisode,

                promptType:
                    'first',

                resumeTime:
                    0
            };
        }

        const resumeInfo =
            getResumeInfo(
                animeHistory
            );

        // 0% 데이터만 있는 경우도 안 본 것으로 처리
        if (
            resumeInfo
                .lastCompletedEpisode ===
                0 &&
            resumeInfo
                .watchingEpisode ===
                0
        ) {
            return {
                animeId:
                    id,

                targetEpisode:
                    '1',

                latestEpisode:
                    latestEpisode,

                promptType:
                    'first',

                resumeTime:
                    0
            };
        }

        const currentEpisode =
            Number(
                latestEpisode
            );

        if (
            Number.isFinite(
                currentEpisode
            ) &&
            currentEpisode >=
                resumeInfo.targetEpisode
        ) {
            return {
                animeId:
                    id,

                targetEpisode:
                    String(
                        resumeInfo
                            .targetEpisode
                    ),

                latestEpisode:
                    latestEpisode,

                promptType:
                    'continue',

                resumeTime:
                    resumeInfo
                        .watchingEpisode ===
                    resumeInfo
                        .targetEpisode
                        ? Number(
                            resumeInfo
                                .watchingTime
                        ) || 0
                        : 0,

                resumeInfo:
                    resumeInfo
            };
        }

        return null;
    }

    // =========================================================
    // 메인 배지
    // =========================================================

    function ensureMainBadge(
        card
    ) {
        const posterWrap =
            card.querySelector(
                '.poster-wrap'
            );

        if (!posterWrap) {
            return null;
        }

        posterWrap
            .classList
            .add(
                'anilife-main-has-progress'
            );

        let badge =
            posterWrap
                .querySelector(
                    ':scope > .anilife-main-progress-badge'
                );

        if (!badge) {
            badge =
                document
                    .createElement(
                        'div'
                    );

            badge.className =
                'anilife-main-progress-badge';

            posterWrap
                .appendChild(
                    badge
                );
        }

        return badge;
    }

    function removeMainBadge(
        card
    ) {
        const posterWrap =
            card.querySelector(
                '.poster-wrap'
            );

        if (!posterWrap) return;

        const badge =
            posterWrap
                .querySelector(
                    ':scope > .anilife-main-progress-badge'
                );

        if (badge) {
            badge.remove();
        }

        posterWrap
            .classList
            .remove(
                'anilife-main-has-progress'
            );
    }

    // =========================================================
    // 메인 표시
    // =========================================================

    function updateMainCards() {
        if (
            isWatchPage() ||
            !allHistoryLoaded
        ) {
            return;
        }

        document
            .querySelectorAll(
                'article.anime-card'
            )
            .forEach(
                function (card) {
                    const id =
                        getMainAnimeId(
                            card
                        );

                    const epInfo =
                        getMainEpisodeInfo(
                            card
                        );

                    if (
                        !id ||
                        !epInfo
                    ) {
                        return;
                    }

                    const animeHistory =
                        allHistories[
                            id
                        ] || {};

                    const latestHistory =
                        animeHistory[
                            epInfo.episode
                        ];

                    // =========================================
                    // 최신화 기록 있음
                    // =========================================

                    if (
                        latestHistory
                    ) {
                        let percent =
                            Math.round(
                                Number(
                                    latestHistory.percent
                                ) || 0
                            );

                        percent =
                            Math.max(
                                0,
                                Math.min(
                                    100,
                                    percent
                                )
                            );

                        const badge =
                            ensureMainBadge(
                                card
                            );

                        if (!badge) return;

                        badge.removeAttribute(
                            'data-anilife-status'
                        );

                        if (
                            latestHistory.completed ||
                            percent >=
                                COMPLETE_PERCENT
                        ) {
                            badge.textContent =
                                '✓ 완료';

                            badge.setAttribute(
                                'data-anilife-complete',
                                '1'
                            );

                        } else {
                            badge.textContent =
                                '▶ ' +
                                percent +
                                '%';

                            badge.setAttribute(
                                'data-anilife-complete',
                                '0'
                            );
                        }

                        return;
                    }

                    // =========================================
                    // 아예 안 본 작품
                    // 메인 표시 없음
                    // =========================================

                    if (
                        Object.keys(
                            animeHistory
                        ).length === 0
                    ) {
                        removeMainBadge(
                            card
                        );

                        return;
                    }

                    // =========================================
                    // 이전 기록 있음
                    // =========================================

                    const resumeInfo =
                        getResumeInfo(
                            animeHistory
                        );

                    const currentEpisode =
                        Number(
                            epInfo.episode
                        );

                    if (
                        Number.isFinite(
                            currentEpisode
                        ) &&
                        currentEpisode >=
                            resumeInfo.targetEpisode &&
                        (
                            resumeInfo
                                .lastCompletedEpisode >
                                0 ||
                            resumeInfo
                                .watchingEpisode >
                                0
                        )
                    ) {
                        const badge =
                            ensureMainBadge(
                                card
                            );

                        if (!badge) return;

                        let subText;

                        if (
                            resumeInfo
                                .watchingEpisode >
                            resumeInfo
                                .lastCompletedEpisode
                        ) {
                            subText =
                                resumeInfo
                                    .watchingEpisode +
                                '화 시청중 · ' +
                                Math.round(
                                    resumeInfo
                                        .watchingPercent
                                ) +
                                '%';

                        } else {
                            subText =
                                resumeInfo
                                    .lastCompletedEpisode +
                                '화까지 시청';
                        }

                        badge.setAttribute(
                            'data-anilife-status',
                            'need-watch'
                        );

                        badge.setAttribute(
                            'data-anilife-complete',
                            '0'
                        );

                        badge.innerHTML =
                            '<span class="anilife-main-progress-title">' +
                            '▶ 시청 필요' +
                            '</span>' +
                            '<span class="anilife-main-progress-sub">' +
                            subText +
                            '</span>';

                        return;
                    }

                    removeMainBadge(
                        card
                    );
                }
            );
    }

    // =========================================================
    // 팝업
    // =========================================================

    function clearContinuePrompt() {
        const overlay =
            document.querySelector(
                '.anilife-continue-overlay'
            );

        if (overlay) {
            overlay.remove();
        }

        continuePromptOpen = false;
    }

    function showContinuePrompt(
        action,
        onYes,
        onNo
    ) {
        if (
            continuePromptOpen
        ) {
            return;
        }

        continuePromptOpen = true;

        const overlay =
            document.createElement(
                'div'
            );

        overlay.className =
            'anilife-continue-overlay';

        const dialog =
            document.createElement(
                'div'
            );

        dialog.className =
            'anilife-continue-dialog';

        dialog.setAttribute(
            'role',
            'dialog'
        );

        dialog.setAttribute(
            'aria-modal',
            'true'
        );

        const title =
            document.createElement(
                'div'
            );

        title.className =
            'anilife-continue-title';

        const message =
            document.createElement(
                'div'
            );

        message.className =
            'anilife-continue-message';

        // 아예 안 본 작품
        if (
            action.promptType ===
            'first'
        ) {
            title.textContent =
                '1화부터 시청하시겠습니까?';

            message.innerHTML =
                '시청 기록이 없는 작품입니다.<br>' +
                '<strong>1화</strong>부터 시청합니다.';

        } else {
            title.textContent =
                '이어보기를 하시겠습니까?';

            // 시청중이던 기록
            if (
                Number(
                    action.resumeTime
                ) >
                0
            ) {
                message.innerHTML =
                    '<strong>' +
                    action.targetEpisode +
                    '화</strong> ' +
                    formatTime(
                        action.resumeTime
                    ) +
                    '부터 이어봅니다.';

            } else {
                // 완료 다음 회차
                message.innerHTML =
                    '<strong>' +
                    action.targetEpisode +
                    '화</strong>부터 시청합니다.';
            }
        }

        const buttons =
            document.createElement(
                'div'
            );

        buttons.className =
            'anilife-continue-buttons';

        const yesButton =
            document.createElement(
                'button'
            );

        yesButton.type =
            'button';

        yesButton.className =
            'anilife-continue-yes';

        yesButton.textContent =
            '네';

        const noButton =
            document.createElement(
                'button'
            );

        noButton.type =
            'button';

        noButton.className =
            'anilife-continue-no';

        noButton.textContent =
            '아니오';

        function closePrompt() {
            continuePromptOpen =
                false;

            overlay.remove();
        }

        yesButton
            .addEventListener(
                'click',
                function () {
                    closePrompt();

                    if (onYes) {
                        onYes();
                    }
                }
            );

        noButton
            .addEventListener(
                'click',
                function () {
                    closePrompt();

                    if (onNo) {
                        onNo();
                    }
                }
            );

        buttons.appendChild(
            yesButton
        );

        buttons.appendChild(
            noButton
        );

        dialog.appendChild(
            title
        );

        dialog.appendChild(
            message
        );

        dialog.appendChild(
            buttons
        );

        overlay.appendChild(
            dialog
        );

        document.body
            .appendChild(
                overlay
            );

        // 기본 포커스 = 네
        // Enter → 네 실행
        setTimeout(
            function () {
                yesButton.focus();
            },
            50
        );
    }

    // =========================================================
    // 메인 카드 클릭
    // =========================================================

    document.addEventListener(
        'click',

        function (event) {
            if (
                isWatchPage()
            ) {
                return;
            }

            const target =
                event.target &&
                event.target.nodeType === 1
                    ? event.target
                    : event.target.parentElement;

            if (
                !target ||
                !target.closest
            ) {
                return;
            }

            const card =
                target.closest(
                    'article.anime-card'
                );

            if (!card) return;

            // 북마크 / 즐겨찾기 클릭 제외
            const special =
                target.closest(
                    '.bookmark, ' +
                    '.bookmark-button, ' +
                    '.favorite, ' +
                    '.favorite-button, ' +
                    '[aria-label*="북마크"], ' +
                    '[title*="북마크"]'
                );

            if (
                special &&
                card.contains(
                    special
                )
            ) {
                return;
            }

            // 핵심:
            // dataset 값에 의존하지 않고
            // 클릭 순간 현재 기록으로 다시 계산
            const action =
                getMainCardAction(
                    card
                );

            // 최신화까지 완료된 작품 등
            // 팝업 필요 없으면 사이트 원래 동작
            if (!action) {
                return;
            }

            // 사이트가 먼저 최신회차로 이동하는 것 차단
            event.preventDefault();
            event.stopPropagation();

            if (
                event.stopImmediatePropagation
            ) {
                event.stopImmediatePropagation();
            }

            console.log(
                '[애니기록] 메인 클릭',
                action
            );

            showContinuePrompt(
                action,

                // =========================================
                // 네
                // =========================================

                function () {
                    // 시청중이던 회차면 저장시간도 전달
                    if (
                        action.promptType ===
                            'continue' &&
                        Number(
                            action.resumeTime
                        ) >
                        0
                    ) {
                        saveResumeSeek(
                            action.animeId,
                            action.targetEpisode,
                            action.resumeTime
                        );

                    } else {
                        sessionStorage
                            .removeItem(
                                RESUME_SEEK_KEY
                            );
                    }

                    // 1화 또는 이어볼 회차로 바로 이동
                    goEpisode(
                        action.animeId,
                        action.targetEpisode
                    );
                },

                // =========================================
                // 아니오
                // → 메인에 표시된 최신회차로 이동
                // =========================================

                function () {
                    sessionStorage
                        .removeItem(
                            RESUME_SEEK_KEY
                        );

                    goEpisode(
                        action.animeId,
                        action.latestEpisode
                    );
                }
            );
        },

        true
    );

    // =========================================================
    // URL 변경
    // =========================================================

    function checkPageChange() {
        const currentUrl =
            location.href;

        if (
            currentUrl ===
            lastUrl
        ) {
            return;
        }

        lastUrl =
            currentUrl;

        clearContinuePrompt();
        clearWatchLabels();

        suppressedSaveKey = '';

        const info =
            getCurrentPageInfo();

        // =====================================================
        // 메인
        // =====================================================

        if (!info) {
            animeId = '';
            episode = '';
            histories = {};
            currentVideo = null;
            lastSaveTime = 0;

            // 캐시로 바로 표시
            updateMainCards();

            // 서버 최신 기록 조회
            loadAllHistory(
                true
            );

            return;
        }

        // =====================================================
        // 재생화면
        // =====================================================

        animeId =
            info.animeId;

        episode =
            info.episode;

        histories = {};

        currentVideo = null;

        lastSaveTime = 0;

        loadHistory();

        setTimeout(
            findPlayer,
            200
        );

        setTimeout(
            findPlayer,
            700
        );

        setTimeout(
            findPlayer,
            1500
        );

        setTimeout(
            findPlayer,
            3000
        );
    }

    // =========================================================
    // 키패드
    //
    // 숫자패드 +
    // → 현재 위치 강제 덮어쓰기
    //
    // 숫자패드 -
    // → 현재 회차 기록 행 삭제
    // =========================================================

    document.addEventListener(
        'keydown',

        function (event) {
            if (
                event.repeat ||
                !isWatchPage()
            ) {
                return;
            }

            if (
                event.code ===
                'NumpadAdd'
            ) {
                event.preventDefault();
                event.stopPropagation();

                overwriteCurrentProgress();

                return;
            }

            if (
                event.code ===
                'NumpadSubtract'
            ) {
                event.preventDefault();
                event.stopPropagation();

                deleteCurrentHistory();
            }
        },

        true
    );

    // =========================================================
    // 탭 이동 시 저장
    // =========================================================

    document.addEventListener(
        'visibilitychange',

        function () {
            if (
                document.hidden &&
                currentVideo &&
                isWatchPage()
            ) {
                saveVideoProgress(
                    currentVideo,
                    true
                );
            }
        }
    );

    // =========================================================
    // 시작
    // =========================================================

    installStyle();

    loadLocalMainCache();

    lastUrl = '';

    checkPageChange();

    setInterval(
        checkPageChange,
        500
    );

    setInterval(
        function () {
            if (
                isWatchPage()
            ) {
                findPlayer();
            }
        },
        1000
    );

    setInterval(
        function () {
            if (
                isWatchPage()
            ) {
                updateAllLabels();
            } else {
                updateMainCards();
            }
        },
        500
    );

})();
