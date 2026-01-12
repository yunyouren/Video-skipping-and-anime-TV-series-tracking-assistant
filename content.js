// =========================================================
// Bilibili Skipper Ultimate (Auto Enable/Disable)
// =========================================================

(function() { // Start of IIFE

if (window.hasBiliSkipperLoaded) {
    throw new Error("脚本已运行，跳过重复加载");
}
window.hasBiliSkipperLoaded = true;

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
    customTagRules: [],
    customSeriesRules: []
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

    // 【新增】主页面接收来自 Background (其实是 Iframe) 的进度同步
    if (request.action === "triggerAutoUpdate") {
        // 调用保存函数，传入 Iframe 里的时间和时长
        // 第一个参数传 null，因为主页面可能没有 video 标签，不需要它
        autoUpdateFavorites(null, request.time, request.duration);
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
        // 移除 rawTitle.includes("樱花") 模糊匹配，只保留域名匹配，确保来源识别精准且一致
        else if (url.includes("yinghuacd") || url.includes("yhdmp")) siteName = "樱花";
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

// --- 监控与更新 ---
let hasSkippedIntro = false;
let hasTriggeredRestart = false; 
let videoLoadStartTime = 0;      
let restartCooldownTime = 0;
let lastFavUpdateTime = 0;
let cachedTopTitle = null; // 缓存顶层标题 (解决 Iframe 无法获取标题问题)
let cachedTopUrl = null;
let isTopInfoReady = false; // 标记顶层信息是否已就绪

// 【新增】视频信息缓存
let cachedVideoInfo = null;
let lastParseUrl = "";
let lastUrl = window.location.href; // 用于检测 SPA URL 变化

const processedVideos = new WeakSet();

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
    const currentUrl = window.location.href;
    // 如果 URL 变了，或者缓存为空，则重新解析
    if (currentUrl !== lastParseUrl || !cachedVideoInfo) {
        cachedVideoInfo = parseVideoInfo();
        lastParseUrl = currentUrl;
    }
    return cachedVideoInfo;
}

function startMonitoring() {
    // 1. 首次运行：处理页面上已存在的 video (支持 Shadow DOM)
    const scan = () => findVideosInShadow(document).forEach(attachVideoListener);
    scan();

    // 2. 优化后的观察者：防抖/节流处理，避免遍历 mutations
    let timeout = null;
    const observer = new MutationObserver((mutations) => {
        if (timeout) return; // 如果已有计划任务，则忽略当前触发
        
        timeout = setTimeout(() => {
            scan();
            timeout = null;
        }, 1000); // 1秒检查一次
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
}

function attachVideoListener(video) {
    if (processedVideos.has(video)) return; // 避免重复绑定
    processedVideos.add(video);

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

            // 清除视频信息缓存，确保新视频加载时重新解析
            cachedVideoInfo = null;
            lastParseUrl = "";

            if (window.self !== window.top) isTopInfoReady = false; // Iframe 中重置就绪状态
            
            // 立即刷新一次顶层信息
            if (window.self !== window.top) {
                 chrome.runtime.sendMessage({ action: "getTabTitle" }, (response) => {
                     if (response) {
                         if (response.title) cachedTopTitle = response.title;
                         if (response.url) cachedTopUrl = response.url;
                         isTopInfoReady = true;
                     }
                 });
            }
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
}

function autoUpdateFavorites(video, overrideTime = null, overrideDuration = null) {
    if (!config.autoUpdateFav) return;

    // 1. 如果是在 Iframe 里，我们不再自己保存，而是发送消息给主页面让它保存
    // 这样能确保解析的标题来源和手动收藏时完全一致
    if (window.self !== window.top) {
        const now = Date.now();
        // 限制发送频率，避免消息轰炸 (每 5 秒同步一次)
        if (now - lastFavUpdateTime < 5000) return;
        
        chrome.runtime.sendMessage({
            action: "syncVideoProgress",
            time: video.currentTime,
            duration: video.duration
        });
        lastFavUpdateTime = now;
        return; // Iframe 的任务结束，直接退出
    }

    // 2. 以下逻辑只在主页面 (Top Frame) 执行 ===========================
    
    // 确定时间：如果有外部传入的时间(来自Iframe)，就用外部的；否则用自己的(针对非Iframe视频)
    const currentTime = overrideTime !== null ? overrideTime : (video ? video.currentTime : 0);
    const duration = overrideDuration !== null ? overrideDuration : (video ? video.duration : 0);
    
    // 主页面解析：这里的 parseVideoInfo 拥有最高权限，能看到 H1 和 URL
    const info = getCachedVideoInfo(); // 使用缓存
    const sName = info.seriesName;
    const latestFavs = config.favorites || {}; // 直接读内存

    // 只有已收藏的才更新
    if (!latestFavs[sName]) return;
    
    // 【优化】: 增加写入节流
    // 如果进度变化很小(比如暂停时)，不要重复写入 storage
    const existingItem = latestFavs[sName];
    if (Math.abs(existingItem.time - currentTime) < 2 && existingItem.url === window.location.href) {
        return; // 变化太小，跳过写入
    }

    // 构造新数据
    const newData = {
        ...existingItem,
        series: sName,
        episode: info.episodeName,
        site: info.siteName, // 这里用的就是主页面的解析结果，和手动收藏绝对一致！
        // URL 始终使用主页面的 URL，彻底解决了 Iframe 乱码链接的问题
        url: window.location.href,
        time: Math.floor(currentTime),
        duration: Math.floor(duration),
        timestamp: Date.now()
    };

    // 如果是 Iframe 同步过来的，我们只更新时间，不轻易改 URL (防止单页应用 URL 没变的情况)
    // 但通常保持 window.location.href 是最安全的，因为它就是用户看到的链接
    
    latestFavs[sName] = newData;
    chrome.storage.local.set({ favorites: latestFavs });
    
    // 更新内存缓存
    config.favorites = latestFavs;
}

function handleTimeUpdate(e) {
    // 【新增】检测 SPA URL 变化
    // 很多网站（如 B站）切换集数时页面不刷新，但 URL 变了
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("Skipper: 检测到 URL 变化，强制重置状态");
        
        // 强制重置状态，重新匹配规则
        cachedVideoInfo = null; // 清除缓存
        lastParseUrl = "";
        
        // 重新运行匹配逻辑
        checkAndApplyAutoMatch();
        
        // 可能需要重置其他状态，例如
        hasSkippedIntro = false;
        hasTriggeredRestart = false;
        isSwitchingEpisode = false;
        videoLoadStartTime = Date.now();
    }

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

})(); // End of IIFE