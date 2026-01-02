// =========================================================
// Bilibili Skipper Ultimate (Auto Update Favorites)
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
    
    // 新增开关默认值
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

// --- 消息监听 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getRequestVideoInfo") {
        const video = findMainVideo();
        if (!video) return; 
        try {
            const info = parseVideoInfo();
            const data = {
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
            sendResponse({ error: "parse_error" });
        }
    }
    return true; 
});

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    config = { ...config, ...items };
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
    const matchedPreset = config.savedPresets.find(p => p.domain && p.domain.trim() !== "" && currentUrl.includes(p.domain));
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
        '.switch-btn.next', '#multi_page .cur + li a'
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

function parseVideoInfo() {
    const rawTitle = document.title.trim();
    const url = window.location.href;
    let seriesName = "";
    let episodeName = "";
    let siteName = "Web";

    if (url.includes("bilibili.com")) {
        siteName = "B站";
        const mediaTitleEl = document.querySelector('.media-title, .media-info-title, .bangumi-title');
        const podTitleEl = document.querySelector('.video-pod-title, .up-info-container .title');
        if (mediaTitleEl) {
            seriesName = mediaTitleEl.innerText.trim();
        } else if (podTitleEl) {
            seriesName = podTitleEl.innerText.trim();
        }
    } else if (url.includes("iqiyi")) {
        siteName = "爱奇艺";
    }

    if (!seriesName) {
        let cleanTitle = rawTitle
            .replace(/_bilibili.*/i, "")
            .replace(/-bilibili.*/i, "")
            .replace(/_哔哩哔哩.*/i, "")
            .replace(/-哔哩哔哩.*/i, "")
            .replace(/-国创.*/i, "")
            .replace(/-番剧.*/i, "")
            .replace(/-全集.*/i, "")
            .replace(/-高清.*/i, "")
            .replace(/在线观看.*/i, "")
            .trim();
        const matchEpisode = cleanTitle.match(/(.*?)[\s-]*(第\s*\d+\s*[集话]|Ep\.?\s*\d+|Vol\.\d+)/i);
        if (matchEpisode) {
            seriesName = matchEpisode[1].trim();
            episodeName = matchEpisode[2].trim();
        } else {
            const parts = cleanTitle.split('_');
            if (parts.length >= 2) {
                seriesName = parts[1].trim();
                episodeName = parts[0].trim();
            } else {
                seriesName = cleanTitle;
            }
        }
    }

    if (!episodeName) {
        const epMatch = rawTitle.match(/(第\s*\d+\s*[集话]|Ep\.?\s*\d+)/i);
        if (epMatch) {
            episodeName = epMatch[0];
        } else {
            const pMatch = url.match(/p=(\d+)/);
            if (pMatch) {
                episodeName = `P${pMatch[1]}`;
            } else {
                episodeName = "观看中";
            }
        }
    }
    seriesName = seriesName.replace(/(第\s*\d+\s*[集话]).*/, "").trim();
    return { seriesName, episodeName, siteName };
}

// --- 自动监控 ---
let hasSkippedIntro = false;
let hasTriggeredRestart = false; 
let videoLoadStartTime = 0;      
let restartCooldownTime = 0;
let lastFavUpdateTime = 0; // 上次自动更新收藏的时间

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
// --- content.js 中的 autoUpdateFavorites 函数 ---

function autoUpdateFavorites(video) {
    // 1. 检查开关
    if (!config.autoUpdateFav) {
        // console.log("调试: 自动更新开关未开启");
        return;
    }
    
    // 2. 限制频率
    const now = Date.now();
    if (now - lastFavUpdateTime < 10000) return; // 还没到10秒
    
    // 3. 只有播放超过10秒才更新
    if (video.currentTime < 10) return;

    try {
        const info = parseVideoInfo();
        const sName = info.seriesName; // 当前视频解析出的名字

        // console.log(`调试: 当前识别为 [${sName}]，正在检查收藏夹...`);

        // 【关键】检查该剧是否在收藏夹中
        if (config.favorites && config.favorites[sName]) {
            // 找到了！执行更新
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
            
            console.log(`✅ 自动更新成功: ${sName} -> ${info.episodeName}`);
            lastFavUpdateTime = now;
        } else {
            console.log(`❌ 未更新: 收藏夹里找不到 [${sName}]，请先手动收藏一次。`);
        }
    } catch (e) {
        console.error("自动更新出错", e);
    }
}

function handleTimeUpdate(e) {
    const video = e.target;
    
    // --- 1. 尝试自动更新收藏 ---
    autoUpdateFavorites(video);

    // --- 2. 自动跳过逻辑 ---
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