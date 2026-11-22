// =========================================================
// Bilibili Skipper Ultimate (Auto Enable/Disable)
// =========================================================

(function() { // Start of IIFE

if (window.hasBiliSkipperLoaded) {
    throw new Error("脚本已运行，跳过重复加载");
}
window.hasBiliSkipperLoaded = true;
const pageObservers = new Set();
SkipperCore.onInvalidated(() => {
    for (const observer of pageObservers) observer.disconnect?.();
    pageObservers.clear();
    window.removeEventListener?.('keydown', onKeyHandler, true);
    if (window.self === window.top) showRefreshNotice();
});
function showRefreshNotice() {
    if (document.getElementById('skipper-refresh-notice')) return;
    const notice = document.createElement('div'); notice.id = 'skipper-refresh-notice';
    notice.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;padding:10px 12px;border:1px solid #dce7ed;border-radius:8px;background:#fff;color:#40515e;font:12px/1.5 sans-serif;box-shadow:0 2px 12px #0002;display:flex;gap:10px;align-items:center;';
    const text = document.createElement('span'); text.textContent = '扩展已更新，刷新后恢复进度记录';
    const button = document.createElement('button'); button.textContent = '刷新页面';
    button.style.cssText = 'border:0;border-radius:4px;padding:4px 8px;background:#00aeec;color:white;cursor:pointer;';
    button.addEventListener('click', () => window.location.reload());
    notice.appendChild(text); notice.appendChild(button);
    (document.body || document.documentElement).appendChild(notice);
}

// 【新增】快速退出机制
// 如果当前 iframe 尺寸太小（可能是广告或统计代码），直接不运行脚本
if (window.self !== window.top) {
    // 如果宽或高小于 100px，通常不是视频播放器
    if (window.innerWidth < 100 || window.innerHeight < 100) return;
}

// --- 全局配置 ---
let config = {
    autoSkipEnable: false,
    enableIntro: true,
    enableOutro: true,
    autoRestart: false,
    autoUpdateFav: true,
    showWhitelistNotice: false,

    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300,
    autoPlayNext: false,
    keyForward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false },
    keyRewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false },
    favorites: {},

    // 【新增】
    customTagRules: [],
    customSeriesRules: [],
    onlySaveMaxEpisode: false,
    manualEnableSites: [],   // 记录用户手动开启的站点
    whitelistMode: true      // 【新增】白名单模式：仅对已收藏番剧生效（默认开启）
};

// Only a frame containing a video answers video requests.
let saveStatus = { state: '尚未保存', time: null, error: null };
let catalogSignature = '';
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'diagnostics') {
        const info = getCachedVideoInfo();
        sendResponse({ website: new URL(window.location.href).hostname, series: info.seriesName,
            episode: info.episodeName, collectionId: info.collectionId || null, videoDetected: !!findMainVideo(),
            autoUpdateFav: config.autoUpdateFav, saveStatus });
        return false;
    }
    if (request.action === 'getNiceTitle') {
        const info = getCachedVideoInfo();
        const found = SkipperCore.findFavorite(config.favorites, info.seriesName, null, info);
        sendResponse({ series: found ? found[0] : info.seriesName, sourceSeries: info.seriesName,
            episode: info.episodeName, url: window.location.href, site: info.siteName,
            collectionId: info.collectionId, collectionUrl: info.collectionUrl, pending: info.pending === true,
            scriptVersion: SkipperCore.scriptVersion, contextActive: SkipperCore.contextValid() });
        return false;
    }
    if (request.action === 'getRequestVideoInfo') {
        const video = findMainVideo();
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return false;
        const respond = () => {
            const info = getCachedVideoInfo();
            sendResponse({ isIframe: window.self !== window.top, series: info.seriesName,
                episode: info.episodeName, site: info.siteName, url: getResumeUrl(video),
                time: Math.floor(video.currentTime), duration: Math.floor(video.duration), timestamp: Date.now() });
        };
        if (window.self !== window.top && !isTopInfoReady) { refreshTopInfo(respond); return true; }
        respond();
        return false;
    }
    if (request.action === 'clickNext' && window.self === window.top) {
        sendResponse({ clicked: tryClickNext() });
    }
    return false;
});

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    if (!SkipperCore.contextValid()) return;
    config = { ...config, ...items };
    if (!config.keyForward || !config.keyForward.code) config.keyForward = { code: 'ArrowRight', shift: true, ctrl: false, alt: false };
    if (!config.keyRewind || !config.keyRewind.code) config.keyRewind = { code: 'ArrowLeft', shift: true, ctrl: false, alt: false };

    // 首次安装/更新后提示白名单模式
    if (window.self === window.top && config.showWhitelistNotice === true) {
        if (config.whitelistMode) showWhitelistNotification();
        chrome.storage.local.set({ showWhitelistNotice: false });
    }

    window.addEventListener('keydown', onKeyHandler, true);
    startMonitoring();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (!SkipperCore.contextValid()) return;
    if (area !== 'local') return;
    for (let key in changes) {
        if (config.hasOwnProperty(key)) {
            config[key] = changes[key].newValue;
        }
    }
});

function getResumeUrl(video) {
    return SkipperCore.resumeUrl(cachedTopUrl || window.location.href, video.currentTime);
}

function findMainVideo() {
    const videos = findVideosInShadow(document);
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];
    const playingVideo = videos.find(v => !v.paused && v.duration > 10);
    if (playingVideo) return playingVideo;
    return videos.sort((a, b) => {
        let durA = isFinite(a.duration) ? a.duration : 0;
        let durB = isFinite(b.duration) ? b.duration : 0;
        return durB - durA;
    })[0];
}

function isKeyMatch(event, keyConfig) {
    if (!keyConfig) return false;
    const code = event.code || event.key; 
    if (keyConfig.code === 'ArrowRight' && (code === 'ArrowRight' || event.key === 'ArrowRight')) {}
    else if (keyConfig.code === 'ArrowLeft' && (code === 'ArrowLeft' || event.key === 'ArrowLeft')) {}
    else if (code !== keyConfig.code) return false;

    if (event.shiftKey !== (keyConfig.shift || false)) return false;
    if (event.ctrlKey !== (keyConfig.ctrl || false)) return false;
    if (event.altKey !== (keyConfig.alt || false)) return false;
    return true;
}

function tryClickNext() {
    if (!SkipperCore.contextValid()) return false;
    const parts = getBiliParts();
    if (parts) {
        const next = parts.entries[parts.part];
        if (!parts.ready || !next?.node) return false;
        next.node.click();
        return true;
    }
    const collection = getBiliCollection();
    if (collection) {
        const current = SkipperCore.episodeNumber(collection.episodeName);
        if (current === null) return false;
        const candidates = [...collection.root.querySelectorAll('.simple-base-item .title')]
            .filter(el => SkipperCore.episodeNumber(el.getAttribute('title') || el.textContent) === current + 1);
        if (candidates.length !== 1) return false;
        candidates[0].click();
        return true;
    }
    const selectors = [
        '.bpx-player-ctrl-next', '.squirtle-video-next', 
        '.bilibili-player-video-btn-next', '[aria-label="下一个"]', 
        '.switch-btn.next', '#multi_page .cur + li a', '.nxt', '.next' 
    ];
    for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.getClientRects().length > 0) {
            btn.click();
            return true;
        }
    }
    return false;
}

function onKeyHandler(event) {
    if (!SkipperCore.contextValid()) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const isForward = isKeyMatch(event, config.keyForward);
    const isRewind = isKeyMatch(event, config.keyRewind);
    if (!isForward && !isRewind) return;
    const video = findMainVideo();
    if (!video) return;
    const skipTime = config.manualSkipTime || 90;
    if (isForward) {
        video.currentTime = Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, video.currentTime + skipTime);
        showToast(`>>> 快进 ${skipTime} 秒`);
    } else if (isRewind) {
        video.currentTime = Math.max(0, video.currentTime - skipTime);
        showToast(`<<< 快退 ${skipTime} 秒`);
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function parseVideoInfo(overrideTitle = null, overrideUrl = null) {
    // 优先使用传入的 overrideTitle，其次尝试使用缓存的顶层标题（如果存在），最后使用当前文档标题
    let rawTitle = (overrideTitle || cachedTopTitle || document.title).trim();
    // 优先使用传入的 overrideUrl，其次尝试使用缓存的顶层 URL（如果存在），最后使用当前窗口 URL
    const url = overrideUrl || cachedTopUrl || window.location.href;
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.length > 2 && !overrideTitle) {
        rawTitle = h1.innerText.trim() + " " + rawTitle; 
    }

    let seriesName = "";
    let episodeName = "";
    
    // ============ 【修改开始】 ============
    let siteName = null; 

    // 1. 优先遍历用户自定义规则
    if (config.customTagRules && Array.isArray(config.customTagRules)) {
        for (const rule of config.customTagRules) {
            if (rule.match && rule.name) {
                if (url.includes(rule.match) || rawTitle.includes(rule.match)) {
                    siteName = rule.name;
                    break; 
                }
            }
        }
    }

    // 2. 策略模式匹配站点
    const strategy = getSiteStrategy(url);
    if (!siteName) {
        siteName = strategy.name;
    }

    // =========== 【插入点：新增代码开始】 ===========
    // 如果策略里定义了专属 parser (例如上面的 B站 parser)，直接使用它！
    if (strategy.parser && !overrideTitle) { // 只有在非 iframe 消息传递时才使用 DOM 解析
        const customInfo = strategy.parser();
        if (customInfo) {
            // 再次检查用户自定义的番剧名修正规则 (config.customSeriesRules)
            let finalSeries = customInfo.seriesName;
            if (config.customSeriesRules && Array.isArray(config.customSeriesRules)) {
                for (const rule of config.customSeriesRules) {
                    if (rule.match && rule.name && (url.includes(rule.match) || finalSeries.includes(rule.match))) {
                        finalSeries = rule.name;
                        break;
                    }
                }
            }
            return { ...customInfo, seriesName: finalSeries, siteName };
        }
    }
    // =========== 【插入点：新增代码结束】 ===========

    let cleanTitle = rawTitle;
    
    // 应用站点特定的清理逻辑
    if (strategy.clean) {
        cleanTitle = strategy.clean(cleanTitle);
    }

    // 应用通用清理逻辑
    cleanTitle = cleanTitle
        .replace(/-全集.*/i, "")
        .replace(/_哔哩哔哩.*/i, "")
        .replace(/_bilibili.*/i, "")
        .replace(/在线观看.*/i, "")
        .replace(/_在线观看.*/i, "")
        .replace(/_高清.*/i, "")
        .replace(/播放器.*/i, "")   
        .trim();

    cleanTitle = cleanTitle.replace(/[《》]/g, "");

    // 1. 原有的标准匹配 (第x集 / Ep.x)
    // 允许后面跟随空格或下划线开头的内容，或者是行尾
    const matchEpisode = cleanTitle.match(/(.*?)[\s-]*(第\s*\d+\s*[集话]|Ep\.?\s*\d+|Vol\.\d+)/i);
    
    // 【修正】2. 特殊格式匹配规则 (支持 31~40)
    // 修改点：去掉了末尾的 $，改为 (?:$|[\s_].*)
    // 含义：数字范围后面，要么是结束，要么是 空格 或 下划线 开头的后缀
    const matchRange = cleanTitle.match(/^(.*?)[\s\._-]*(\d+\s*[~-]\s*\d+)(?:$|[\s_].*)/);
    
    // 【修正】3. B站常见的 "分P" 格式 (P1, P2)
    // 同样放宽了尾部限制
    const matchPart = cleanTitle.match(/^(.*?)[\s\._-]*(P\d+)(?:$|[\s_].*)/i);

    if (matchEpisode) {
        seriesName = matchEpisode[1].trim();
        episodeName = matchEpisode[2].trim();
    } else if (matchRange) {
        // 命中 "战国31~40_哔哩哔哩"
        // group[1] = 战国, group[2] = 31~40
        seriesName = matchRange[1].trim();
        episodeName = matchRange[2].trim();
    } else if (matchPart) {
        // 命中 "我的教程_P1_讲解"
        seriesName = matchPart[1].trim();
        episodeName = matchPart[2].trim();
    } else {
        // 原有的兜底逻辑 (通过空格或下划线分割)
        const parts = cleanTitle.split(/_| /);
        if (parts.length >= 2) {
            const lastPart = parts[parts.length - 1];
            // ... (保持原有逻辑不变)
            if (/^\d+$/.test(lastPart) || lastPart.length < 5) {
                episodeName = lastPart;
                seriesName = cleanTitle.replace(lastPart, "").trim();
                seriesName = seriesName.replace(/[_-]$/, "");
            } else {
                seriesName = cleanTitle;
            }
        } else {
            seriesName = cleanTitle;
        }
    }

    if (!episodeName) {
        const epMatch = rawTitle.match(/(第\s*\d+\s*[集话]|Ep\.?\s*\d+)/i);
        if (epMatch) episodeName = epMatch[0];
        else episodeName = "观看中";
    }
    
    seriesName = seriesName.replace(/(第\s*\d+\s*[集话]).*/, "").trim();
    if (seriesName.length === 0) seriesName = "未知番剧";

    // --- 【新增】自定义番剧名覆盖 ---
    // 允许用户通过关键词强制修正番剧名称 (例如: "进击的巨人 Final" -> "进击的巨人")
    if (config.customSeriesRules && Array.isArray(config.customSeriesRules)) {
        for (const rule of config.customSeriesRules) {
             if (rule.match && rule.name) {
                 // 匹配 URL 或 原始标题
                 if (url.includes(rule.match) || rawTitle.includes(rule.match)) {
                     seriesName = rule.name;
                     break; 
                 }
             }
        }
    }

    return { seriesName, episodeName, siteName };
}

// Playback state belongs to a media element, never to the entire page.
const playbackStates = new WeakMap();
const processedVideos = new WeakSet();
let cachedTopTitle = null;
let cachedTopUrl = null;
let cachedTopInfo = null;
let isTopInfoReady = window.self === window.top;
let topInfoRequestedAt = 0;
let topInfoPending = false;
let topInfoCallbacks = [];

// --- 站点策略 ---
function getBiliParts() {
    const url = new URL(window.location.href);
    const bv = /\/video\/(BV[a-zA-Z0-9]+)/.exec(url.pathname)?.[1];
    if (!/(^|\.)bilibili\.com$/.test(url.hostname) || !bv) return null;
    const h1 = document.querySelector('.video-title') || document.querySelector('h1');
    const title = (h1?.getAttribute('title') || h1?.textContent || '').trim();
    if (!title) return null;
    // Scope to the active BV: a category collection can contain hundreds of other parts.
    const head = document.querySelector('.video-pod .simple-base-item.active.head');
    const group = head?.closest('.multi-p');
    const standalone = group ? null : document.querySelector('.video-pod > .video-pod__body > .video-pod__list.multip');
    const legacy = document.querySelector('#multi_page');
    const list = group || standalone || legacy;
    const itemSelector = group ? '.page-item' : standalone ? ':scope > .video-pod__item' : '.list-box li, .cur-list li';
    const nodes = list ? [...list.querySelectorAll(itemSelector)] : [];
    const part = Number(url.searchParams.get('p') || 1);
    if (nodes.length < 2 && part <= 1 && !group && !standalone) return null;
    const entries = nodes.map((node, index) => {
        const label = node.querySelector('.title') || node.querySelector('.part');
        const text = (label?.getAttribute('title') || label?.textContent || '').trim() || `P${index + 1}`;
        const target = new URL(`https://www.bilibili.com/video/${bv}/`); target.searchParams.set('p', String(index + 1));
        return { node, title: text, number: SkipperCore.episodeNumber(text) ?? index + 1, part: index + 1, url: target.href };
    });
    const current = entries[part - 1];
    const active = list?.querySelector(list === legacy ? '.list-box .on, .cur-list .on' : `${itemSelector}.active`);
    const ready = !!current && (active ? active === current.node : !standalone)
        && (!head || (head.querySelector('.title')?.getAttribute('title') || '').trim() === title);
    const episodeName = current ? (/^\d+$/.test(current.title) ? `第${Number(current.title)}集` : current.title) : `P${part}`;
    return { seriesName: title, episodeName, part, entries, ready,
        collectionId: `bilibili:video:${bv}`, collectionUrl: `https://www.bilibili.com/video/${bv}/`, url: url.href };
}
function getBiliCollection() {
    if (!/(^|\.)bilibili\.com$/.test(new URL(window.location.href).hostname)) return null;
    const link = document.querySelector('.video-pod__header a[href*="collectiondetail?"]');
    if (!link) return null;
    const url = new URL(link.getAttribute('href'), window.location.href);
    const sid = url.searchParams.get('sid');
    if (url.hostname !== 'space.bilibili.com' || !/^\d+$/.test(sid || '')) return null;
    const root = link.closest('.video-pod');
    const h1 = document.querySelector('h1');
    if (!root || !h1) return null;
    const title = h1.getAttribute('title') || h1.textContent || '';
    const episode = title.match(/第\s*\d+\s*[集话]/)?.[0];
    // A category collection (e.g. 美漫) is not a series identity.
    if (!episode) return null;
    return { root, seriesName: (link.textContent || '').trim(), episodeName: episode,
        collectionId: `bilibili:collection:${sid}`, collectionUrl: `${url.origin}${url.pathname}?sid=${sid}`,
        url: window.location.href };
}
function syncCatalog(info, found) {
    if (!found || !info.collectionId) return;
    const parts = getBiliParts();
    const collection = getBiliCollection();
    if (!parts && !collection) return;
    if (parts && !parts.ready) return;
    const episodes = parts ? parts.entries.map(({ node, ...entry }) => entry) : [...collection.root.querySelectorAll('.simple-base-item .title')].map(el => {
        const title = el.getAttribute('title') || el.textContent || '';
        return { title, number: SkipperCore.episodeNumber(title) };
    }).filter(e => e.number !== null);
    const signature = `${found[1].id}:${JSON.stringify(episodes)}`;
    if (!episodes.length || signature === catalogSignature) return;
    catalogSignature = signature;
    SkipperCore.mutate({ type: 'catalog', key: found[0], id: found[1].id, collectionId: info.collectionId, episodes }, (_, error) => { if (error) catalogSignature = ''; });
}
function pendingEpisodeSelection() {
    const url = new URL(window.location.href);
    const target = url.searchParams.get('skipper_episode');
    const cid = url.searchParams.get('skipper_collection');
    if (!target || !cid) return false;
    if (!pendingEpisodeSelection.started) pendingEpisodeSelection.started = Date.now();
    if (Date.now() - pendingEpisodeSelection.started > 10000) {
        url.searchParams.delete('skipper_episode'); url.searchParams.delete('skipper_collection');
        window.history.replaceState(null, '', url.href);
        showToast('自动选集未完成，请在网页中选择集数');
        pendingEpisodeSelection.clicked = false; pendingEpisodeSelection.started = 0;
        return false;
    }
    const collection = getBiliCollection();
    if (!collection) return true;
    if (collection.collectionId !== cid) { showToast('选集失败：合集不匹配'); return true; }
    if (SkipperCore.episodeNumber(collection.episodeName) === Number(target)) {
        url.searchParams.delete('skipper_episode'); url.searchParams.delete('skipper_collection');
        window.history.replaceState(null, '', url.href);
        return false;
    }
    const matches = [...collection.root.querySelectorAll('.simple-base-item .title')].filter(el => SkipperCore.episodeNumber(el.getAttribute('title') || el.textContent) === Number(target));
    if (matches.length === 1) {
        if (!pendingEpisodeSelection.clicked) { pendingEpisodeSelection.clicked = true; matches[0].click(); }
    } else showToast('找不到唯一匹配的集数，请在网页中选集');
    return true;
}
const SITE_STRATEGIES = [
    {
        domain: 'bilibili.com',
        name: 'B站',
        // 【新增】自定义解析器：直接读 DOM，不依赖标题正则
        parser: () => {
            const parts = getBiliParts();
            if (parts) { const { entries, ready, ...info } = parts; return { ...info, pending: !ready }; }
            const collection = getBiliCollection();
            if (collection) { const { root, ...info } = collection; return info; }
            // 1. 锁定"系列名称" (Series):
            // B站视频的总标题通常在 .video-title (新版) 或 H1 中，这个标题在切P时不会变
            const h1 = document.querySelector('.video-title') || document.querySelector('#viewbox_report h1') || document.querySelector('h1');
            // 如果获取不到 title 属性，就取 innerText
            const seriesName = h1 ? (h1.title || h1.innerText).trim() : "";

            // 2. 锁定"集数名称" (Episode):
            let episodeName = "";
            
            // 尝试获取当前的分P号码 (URL中的 p 参数)
            const pMatch = window.location.href.match(/[?&]p=(\d+)/);
            const pNum = pMatch ? pMatch[1] : "1";

            // 尝试从右侧分P列表里抓取当前高亮的标题
            // 适配多种 B站 UI 结构 (.list-box .on 是旧版, .cur-list .on 是新版等)
            const activeEl = document.querySelector('.list-box .on') || 
                             document.querySelector('.cur-list .on');
            
            if (activeEl) {
                // 列表里通常显示 "1 课程简介"，直接用这个
                episodeName = activeEl.innerText.trim();
            } else {
                // 如果找不到列表（可能是单P视频），直接用 P+数字
                episodeName = `P${pNum}`;
                
                // 如果是合集视频但没列表（极其罕见），尝试读副标题
                const subTitle = document.title.split('_')[0];
                if (subTitle && subTitle !== seriesName) {
                     episodeName = `P${pNum} ${subTitle}`;
                }
            }

            // 如果连系列名都找不到（非视频页），返回 null 走默认逻辑
            if (!seriesName) return null;

            return { seriesName, episodeName };
        },
        clean: (title) => title.replace(/[_| -]bilibili.*/i, "").replace(/-国创.*/i, "").replace(/-番剧.*/i, "")
    },
    {
        domain: ['yinghuacd.com', 'yhdmp.com'],
        name: '樱花',
        clean: (title) => title.replace(/樱花动漫.*/i, "").replace(/_NT动漫.*/i, "")
    },
    {
        domain: 'iqiyi.com',
        name: '爱奇艺'
    },
    {
        domain: 'v.qq.com',
        name: '腾讯'
    },
    {
        domain: 'youku.com',
        name: '优酷'
    },
    {
        domain: 'mgtv.com',
        name: '芒果'
    }
];

function getSiteStrategy(url) {
    for (const strategy of SITE_STRATEGIES) {
        if (Array.isArray(strategy.domain)) {
            if (strategy.domain.some(d => url.includes(d))) return strategy;
        } else {
            if (url.includes(strategy.domain)) return strategy;
        }
    }
    return { name: 'Web', clean: (t) => t };
}

// 【新增】Shadow DOM 穿透查找
function findVideosInShadow(root = document) {
    let videos = Array.from(root.querySelectorAll('video'));
    // 递归查找所有 shadowRoot
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
        if (node.shadowRoot) {
            videos = videos.concat(findVideosInShadow(node.shadowRoot));
        }
    }
    return videos;
}

function getCachedVideoInfo() {
    if (window.self !== window.top && cachedTopInfo) return cachedTopInfo;
    // Titles and active episode DOM may change without a URL change.
    return parseVideoInfo();
}

function refreshTopInfo(callback) {
    if (callback) topInfoCallbacks.push(callback);
    if (topInfoPending) return;
    topInfoPending = true;
    topInfoRequestedAt = Date.now();
    SkipperCore.sendMessage({ action: 'getPageInfo' }, (response, error) => {
        topInfoPending = false;
        if (!error && response?.url) {
            cachedTopTitle = response.title || null;
            cachedTopUrl = response.url;
            cachedTopInfo = response.info ? { seriesName: response.info.sourceSeries || response.info.series,
                episodeName: response.info.episode, siteName: response.info.site,
                collectionId: response.info.collectionId, collectionUrl: response.info.collectionUrl, url: response.url } : null;
            isTopInfoReady = true;
        }
        const callbacks = topInfoCallbacks;
        topInfoCallbacks = [];
        if (SkipperCore.contextValid()) callbacks.forEach(cb => cb());
    });
}

function freshState() {
    return { identity: '', loadedAt: Date.now(), checkedAt: 0, lastSavedAt: 0, lastSavedTime: null,
        resumed: false, restoring: false, userSeeking: false, skippedIntro: false,
        switching: false, finishing: false, handledEnd: false, nextAttempted: false, cooldown: 0 };
}

function startMonitoring() {
    const observedRoots = new WeakSet();
    let scheduled = false;
    const scan = (root = document) => {
        if (!SkipperCore.contextValid()) return;
        root.querySelectorAll('video').forEach(attachVideoListener);
        root.querySelectorAll('*').forEach(node => { if (node.shadowRoot) scan(node.shadowRoot); });
        const target = root === document ? document.body || document.documentElement : root;
        if (!observedRoots.has(target)) {
            observedRoots.add(target);
            const observer = new MutationObserver(() => {
                if (!SkipperCore.contextValid()) return;
                if (scheduled) return;
                scheduled = true;
                setTimeout(() => { scheduled = false; scan(); }, 1000);
            });
            pageObservers.add(observer);
            observer.observe(target, { childList: true, subtree: true });
        }
    };
    if (window.self !== window.top) refreshTopInfo();
    scan();
    window.addEventListener('pagehide', () => {
        const video = findMainVideo();
        if (video) autoUpdateFavorites(video, true);
    });
}

function attachVideoListener(video) {
    if (processedVideos.has(video)) return;
    processedVideos.add(video);
    playbackStates.set(video, freshState());
    const reset = () => {
        if (!SkipperCore.contextValid()) return;
        playbackStates.set(video, freshState());
        if (window.self !== window.top) { isTopInfoReady = false; refreshTopInfo(); }
    };
    video.addEventListener('loadedmetadata', reset);
    video.addEventListener('emptied', reset);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', () => handleEnded(video));
    video.addEventListener('pause', () => autoUpdateFavorites(video, true));
    video.addEventListener('seeking', () => {
        if (!SkipperCore.contextValid()) return;
        const state = playbackStates.get(video);
        if (!state.restoring && !state.resumed) state.userSeeking = true;
        if (video.currentTime < 1) state.skippedIntro = false;
    });
}

function getPlaybackContext(video) {
    const info = getCachedVideoInfo();
    const found = SkipperCore.findFavorite(config.favorites, info.seriesName, null, info);
    syncCatalog(info, found);
    const item = found?.[1];
    const url = cachedTopUrl || window.location.href;
    const settings = SkipperCore.settings(config, config.whitelistMode ? item : null, url);
    let state = playbackStates.get(video);
    if (!state) { state = freshState(); playbackStates.set(video, state); }
    const identity = `${url}|${info.seriesName}|${info.episodeName}|${video.currentSrc || video.src || ''}`;
    if (state.identity && state.identity !== identity) {
        state = freshState(); playbackStates.set(video, state);
    }
    state.identity = identity;
    return { info, found, item, url, settings, state };
}

function restoreProgress(video, context) {
    const { info, url, settings, state } = context;
    if (info.pending) return false;
    const item = context.item?.episodeProgress?.[SkipperCore.canonicalUrl(url)] || context.item;
    if (state.restoring) {
        if (video.seeking || Math.abs(video.currentTime - state.restoreTarget) > 2) return false;
        state.restoring = false;
        state.resumed = true;
    }
    if (state.resumed) return true;
    // Give SPA titles and the site's own resume logic time to settle before any write.
    if (Date.now() - state.loadedAt < 1000) return false;
    let target = null;
    const nearEnd = time => video.duration - time < 30 || time / video.duration > 0.95;
    if (!state.userSeeking && settings.enabled && settings.autoRestart && nearEnd(video.currentTime)) {
        target = settings.enableIntro ? settings.introTime : 0;
    } else if (!state.userSeeking && item && video.currentTime <= 5 && SkipperCore.sameEpisode(item, info, url) && item.time > 5) {
        target = nearEnd(item.time) ? (settings.enabled && settings.enableIntro ? settings.introTime : 0) : item.time;
    }
    if (target !== null && target >= 0 && target < video.duration && Math.abs(target - video.currentTime) > 1) {
        try {
            state.restoring = true;
            state.restoreTarget = target;
            video.currentTime = target;
            state.skippedIntro = target >= settings.introTime;
            state.cooldown = Date.now() + 2000;
            showToast(`↪ 已恢复到 ${Math.floor(target)} 秒`);
            return false;
        } catch {
            state.restoring = false;
            return false;
        }
    }
    state.resumed = true;
    return true;
}

function autoUpdateFavorites(video, force = false) {
    if (!SkipperCore.contextValid()) return;
    if (pendingEpisodeSelection()) return;
    if (!config.autoUpdateFav || !isTopInfoReady || video !== findMainVideo()) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(video.currentTime)) return;
    const { info, found, url, state } = getPlaybackContext(video);
    if (info.pending || !found || !state.resumed || state.restoring || video.seeking) return;
    if (!force && Date.now() - state.lastSavedAt < 2000) return;
    if (!force && state.lastSavedTime === Math.floor(video.currentTime)) return;
    state.lastSavedAt = Date.now();
    state.lastSavedTime = Math.floor(video.currentTime);
    saveStatus = { state: '保存中', time: saveStatus.time, error: null };
    SkipperCore.mutate({ type: 'progress', key: found[0], id: found[1].id,
        flushSync: force,
        episode: info.episodeName, site: info.siteName, url, time: video.currentTime,
        collectionId: info.collectionId, collectionUrl: info.collectionUrl,
        duration: video.duration, timestamp: Date.now() }, (data, error) => {
        saveStatus = { state: error ? '保存失败' : '已保存', time: error ? saveStatus.time : Date.now(), error: error || null };
        if (error) { state.lastSavedAt = 0; state.lastSavedTime = null; if (SkipperCore.contextValid()) console.error('Skipper:', error); }
    });
}

function attemptNext(video, state, callback) {
    state.nextAttempted = true;
    if (tryClickNext()) { state.switching = true; callback(true); return; }
    if (window.self !== window.top) {
        SkipperCore.sendMessage({ action: 'clickNextInTop' }, (response, error) => {
            if (!SkipperCore.contextValid()) return;
            const clicked = !error && !!response?.clicked;
            state.switching = clicked;
            callback(clicked);
        });
    } else callback(false);
}

function restartVideo(video, settings, state) {
    const target = settings.enableIntro && settings.introTime < video.duration ? settings.introTime : 0;
    video.currentTime = target;
    state.skippedIntro = true;
    state.finishing = false;
    state.handledEnd = false;
    state.nextAttempted = false;
    state.cooldown = Date.now() + 2000;
    const playing = video.play();
    playing?.catch(() => showToast('已回到开头，请点击播放'));
}

function handleEnded(video) {
    if (!SkipperCore.contextValid()) return;
    if (pendingEpisodeSelection()) return;
    if (video !== findMainVideo() || !isTopInfoReady) return;
    const { settings, state } = getPlaybackContext(video);
    if (!SkipperCore.contextValid()) return;
    if (getCachedVideoInfo().pending) return;
    autoUpdateFavorites(video, true);
    if (!settings.enabled || !Number.isFinite(video.duration) || video.duration < settings.minDuration || state.switching || state.handledEnd) return;
    state.handledEnd = true;
    const finish = clicked => {
        if (playbackStates.get(video) !== state) return;
        if (clicked) showToast('🚀 正在切集...');
        else if (settings.autoRestart) restartVideo(video, settings, state);
    };
    if (settings.autoPlayNext && !state.nextAttempted) attemptNext(video, state, finish);
    else finish(false);
}

function handleTimeUpdate(e) {
    if (!SkipperCore.contextValid()) return;
    if (pendingEpisodeSelection()) return;
    const video = e.target;
    if (video !== findMainVideo() || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (window.self !== window.top && Date.now() - topInfoRequestedAt > 3000) refreshTopInfo();
    if (!isTopInfoReady) return;
    const context = getPlaybackContext(video);
    if (!SkipperCore.contextValid()) return;
    const { settings, state } = context;
    if (Date.now() - state.checkedAt < 500) return;
    state.checkedAt = Date.now();
    if (!restoreProgress(video, context)) return;
    autoUpdateFavorites(video);
    if (!SkipperCore.contextValid()) return;
    if (!settings.enabled || video.duration < settings.minDuration || state.switching || video.seeking) return;
    const outroStart = video.duration - (settings.enableOutro ? settings.outroTime : 0);
    if (settings.enableIntro && settings.introTime < outroStart && !state.skippedIntro && video.currentTime > 0.5 && video.currentTime < settings.introTime) {
        video.currentTime = settings.introTime;
        state.skippedIntro = true;
        showToast('🚀 跳过片头');
    }
    if (settings.enableOutro && settings.outroTime > 0 && outroStart > 0 && video.currentTime >= outroStart && video.currentTime < video.duration && Date.now() >= state.cooldown && !state.finishing) {
        state.finishing = true;
        const finish = clicked => {
            if (!SkipperCore.contextValid()) return;
            if (playbackStates.get(video) !== state) return;
            if (clicked) showToast('🚀 正在切集...');
            else { video.currentTime = video.duration; showToast('🚀 跳过片尾'); }
        };
        if (settings.autoPlayNext) attemptNext(video, state, finish);
        else finish(false);
    }
}

let toastTimeout;
function showWhitelistNotification() {
    let notice = document.getElementById('bili-skipper-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'bili-skipper-notice';
        notice.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
            background: #fff; border: 2px solid #722ed1; border-radius: 12px;
            padding: 16px 20px; max-width: 340px;
            font-family: "Segoe UI", sans-serif; font-size: 13px; color: #333;
            box-shadow: 0 4px 20px rgba(114, 46, 209, 0.15);
            line-height: 1.5;
        `;
        notice.innerHTML = `
            <div style="display:flex; align-items:center; margin-bottom:8px;">
                <span style="font-size:18px; margin-right:8px;">🎯</span>
                <strong style="color:#722ed1; font-size:14px;">白名单模式已启用</strong>
            </div>
            <div style="font-size:12px; color:#666; margin-bottom:12px;">
                自动跳过仅对<strong>已收藏的番剧</strong>生效。<br>
                未收藏的视频不会触发跳过行为。
            </div>
            <div style="display:flex; gap:8px;">
                <button id="bili-notice-gotit" style="background:#722ed1; color:#fff; border:none;
                    padding:6px 16px; border-radius:6px; cursor:pointer; font-size:12px;">知道了</button>
                <button id="bili-notice-settings" style="background:#f0f0f0; color:#333; border:none;
                    padding:6px 16px; border-radius:6px; cursor:pointer; font-size:12px;">修改设置</button>
            </div>
        `;
        document.body.appendChild(notice);

        document.getElementById('bili-notice-gotit').addEventListener('click', () => {
            notice.style.opacity = '0';
            notice.style.transition = 'opacity 0.3s';
            setTimeout(() => notice.remove(), 300);
        });

        document.getElementById('bili-notice-settings').addEventListener('click', () => {
            SkipperCore.sendMessage({ action: 'openOptionsPage' });
            notice.style.opacity = '0';
            notice.style.transition = 'opacity 0.3s';
            setTimeout(() => notice.remove(), 300);
        });
    }
}

function showToast(text) {
    let toast = document.getElementById('bili-skipper-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bili-skipper-toast';
        toast.style.cssText = `
            position: fixed; top: 15%; left: 50%; transform: translateX(-50%);
            background-color: rgba(0, 174, 236, 0.9); color: white; padding: 8px 20px;
            border-radius: 20px; font-size: 14px; z-index: 2147483647; pointer-events: none;
            transition: opacity 0.3s; font-family: sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;
    }
    
    // 【优化】防止全屏模式下 Toast 被遮挡
    // 优先插入到当前全屏元素内部，否则插入到 body
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    const targetContainer = fullscreenElement || document.body;
    
    if (toast.parentNode !== targetContainer) {
        targetContainer.appendChild(toast);
    }

    toast.innerText = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

})(); // End of IIFE
