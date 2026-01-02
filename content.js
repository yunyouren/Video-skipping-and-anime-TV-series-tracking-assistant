// =========================================================
// Bilibili Skipper Ultimate (Iframe Fix)
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
    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300,
    autoPlayNext: false,
    keyForward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false },
    keyRewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false },
    savedPresets: [],
    favorites: {}
};

let isSwitchingEpisode = false;

// --- 消息监听 (核心修改) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // 指令1: 仅获取页面标题 (用于主Frame)
    if (request.action === "getNiceTitle") {
        const info = parseVideoInfo(); // 尝试解析
        sendResponse({
            series: info.seriesName,
            episode: info.episodeName,
            url: window.location.href
        });
        return true;
    }

    // 指令2: 获取视频进度 (用于播放器Frame)
    if (request.action === "getRequestVideoInfo") {
        const video = findMainVideo();
        // 如果当前Frame没有视频，直接忽略，不返回任何东西
        // 这样Popup就不会收到错误的"无视频"响应
        if (!video) return; 

        try {
            // 尽力解析一下当前Frame的标题(可能是错误的)
            const info = parseVideoInfo();
            const data = {
                // 标记一下：如果是播放器iframe，标题往往很短或者包含"播放器"
                isIframe: (window.self !== window.top),
                series: info.seriesName, 
                episode: info.episodeName,     
                site: info.siteName,
                url: window.location.href,
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
    // 默认按键保护
    if (!config.keyForward || !config.keyForward.code) config.keyForward = { code: 'ArrowRight', shift: true, ctrl: false, alt: false };
    if (!config.keyRewind || !config.keyRewind.code) config.keyRewind = { code: 'ArrowLeft', shift: true, ctrl: false, alt: false };

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

function checkAndApplyAutoMatch() {
    if (!config.savedPresets || config.savedPresets.length === 0) return;
    const currentUrl = window.location.href;
    const currentTitle = document.title; 
    const matchedPreset = config.savedPresets.find(p => {
        if (!p.domain || p.domain.trim() === "") return false;
        const keyword = p.domain.trim();
        return currentUrl.includes(keyword) || currentTitle.includes(keyword);
    });
    if (matchedPreset) {
        config.introTime = matchedPreset.intro;
        config.outroTime = matchedPreset.outro;
        config.autoRestart = matchedPreset.restart;
        config.autoPlayNext = matchedPreset.next;
        config.enableIntro = (matchedPreset.intro > 0);
        config.enableOutro = (matchedPreset.outro > 0);
    }
}

// --- 辅助函数 ---
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
        '.switch-btn.next', '#multi_page .cur + li a',
        '.nxt', '.next' 
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

// --- 智能信息提取 (针对樱花动漫优化) ---
function parseVideoInfo() {
    let rawTitle = document.title.trim();
    const url = window.location.href;
    
    // 尝试寻找 H1 标签 (樱花动漫通常在 H1 里写了真名)
    // 即使在 iframe 里找不到，如果是主Frame调用这个函数就能找到了
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.length > 2) {
        // 如果 H1 看起来像个标题，优先使用 H1
        rawTitle = h1.innerText.trim() + " " + rawTitle; 
    }

    let seriesName = "";
    let episodeName = "";
    let siteName = "Web";

    if (url.includes("bilibili.com")) siteName = "B站";
    else if (url.includes("iqiyi")) siteName = "爱奇艺";
    else if (url.includes("yinghuacd") || rawTitle.includes("樱花")) siteName = "樱花";

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
        .replace(/樱花动漫.*/i, "") // 去掉樱花后缀
        .replace(/播放器.*/i, "")   // 去掉播放器字样
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

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            const resetState = () => { 
                hasSkippedIntro = false; 
                isSwitchingEpisode = false; 
                hasTriggeredRestart = false; 
                videoLoadStartTime = Date.now(); 
                restartCooldownTime = 0; 
                lastFavUpdateTime = 0; 
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
    const now = Date.now();
    if (now - lastFavUpdateTime < 10000) return;
    if (video.currentTime < 10) return;

    // 自动更新时，因为没法跨Frame询问标题，所以这里有个局限：
    // 如果你在iframe里自动更新，可能还是会更新成"播放器"这个名字
    // **但是**，我们的逻辑是：必须 Favorites 里已经有这个 Key 才会更新。
    // 如果你第一次手动收藏是正确的名字，那么 Key 就是正确的名字。
    // 这里我们只要能匹配上 Key 就能更新。
    // 
    // 难点：iframe 里解析出来的 seriesName 可能是 "播放器"，跟 Favorites 里的 "海贼王" 对不上。
    // 解决：自动更新功能在 iframe 网站上可能受限，这是技术硬伤。
    // 补救：只有当 seriesName 在收藏里存在时才更新。如果 iframe 解析出来是乱码，就不会误更新。
    
    try {
        const info = parseVideoInfo();
        const sName = info.seriesName;
        if (config.favorites && config.favorites[sName]) {
            const newData = {
                series: sName,
                episode: info.episodeName,
                site: info.siteName,
                url: window.location.href,
                time: Math.floor(video.currentTime),
                duration: Math.floor(video.duration || 0),
                timestamp: now
            };
            config.favorites[sName] = newData;
            chrome.storage.local.set({ favorites: config.favorites });
            lastFavUpdateTime = now;
        }
    } catch (e) { }
}

function handleTimeUpdate(e) {
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