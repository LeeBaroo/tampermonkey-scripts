// ==UserScript==
// @name         애니라이프 시청기록 자동 동기화
// @namespace    https://github.com/LeeBaroo/tampermonkey-scripts
// @version      6.8
// @description  시청기록 저장 + 회차 진행률 + 메인화면 고속/강조 표시
// @match        *://anilife01.tv/*
// @match        *://*.anilife01.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/LeeBaroo/tampermonkey-scripts/main/anilife-watch-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/LeeBaroo/tampermonkey-scripts/main/anilife-watch-sync.user.js
// ==/UserScript==

(function () {
'use strict';

// =========================================================
// 설정
// =========================================================

const API_URL =
'https://script.google.com/macros/s/AKfycbxgN5zZYdlBdCuDPVBmHpFQvdZax-ubhGqOAc4Wrxgtm6j7ZiRhGAVUvR2oWI_3cOOb/exec';


// =========================================================
// API KEY
//
// GitHub에는 API KEY를 저장하지 않는다.
// 각 PC의 Tampermonkey 저장소에 따로 저장한다.
// =========================================================

const API_KEY_STORAGE_KEY =
'anilife-api-key';


function getApiKey() {

let key =
String(
GM_getValue(
API_KEY_STORAGE_KEY,
''
) || ''
)
.trim();


if (!key) {

const input =
prompt(
'애니라이프 시청기록 동기화 API 키를 입력하세요.\n\n' +
'입력한 키는 이 PC의 Tampermonkey 저장소에만 저장됩니다.'
);


if (
input !== null
) {

key =
String(
input
)
.trim();


if (key) {

GM_setValue(
API_KEY_STORAGE_KEY,
key
);
}
}
}


return key;
}


let API_KEY =
getApiKey();


// =========================================================
// Tampermonkey 메뉴에서 API KEY 변경
// =========================================================

GM_registerMenuCommand(

'애니라이프 API 키 변경',

function () {

const current =
String(
GM_getValue(
API_KEY_STORAGE_KEY,
''
) || ''
);


const input =
prompt(
'새 API 키를 입력하세요.',
current
);


if (
input === null
) {

return;
}


const nextKey =
String(
input
)
.trim();


if (!nextKey) {

alert(
'API 키가 비어 있어 변경하지 않았습니다.'
);

return;
}


GM_setValue(
API_KEY_STORAGE_KEY,
nextKey
);


API_KEY =
nextKey;


alert(
'API 키를 저장했습니다.\n페이지를 새로고침하면 적용됩니다.'
);
}
);


const SAVE_INTERVAL =
10;

const COMPLETE_PERCENT =
95;

const MAIN_CACHE_KEY =
'anilife-watch-history-cache-v1';


// =========================================================
// 재생화면 상태
// =========================================================

let animeId = '';
let episode = '';

let histories = {};

let currentVideo = null;

let lastSaveTime = 0;

let lastUrl = '';


// VIDEO 요소가 실제로 재생하던 작품/회차를 기억
// 자동 다음화에서 URL이 먼저 바뀌어도 이전 화의 ended 저장이
// 다음 화 기록으로 들어가지 않도록 사용한다.
const videoContexts = new WeakMap();


// =========================================================
// 메인화면 상태
// =========================================================

let allHistories = {};

let allHistoryLoading =
false;

let allHistoryLoaded =
false;

let lastAllHistoryLoad =
0;


// =========================================================
// CSS
// =========================================================

function installStyle() {

if (
document.getElementById(
'anilife-watch-style'
)
) {
return;
}


const style =
document.createElement(
'style'
);


style.id =
'anilife-watch-style';


style.textContent = `

/* =================================================
   작품 내부 회차 목록
   ================================================= */

.anilife-episode-progress::after {

    content:
        attr(data-anilife-progress);

    display:
        inline-block !important;

    margin-left:
        7px !important;

    font-size:
        11px !important;

    font-weight:
        700 !important;

    line-height:
        normal !important;

    vertical-align:
        middle !important;

    white-space:
        nowrap !important;

    color:
        #ffc107 !important;
}


.anilife-episode-progress[
    data-anilife-complete="1"
]::after {

    color:
        #20c997 !important;
}


/* =================================================
   메인화면

   기존 "23화" 배지는 건드리지 않음
   그 위에 진행상태 배지를 별도로 표시
   ================================================= */

.poster-wrap.anilife-main-has-progress {

    position:
        relative !important;
}


.anilife-main-progress-badge {

    position:
        absolute !important;

    right:
        7px !important;

    bottom:
        40px !important;

    z-index:
        100 !important;

    display:
        flex !important;

    align-items:
        center !important;

    justify-content:
        center !important;

    min-width:
        66px !important;

    height:
        29px !important;

    padding:
        0 9px !important;

    box-sizing:
        border-box !important;

    border-radius:
        7px !important;

    font-size:
        14px !important;

    font-weight:
        800 !important;

    line-height:
        29px !important;

    letter-spacing:
        -0.2px !important;

    white-space:
        nowrap !important;

    color:
        #111111 !important;

    background:
        #ffb300 !important;

    border:
        1px solid rgba(
            255,
            255,
            255,
            0.80
        ) !important;

    box-shadow:
        0 2px 8px rgba(
            0,
            0,
            0,
            0.85
        ) !important;

    pointer-events:
        none !important;
}


/* 완료 */

.anilife-main-progress-badge[
    data-anilife-complete="1"
] {

    color:
        #ffffff !important;

    background:
        #129447 !important;

    border:
        1px solid #67df91 !important;
}

`;


document.head.appendChild(
style
);
}


// =========================================================
// 페이지 정보
// =========================================================

function getCurrentPageInfo() {

const match =
location.pathname.match(
/^\/content\/(\d+)\/(\d+)/
);


if (!match) {
return null;
}


return {

animeId:
String(
match[1]
),

episode:
String(
match[2]
)
};
}


function isWatchPage() {

return (
getCurrentPageInfo() !==
null
);
}


// =========================================================
// 작품 제목
// =========================================================

function getAnimeTitle() {

let title = '';


const h1 =
document.querySelector(
'h1'
);


if (h1) {

title =
h1.textContent.trim();
}


if (!title) {

title =
document.title || '';
}


return title
.replace(
/\s+\d+\s*화.*$/,
''
)
.replace(
/\s*\|\s*애니라이프.*$/,
''
)
.trim();
}


// =========================================================
// 시간
// =========================================================

function formatTime(seconds) {

seconds =
Math.floor(
Number(seconds) || 0
);


const hour =
Math.floor(
seconds / 3600
);


const minute =
Math.floor(
(seconds % 3600) / 60
);


const second =
seconds % 60;


if (hour > 0) {

return (
hour +
':' +
String(minute)
.padStart(2, '0') +
':' +
String(second)
.padStart(2, '0')
);
}


return (
minute +
':' +
String(second)
.padStart(2, '0')
);
}


// =========================================================
// Boolean
// =========================================================

function toBoolean(value) {

return (
value === true ||
String(value)
.toLowerCase() ===
'true'
);
}


// =========================================================
// 표시 제거
// =========================================================

function clearWatchLabels() {

document
.querySelectorAll(
'.anilife-episode-progress'
)
.forEach(
function (element) {

element.classList.remove(
'anilife-episode-progress'
);

element.removeAttribute(
'data-anilife-progress'
);

element.removeAttribute(
'data-anilife-complete'
);
}
);


document
.querySelectorAll(
'.anilife-player-watch-info'
)
.forEach(
function (element) {

element.remove();
}
);
}


function clearMainLabels() {

document
.querySelectorAll(
'.anilife-main-progress-badge'
)
.forEach(
function (element) {

element.remove();
}
);


document
.querySelectorAll(
'.anilife-main-has-progress'
)
.forEach(
function (element) {

element.classList.remove(
'anilife-main-has-progress'
);
}
);
}


// =========================================================
// 현재 작품 기록 조회
// =========================================================

function loadHistory() {

if (!API_KEY) {
return;
}


if (!animeId) {
return;
}


const requestedAnimeId =
animeId;


const url =
API_URL +
'?key=' +
encodeURIComponent(
API_KEY
) +
'&animeId=' +
encodeURIComponent(
requestedAnimeId
) +
'&_=' +
Date.now();


GM_xmlhttpRequest({

method:
'GET',

url:
url,


onload:
function (response) {

try {

const current =
getCurrentPageInfo();


if (
!current ||
current.animeId !==
requestedAnimeId
) {

return;
}


const data =
JSON.parse(
response.responseText
);


if (
!data ||
!data.ok
) {

console.error(
'[애니기록] 조회 API 오류',
data
);

return;
}


histories =
{};


(
data.episodes ||
[]
)
.forEach(
function (item) {

const ep =
String(
item.episode
);


histories[
ep
] = {

animeId:
String(
item.animeId ||
''
),

title:
String(
item.title ||
''
),

episode:
ep,

currentTime:
Number(
item.currentTime
) || 0,

duration:
Number(
item.duration
) || 0,

percent:
Number(
item.percent
) || 0,

completed:
toBoolean(
item.completed
)
};
}
);


refreshLabels();

}

catch (e) {

console.error(
'[애니기록] 조회 오류',
e
);
}
},


onerror:
function (error) {

console.error(
'[애니기록] Google 조회 실패',
error
);
}
});
}


// =========================================================
// 로컬 캐시
// =========================================================

function loadLocalMainCache() {

try {

const text =
localStorage.getItem(
MAIN_CACHE_KEY
);


if (!text) {
return;
}


const data =
JSON.parse(
text
);


if (
!data ||
!data.histories
) {

return;
}


allHistories =
data.histories;


allHistoryLoaded =
true;

}

catch (e) {

console.error(
'[애니 메인] 캐시 읽기 오류',
e
);
}
}


function saveLocalMainCache() {

try {

localStorage.setItem(

MAIN_CACHE_KEY,

JSON.stringify({

savedAt:
Date.now(),

histories:
allHistories
})
);

}

catch (e) {

console.error(
'[애니 메인] 캐시 저장 오류',
e
);
}
}


// =========================================================
// 전체 기록 조회
// =========================================================

function loadAllHistory(
force
) {

if (!API_KEY) {
return;
}


if (
allHistoryLoading
) {

return;
}


const now =
Date.now();


if (
!force &&
allHistoryLoaded &&
now -
lastAllHistoryLoad <
30000
) {

return;
}


allHistoryLoading =
true;


const url =
API_URL +
'?key=' +
encodeURIComponent(
API_KEY
) +
'&action=all' +
'&_=' +
now;


GM_xmlhttpRequest({

method:
'GET',

url:
url,


onload:
function (response) {

allHistoryLoading =
false;


try {

const data =
JSON.parse(
response.responseText
);


if (
!data ||
!data.ok ||
!Array.isArray(
data.records
)
) {

console.error(
'[애니 메인] 전체 조회 오류',
data
);

return;
}


const newHistory =
{};


data.records
.forEach(
function (item) {

const id =
String(
item.animeId ||
''
);


const ep =
String(
item.episode ||
''
);


if (
!id ||
!ep
) {

return;
}


if (
!newHistory[
id
]
) {

newHistory[
id
] =
{};
}


newHistory[
id
][
ep
] = {

animeId:
id,

episode:
ep,

title:
String(
item.title ||
''
),

currentTime:
Number(
item.currentTime
) || 0,

duration:
Number(
item.duration
) || 0,

percent:
Number(
item.percent
) || 0,

completed:
toBoolean(
item.completed
)
};
}
);


allHistories =
newHistory;


allHistoryLoaded =
true;


lastAllHistoryLoad =
Date.now();


saveLocalMainCache();


updateMainCards();

}

catch (e) {

console.error(
'[애니 메인] 전체 JSON 오류',
e,
response.responseText
);
}
},


onerror:
function (error) {

allHistoryLoading =
false;


console.error(
'[애니 메인] 전체 조회 통신 오류',
error
);
}
});
}


// =========================================================
// 저장
// =========================================================

function saveProgress(
saveAnimeId,
saveEpisode,
currentTime,
duration,
percent,
completed
) {

if (!API_KEY) {
return;
}


const data = {

key:
API_KEY,

animeId:
saveAnimeId,

title:
getAnimeTitle(),

episode:
saveEpisode,

currentTime:
Math.floor(
currentTime
),

duration:
Math.floor(
duration
),

percent:
Math.round(
percent * 10
) / 10,

completed:
completed
};


if (
animeId ===
saveAnimeId
) {

histories[
saveEpisode
] = {

animeId:
saveAnimeId,

title:
data.title,

episode:
saveEpisode,

currentTime:
data.currentTime,

duration:
data.duration,

percent:
data.percent,

completed:
data.completed
};


refreshLabels();
}


// 메인 캐시 갱신
if (
!allHistories[
saveAnimeId
]
) {

allHistories[
saveAnimeId
] =
{};
}


allHistories[
saveAnimeId
][
saveEpisode
] = {

animeId:
saveAnimeId,

title:
data.title,

episode:
saveEpisode,

currentTime:
data.currentTime,

duration:
data.duration,

percent:
data.percent,

completed:
data.completed
};


allHistoryLoaded =
true;


saveLocalMainCache();


GM_xmlhttpRequest({

method:
'POST',

url:
API_URL,

headers: {

'Content-Type':
'application/json'
},

data:
JSON.stringify(
data
),


onload:
function (response) {

console.log(
'[애니기록] 저장 완료',
saveEpisode +
'화',
data.percent +
'%',
formatTime(
data.currentTime
),
response.responseText
);
},


onerror:
function (error) {

console.error(
'[애니기록] 저장 실패',
error
);
}
});
}


// =========================================================
// VIDEO 진행률 저장
// =========================================================

function bindVideoContext(video) {

if (!video) {
return;
}


const info =
getCurrentPageInfo();


if (!info) {
return;
}


videoContexts.set(
video,
{

animeId:
info.animeId,

episode:
info.episode
}
);


console.log(
'[애니기록] VIDEO 회차 연결',
info.episode +
'화'
);
}


function saveVideoProgress(
video,
force
) {

if (!video) {
return;
}


// 현재 URL의 회차를 사용하지 않는다.
// 이 VIDEO가 실제로 재생하던 회차 정보를 사용한다.
// 애니라이프 자동 다음화에서 URL이 먼저 바뀌는 경우
// 이전 화 100%가 다음 화에 저장되는 문제를 방지한다.

const context =
videoContexts.get(
video
);


if (!context) {
return;
}


const saveAnimeId =
context.animeId;


const saveEpisode =
context.episode;


const currentTime =
Number(
video.currentTime
);


const duration =
Number(
video.duration
);


if (
!Number.isFinite(
currentTime
) ||
!Number.isFinite(
duration
) ||
duration <= 0
) {

return;
}


const now =
Date.now();


if (
!force &&
now -
lastSaveTime <
SAVE_INTERVAL *
1000
) {

return;
}


lastSaveTime =
now;


let saveCurrentTime =
currentTime;


let savePercent =
(
currentTime /
duration
) *
100;


const oldHistory =
histories[
saveEpisode
];


// 최고 시청위치 유지
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

completed =
true;
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
// 수동 진행률 덮어쓰기
//
// 숫자패드 -
// 기존 기록보다 현재 시간이 낮아도 강제로 덮어쓴다.
// =========================================================

function overwriteCurrentProgress() {

if (!isWatchPage()) {
return;
}


const video =
currentVideo ||
document.querySelector(
'video'
);


if (!video) {

console.warn(
'[애니기록] 수동 수정 실패: VIDEO를 찾을 수 없습니다.'
);

return;
}


const info =
getCurrentPageInfo();


if (!info) {
return;
}


const currentTime =
Number(
video.currentTime
);


const duration =
Number(
video.duration
);


if (
!Number.isFinite(
currentTime
) ||
!Number.isFinite(
duration
) ||
duration <= 0
) {

console.warn(
'[애니기록] 수동 수정 실패: 재생시간 정보를 읽을 수 없습니다.'
);

return;
}


const percent =
(
currentTime /
duration
) *
100;


const completed =
percent >=
COMPLETE_PERCENT;


// 현재 VIDEO를 현재 URL의 회차와 다시 연결
videoContexts.set(
video,
{

animeId:
info.animeId,

episode:
info.episode
}
);


// 기존 100% 기록이어도 무시하고
// 현재 실제 재생 위치로 강제 저장
saveProgress(

info.animeId,

info.episode,

currentTime,

duration,

percent,

completed
);


// 바로 이어지는 timeupdate 중복 저장 방지
lastSaveTime =
Date.now();


console.log(
'[애니기록] 수동 진행률 덮어쓰기',
info.episode +
'화',
Math.round(
percent * 10
) / 10 +
'%',
formatTime(
currentTime
)
);
}


// =========================================================
// VIDEO 연결
// =========================================================

function hookVideo(video) {

if (!video) {
return;
}


currentVideo =
video;


if (
video.dataset
.anilifeWatchHooked ===
'1'
) {

return;
}


video.dataset
.anilifeWatchHooked =
'1';


// 처음 VIDEO 발견 시 현재 회차와 연결
bindVideoContext(
video
);


// 같은 VIDEO 태그가 다음 화에서도 재사용될 수 있으므로
// 새 영상이 로딩되면 회차를 다시 연결
video.addEventListener(

'loadedmetadata',

function () {

currentVideo =
video;


bindVideoContext(
video
);
}
);


video.addEventListener(

'play',

function () {

currentVideo =
video;


// 실제 재생 시작 시점의 회차로 다시 확인
bindVideoContext(
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


// URL이 이미 다음 화로 바뀌었더라도
// VIDEO에 연결되어 있던 이전 회차로 저장
saveVideoProgress(
video,
true
);
}
);
}


function findPlayer() {

if (!isWatchPage()) {
return;
}


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
// 회차 목록 영역
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

const parentText =
parent.textContent ||
'';


const matches =
parentText.match(
/\d+\s*화/g
);


if (
matches &&
matches.length >=
3
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
// 회차 목록 큰 N화
// =========================================================

function findEpisodeTitleNodes() {

const area =
findEpisodeListArea();


if (!area) {
return [];
}


const candidates =
{};


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


const text =
(
node.nodeValue ||
''
).trim();


const match =
text.match(
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
parent
.getBoundingClientRect();


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


if (
!candidates[
ep
]
) {

candidates[
ep
] =
candidate;

continue;
}


const old =
candidates[
ep
];


if (
candidate.fontSize >
old.fontSize
) {

candidates[
ep
] =
candidate;

continue;
}


if (
candidate.fontSize ===
old.fontSize &&
candidate.fontWeight >
old.fontWeight
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


// =========================================================
// 회차목록 진행률
// =========================================================

function updateEpisodeCardLabels() {

if (!isWatchPage()) {
return;
}


const items =
findEpisodeTitleNodes();


items.forEach(
function (item) {

const element =
item.element;


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


element.classList.add(
'anilife-episode-progress'
);


if (
history.completed ||
percent >=
COMPLETE_PERCENT
) {

element.setAttribute(
'data-anilife-progress',
'✓100%'
);


element.setAttribute(
'data-anilife-complete',
'1'
);

}

else {

element.setAttribute(
'data-anilife-progress',
'▶' +
percent +
'%'
);


element.setAttribute(
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

if (!isWatchPage()) {
return;
}


const video =
currentVideo ||
document.querySelector(
'video'
);


if (!video) {
return;
}


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


const text =
node.nodeValue ||
'';


const match =
text.match(
/^\s*(\d+)\s*화/
);


if (!match) {
continue;
}


const ep =
String(
match[1]
);


const history =
histories[
ep
];


if (!history) {
continue;
}


const parent =
node.parentElement;


const rect =
parent
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


let badge =
null;


if (
next &&
next.nodeType ===
Node.ELEMENT_NODE &&
next.classList.contains(
'anilife-player-watch-info'
)
) {

badge =
next;
}


if (!badge) {

const originalText =
node.nodeValue;


const episodeMatch =
originalText.match(
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


let restNode =
null;


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


badge.style.setProperty(
'margin-left',
'7px',
'important'
);


badge.style.setProperty(
'display',
'inline-block',
'important'
);


badge.style.setProperty(
'font-size',
'11px',
'important'
);


badge.style.setProperty(
'font-weight',
'700',
'important'
);


badge.style.setProperty(
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

}

else {

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


badge.style.setProperty(
'color',
'#20c997',
'important'
);

}

else {

badge.textContent =
'▶' +
percent +
'% · ' +
formatTime(
history.currentTime
);


badge.style.setProperty(
'color',
'#ffc107',
'important'
);
}
}
}


// =========================================================
// 재생화면 전체 표시
// =========================================================

function updateAllLabels() {

if (!isWatchPage()) {
return;
}


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
// 메인 카드 React Fiber → 작품 ID
// =========================================================

function getMainAnimeId(
card
) {

if (!card) {
return '';
}


const propertyName =
Object.keys(
card
)
.find(
function (key) {

return key.startsWith(
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
i < 10;
i++
) {

const key =
fiber.key;


if (
key !== null &&
key !== undefined &&
/^\d+$/.test(
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
// 메인 카드 회차
// =========================================================

function getMainEpisodeInfo(
card
) {

const element =
card.querySelector(
'span.episode'
);


if (!element) {
return null;
}


const match =
(
element.textContent ||
''
)
.trim()
.match(
/^(\d+)\s*화$/
);


if (!match) {
return null;
}


return {

episode:
String(
match[1]
),

element:
element
};
}


// =========================================================
// 메인 진행상태 배지 생성
//
// 기존 span.episode는 절대 수정하지 않음
// =========================================================

function showMainProgress(
card,
history
) {

if (
!card ||
!history
) {

return;
}


const posterWrap =
card.querySelector(
'.poster-wrap'
);


if (!posterWrap) {
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


const completed =
history.completed ||
percent >=
COMPLETE_PERCENT;


posterWrap.classList.add(
'anilife-main-has-progress'
);


let badge =
posterWrap.querySelector(
':scope > .anilife-main-progress-badge'
);


if (!badge) {

badge =
document.createElement(
'div'
);


badge.className =
'anilife-main-progress-badge';


posterWrap.appendChild(
badge
);
}


if (completed) {

badge.textContent =
'✓ 완료';


badge.setAttribute(
'data-anilife-complete',
'1'
);

}

else {

badge.textContent =
'▶ ' +
percent +
'%';


badge.setAttribute(
'data-anilife-complete',
'0'
);
}
}


// =========================================================
// 메인 카드 전체 처리
// =========================================================

function updateMainCards() {

if (
isWatchPage()
) {

clearMainLabels();

return;
}


if (
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


if (!id) {
return;
}


const epInfo =
getMainEpisodeInfo(
card
);


if (!epInfo) {
return;
}


const history =
(
allHistories[
id
] || {}
)[
epInfo.episode
];


const posterWrap =
card.querySelector(
'.poster-wrap'
);


if (!posterWrap) {
return;
}


// 기록 없음
if (!history) {

const oldBadge =
posterWrap.querySelector(
':scope > .anilife-main-progress-badge'
);


if (oldBadge) {

oldBadge.remove();
}


posterWrap.classList.remove(
'anilife-main-has-progress'
);


return;
}


// 진행상태 표시
showMainProgress(
card,
history
);
}
);
}


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


clearWatchLabels();

clearMainLabels();


const info =
getCurrentPageInfo();


// =====================================================
// 메인 / 목록
// =====================================================

if (!info) {

animeId =
'';

episode =
'';

histories =
{};

currentVideo =
null;

lastSaveTime =
0;


// 캐시 데이터 즉시 표시
updateMainCards();


// 최신 데이터 백그라운드 조회
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


histories =
{};


currentVideo =
null;


lastSaveTime =
0;


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
}


// =========================================================
// 단축키
//
// 숫자패드 -
// 현재 재생 위치로 기록 강제 덮어쓰기
// =========================================================

document.addEventListener(

'keydown',

function (event) {


// 숫자패드 - 만 사용
if (
event.code !==
'NumpadSubtract'
) {

return;
}


// 키를 누르고 있을 때 반복 실행 방지
if (event.repeat) {
return;
}


if (!isWatchPage()) {
return;
}


event.preventDefault();

event.stopPropagation();


overwriteCurrentProgress();
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


lastUrl =
'';


checkPageChange();


// URL 변경
setInterval(

checkPageChange,

500
);


// VIDEO
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


// 표시 유지
setInterval(

function () {

if (
isWatchPage()
) {

updateAllLabels();

}

else {

updateMainCards();
}

},

500
);


})();