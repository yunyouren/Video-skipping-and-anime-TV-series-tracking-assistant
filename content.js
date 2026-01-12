// =========================================================
// Bilibili Skipper Ultimate (Auto Enable/Disable)
// =========================================================

if (window.hasBiliSkipperLoaded) {
    throw new Error("脚本已运行，跳过重复加载");
}
window.hasBiliSkipperLoaded = true;

// --- 全局配置 ---
let config = {
    autoSkipEnable: false,
    enableIntro: true,
    enableOutro: true,
    autoRestart: false,
    autoUpdateFav: true,
    autoApplyPreset: true,

    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300,
    autoPlayNext: false,
    keyForward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false },
    keyRewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false },
    savedPresets: [],
    favorites: {},
    
    // 【新增】
    customTagRules: []
};

let isSwitchingEpisode = false;
let lastCheckTime = 0;

// --- 消息监听 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getNiceTitle") {
        const info = parseVideoInfo(); 
        sendResponse({ series: info.seriesName, episode: info.episodeName, url: window.location.href, site: info.siteName });
        return true;
    }
    if (request.action === "getRequestVideoInfo") {
        const video = findMainVideo();
        if (!video) return; 
        try {
            const info = parseVideoInfo();
            const data = {
                isIframe: (window.self !== window.top),
                series: info.seriesName, 
                episode: info.episodeName,     
                site: info.siteName,
                url: getResumeUrl(video),
                time: Math.floor(video.currentTime),
                duration: Math.floor(video.duration || 0),
                timestamp: Date.now()
            };
            sendResponse(data);
        } catch (e) {
            console.error("Skipper: 解析出错", e);
        }
    }
    return true; 
});

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    config = { ...config, ...items };
    if (!config.keyForward || !config.keyForward.code) config.keyForward = { code: 'ArrowRight', shift: true, ctrl: false, alt: false };
    if (!config.keyRewind || !config.keyRewind.code) config.keyRewind = { code: 'ArrowLeft', shift: true, ctrl: false, alt: false };

    // 页面加载时执行一次匹配
    checkAndApplyAutoMatch();

    window.addEventListener('keydown', onKeyHandler, true);
    if (!window.biliMonitorInterval) startMonitoring();
});

chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
        if (config.hasOwnProperty(key)) {
            config[key] = changes[key].newValue;
        }
    }
});

// --- 【核心修改】自动匹配与开关控制 ---
function checkAndApplyAutoMatch() {
    // 1. 如果用户关了自动应用，直接退出（不做任何改变）
    if (!config.autoApplyPreset) return;

    if (!config.savedPresets || config.savedPresets.length === 0) return;
    
    const currentUrl = window.location.href;
    const currentTitle = document.title; 

    // 2. 寻找匹配项
    const matchedPreset = config.savedPresets.find(p => {
        if (!p.domain || p.domain.trim() === "") return false;
        const keyword = p.domain.trim();
        return currentUrl.includes(keyword) || currentTitle.includes(keyword);
    });

    if (matchedPreset) {
        // --- 匹配成功：自动开启并应用 ---
        console.log("Skipper: 匹配成功 ->", matchedPreset.name);
        
        // 更新内存配置
        config.autoSkipEnable = true; // 强制开启
        config.introTime = matchedPreset.intro;
        config.outroTime = matchedPreset.outro;
        config.autoRestart = matchedPreset.restart;
        config.autoPlayNext = matchedPreset.next;
        config.enableIntro = (matchedPreset.intro > 0);
        config.enableOutro = (matchedPreset.outro > 0);

        // 持久化保存 (让Popup能看到变化)
        chrome.storage.local.set({
            autoSkipEnable: true,
            introTime: matchedPreset.intro,
            outroTime: matchedPreset.outro,
            autoRestart: matchedPreset.restart,
            autoPlayNext: matchedPreset.next,
            enableIntro: (matchedPreset.intro > 0),
            enableOutro: (matchedPreset.outro > 0),
            lastActivePreset: matchedPreset.name // 记录名字供Popup显示
        });

        showToast(`⚡ 已激活方案: ${matchedPreset.name}`);

    } else {
        // --- 匹配失败：自动关闭 ---
        // 只有当之前是开启状态时，才去关闭它，避免重复写入
        if (config.autoSkipEnable === true) {
            console.log("Skipper: 无匹配方案，自动关闭");
            config.autoSkipEnable = false;
            
            chrome.storage.local.set({
                autoSkipEnable: false,
                lastActivePreset: "" // 清空显示
            });
        }
    }
}

// --- 辅助函数 ---
function getResumeUrl(video) {
    let url = window.location.href;
    // 如果在 Iframe 中且成功获取了顶层 URL，优先使用顶层 URL
    if (window.self !== window.top && cachedTopUrl) {
        url = cachedTopUrl;
    }
    const time = Math.floor(video.currentTime);
    if (url.includes("bilibili.com")) {
        url = url.replace(/[\?&]t=\d+/, "");
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}t=${time}`;
    }
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
        url = url.replace(/[\?&]t=\d+s?/, "");
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}t=${time}`;
    }
    return url;
}

function findMainVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
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
    const selectors = [
        '.bpx-player-ctrl-next', '.squirtle-video-next', 
        '.bilibili-player-video-btn-next', '[aria-label="下一个"]', 
        '.switch-btn.next', '#multi_page .cur + li a', '.nxt', '.next' 
    ];
    for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
            btn.click();
            return true;
        }
    }
    return false;
}

function onKeyHandler(event) {
    const isForward = isKeyMatch(event, config.keyForward);
    const isRewind = isKeyMatch(event, config.keyRewind);
    if (!isForward && !isRewind) return;
    const video = findMainVideo();
    if (!video) return;
    const skipTime = config.manualSkipTime || 90;
    if (isForward) {
        video.currentTime += skipTime;
        showToast(`>>> 快进 ${skipTime} 秒`);
    } else if (isRewind) {
        video.currentTime -= skipTime;
        showToast(`<<< 快退 ${skipTime} 秒`);
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function parseVideoInfo(overrideTitle = null, overrideUrl = null) {
    let rawTitle = (overrideTitle || document.title).trim();
    // 优先使用传入的 overrideUrl，其次尝试使用缓存的顶层 URL（如果存在），最后使用当前窗口 URL
    const url = overrideUrl || cachedTopUrl || window.location.href;
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.length > 2 && !overrideTitle) {
        rawTitle = h1.innerText.trim() + " " + rawTitle; 
    }

    let seriesName = "";
    let episodeName = "";
    
    // ============ 【修改开始】 ============
    let siteName = null; // 先不设默认值

    // 1. 优先遍历用户自定义规则
    // config.customTagRules 是从 storage 自动同步过来的
    if (config.customTagRules && Array.isArray(config.customTagRules)) {
        for (const rule of config.customTagRules) {
            // 确保规则有效
            if (rule.match && rule.name) {
                // 检查 URL 或 标题 是否包含关键词
                if (url.includes(rule.match) || rawTitle.includes(rule.match)) {
                    siteName = rule.name;
                    break; // 找到匹配项后立即停止，不再继续
                }
            }
        }
    }

    // 2. 如果自定义规则没匹配到，再跑默认逻辑
    if (!siteName) {
        if (url.includes("bilibili.com")) siteName = "B站";
        else if (url.includes("iqiyi")) siteName = "爱奇艺";
        else if (url.includes("yinghuacd") || url.includes("yhdmp") || rawTitle.includes("樱花")) siteName = "樱花";
        else if (url.includes("v.qq.com")) siteName = "腾讯";
        else if (url.includes("youku")) siteName = "优酷";
        else if (url.includes("mgtv")) siteName = "芒果";
        else siteName = "Web"; // 最后的保底
    }
    // ============ 【修改结束】 ============

    let cleanTitle = rawTitle
        .replace(/_bilibili.*/i, "")
        .replace(/-bilibili.*/i, "")
        .replace(/-国创.*/i, "")
        .replace(/-番剧.*/i, "")
        .replace(/-全集.*/i, "")
        .replace(/在线观看.*/i, "")
        .replace(/_在线观看.*/i, "")
        .replace(/_高清.*/i, "")
        .replace(/_NT动漫.*/i, "")
        .replace(/樱花动漫.*/i, "") 
        .replace(/播放器.*/i, "")   
        .trim();

    cleanTitle = cleanTitle.replace(/[《》]/g, "");

    const matchEpisode = cleanTitle.match(/(.*?)[\s-]*(第\s*\d+\s*[集话]|Ep\.?\s*\d+|Vol\.\d+)/i);
    
    if (matchEpisode) {
        seriesName = matchEpisode[1].trim(); 
        episodeName = matchEpisode[2].trim(); 
    } else {
        const parts = cleanTitle.split(/_| /); 
        if (parts.length >= 2) {
            const lastPart = parts[parts.length - 1];
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

    return { seriesName, episodeName, siteName };
}

// --- 监控与更新 ---
let hasSkippedIntro = false;
let hasTriggeredRestart = false; 
let videoLoadStartTime = 0;      
let restartCooldownTime = 0;
let lastFavUpdateTime = 0;
let cachedTopTitle = null; // 缓存顶层标题 (解决 Iframe 无法获取标题问题)
let cachedTopUrl = null;
let isTopInfoReady = false; // 标记顶层信息是否已就绪

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        // 如果在 Iframe 中且没有缓存过标题，尝试向 Background 获取顶层标题
        if (window.self !== window.top && (!cachedTopTitle || !cachedTopUrl)) {
             chrome.runtime.sendMessage({ action: "getTabTitle" }, (response) => {
                 if (response) {
                     if (response.title) cachedTopTitle = response.title;
                     if (response.url) cachedTopUrl = response.url;
                     isTopInfoReady = true;
                     console.log("Skipper: 已获取顶层信息 ->", cachedTopTitle, cachedTopUrl);
                 }
             });
        } else if (window.self === window.top) {
            isTopInfoReady = true; // 顶层页面无需等待
        }

        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            const resetState = () => { 
                hasSkippedIntro = false; 
                isSwitchingEpisode = false; 
                hasTriggeredRestart = false; 
                videoLoadStartTime = Date.now(); 
                restartCooldownTime = 0; 
                lastFavUpdateTime = 0; 
                cachedTopTitle = null;
                cachedTopUrl = null;
                if (window.self !== window.top) isTopInfoReady = false; // Iframe 中重置就绪状态
                
                // 立即刷新一次顶层信息
                chrome.runtime.sendMessage({ action: "getTabTitle" }, (response) => {
                    if (response) {
                        if (response.title) cachedTopTitle = response.title;
                        if (response.url) cachedTopUrl = response.url;
                        isTopInfoReady = true;
                    }
                });
                setTimeout(checkAndApplyAutoMatch, 1000);
            };
            video.addEventListener('loadedmetadata', resetState);
            video.addEventListener('durationchange', resetState); 
            video.addEventListener('emptied', resetState);
            video.addEventListener('seeking', () => { 
                if(video.currentTime < 1) hasSkippedIntro = false; 
            });
            videoLoadStartTime = Date.now();
            video.dataset.hasSkipperListener = 'true';
        }
    }, 1000);
}

function autoUpdateFavorites(video) {
    if (!config.autoUpdateFav) return;

    // 如果在 Iframe 中且尚未获取到顶层信息，坚决不更新，防止覆盖正确数据
    if (window.self !== window.top && !isTopInfoReady) return;

    // 如果在 Iframe 中且尚未获取到顶层 URL，我们尝试使用 existingItem.url 进行回退，而不是直接 return
    // if (window.self !== window.top && !cachedTopUrl) return; // 移除之前的强硬拦截

    const now = Date.now();
    if (now - lastFavUpdateTime < 10000) return;
    if (video.currentTime < 10) return;

    try {
        // 如果有缓存的顶层标题 (Iframe 情况)，优先使用它进行解析
        const info = parseVideoInfo(cachedTopTitle, cachedTopUrl);
        const sName = info.seriesName;
        
        // --- 修复：使用异步获取最新数据，防止覆盖 Popup 的修改 ---
        chrome.storage.local.get({ favorites: {} }, (items) => {
            const latestFavs = items.favorites || {};
            
            // 只有当番剧已经在收藏夹中时，才自动更新进度
            if (!latestFavs[sName]) {
                return;
            }
            
            const existingItem = latestFavs[sName];

            // --- URL 保护逻辑 ---
            // 默认尝试获取当前 URL (可能会优先用 cachedTopUrl)
            let finalUrl = getResumeUrl(video);
            
            // 如果我们在 Iframe 中，且没有获取到有效的 cachedTopUrl (或者 getResumeUrl 返回了 iframe 地址)
            // 并且我们有已存在的有效 URL，则优先复用已存在的 URL，防止被 iframe 地址覆盖
            if (window.self !== window.top) {
                const isCachedUrlAvailable = !!cachedTopUrl;
                
                // 如果没有 cachedTopUrl，或者 finalUrl 看起来和 existingItem.url 域名差异巨大(简单判定)，则回退
                if (!isCachedUrlAvailable && existingItem.url) {
                    // 复用旧 URL，但需要更新时间参数
                    let baseOldUrl = existingItem.url;
                    
                    // 清理旧的时间参数
                    baseOldUrl = baseOldUrl.replace(/[\?&]t=\d+s?/, "").replace(/[\?&]t=\d+/, "");
                    if (baseOldUrl.endsWith('?') || baseOldUrl.endsWith('&')) baseOldUrl = baseOldUrl.slice(0, -1);

                    // 重新附加时间 (仅针对 B站/Youtube 等需要参数的站点，普通站点直接用 baseOldUrl)
                    if (baseOldUrl.includes("bilibili.com") || baseOldUrl.includes("youtube.com") || baseOldUrl.includes("youtu.be")) {
                         const separator = baseOldUrl.includes("?") ? "&" : "?";
                         finalUrl = `${baseOldUrl}${separator}t=${Math.floor(video.currentTime)}`;
                    } else {
                         // 对于通用站点，通常不需要 t= 参数，直接使用原 URL
                         finalUrl = baseOldUrl;
                    }
                    console.log("Skipper: Iframe 环境未获取到顶层URL，复用旧URL ->", finalUrl);
                }
            }

            // --- 优化：使用解构保留所有原有字段 (如 folder, notes 等) ---
            const newData = {
                ...existingItem, // 保留原有的 folder 等属性
                series: sName,
                episode: info.episodeName,
                // 优先使用已存在的 site 标签，防止自动更新时因环境问题导致标签变动 (如 樱花 -> Web)
                site: existingItem.site || info.siteName,
                url: finalUrl,
                time: Math.floor(video.currentTime),
                duration: Math.floor(video.duration || 0),
                timestamp: now
            };

            latestFavs[sName] = newData;
            
            chrome.storage.local.set({ favorites: latestFavs });
            
            // 更新本地缓存，保持一致性
            config.favorites = latestFavs;
            lastFavUpdateTime = now;
        });

    } catch (e) { }
}

function handleTimeUpdate(e) {
    const now = Date.now();
    if (now - lastCheckTime < 500) {
        return;
    }
    lastCheckTime = now;

    const video = e.target;
    autoUpdateFavorites(video);

    if (config.autoSkipEnable !== true) return;
    if (video.duration < config.minDuration) return; 

    if (config.autoRestart === true && !hasTriggeredRestart) {
        if (Date.now() - videoLoadStartTime < 4000) {
            const timeLeft = video.duration - video.currentTime;
            if (timeLeft < 30 || video.currentTime / video.duration > 0.95) {
                const outroTriggerTime = video.duration - (config.enableOutro ? config.outroTime : 0);
                let targetPos = config.enableIntro ? config.introTime : 0;
                if (targetPos >= outroTriggerTime) { targetPos = 0; }
                video.currentTime = targetPos;
                showToast(`↺ 已重置到 ${targetPos}秒`);
                hasTriggeredRestart = true;
                hasSkippedIntro = true;
                restartCooldownTime = Date.now() + 5000; 
            }
        }
    }

    const outroTriggerTime = video.duration - (config.enableOutro ? config.outroTime : 0);
    const targetIntroTime = config.introTime;
    const isOverlap = targetIntroTime >= outroTriggerTime;

    if (config.enableIntro === true && !isOverlap) { 
        if (video.currentTime < targetIntroTime && !hasSkippedIntro && video.currentTime > 0.5) {
             if (Date.now() < restartCooldownTime) {
                 hasSkippedIntro = true; 
             } else if (targetIntroTime < video.duration) {
                video.currentTime = targetIntroTime;
                hasSkippedIntro = true;
                showToast(`🚀 跳过片头`);
            }
        }
    }

    if (config.enableOutro === true) {
        if (Date.now() < restartCooldownTime) return;
        if (config.outroTime > 0) {
            if (video.currentTime > outroTriggerTime && video.currentTime < video.duration) {
                if (Date.now() - videoLoadStartTime < 4000 && !hasTriggeredRestart) return;
                if (isSwitchingEpisode) return;
                if (config.autoPlayNext === true) {
                    const success = tryClickNext();
                    if (success) {
                        isSwitchingEpisode = true;
                        showToast('🚀 正在切集...');
                        return;
                    }
                }
                if (!isSwitchingEpisode) { 
                    video.currentTime = video.duration; 
                    showToast(`🚀 跳过片尾`);
                }
            }
        }
    }
}

let toastTimeout;
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
        document.body.appendChild(toast);
    }
    toast.innerText = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}