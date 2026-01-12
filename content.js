// =========================================================
// Bilibili Skipper Ultimate (The Black Tech Fix)
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
    favorites: {}
};

let isSwitchingEpisode = false;

// --- 消息监听 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getNiceTitle") {
        const info = parseVideoInfo(); 
        sendResponse({ series: info.seriesName, episode: info.episodeName, url: window.location.href });
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
    if (!config.autoApplyPreset) return;
    if (!config.savedPresets || config.savedPresets.length === 0) return;
    
    const currentUrl = window.location.href;
    const currentTitle = document.title; 
    const matchedPreset = config.savedPresets.find(p => {
        if (!p.domain || p.domain.trim() === "") return false;
        const keyword = p.domain.trim();
        return currentUrl.includes(keyword) || currentTitle.includes(keyword);
    });

    if (matchedPreset) {
        if (!config.autoSkipEnable || config.lastActivePreset !== matchedPreset.name) {
            console.log("Skipper: 匹配成功 ->", matchedPreset.name);
            config.autoSkipEnable = true; 
            config.introTime = matchedPreset.intro;
            config.outroTime = matchedPreset.outro;
            config.autoRestart = matchedPreset.restart;
            config.autoPlayNext = matchedPreset.next;
            config.enableIntro = (matchedPreset.intro > 0);
            config.enableOutro = (matchedPreset.outro > 0);
            
            chrome.storage.local.set({
                autoSkipEnable: true,
                introTime: matchedPreset.intro,
                outroTime: matchedPreset.outro,
                autoRestart: matchedPreset.restart,
                autoPlayNext: matchedPreset.next,
                enableIntro: (matchedPreset.intro > 0),
                enableOutro: (matchedPreset.outro > 0),
                lastActivePreset: matchedPreset.name
            });
            showToast(`⚡ 已激活方案: ${matchedPreset.name}`);
        }
    } else {
        if (config.autoSkipEnable === true) {
            console.log("Skipper: 无匹配，自动关闭");
            config.autoSkipEnable = false;
            chrome.storage.local.set({ autoSkipEnable: false, lastActivePreset: "" });
        }
    }
}

// --- 辅助函数 ---
function getResumeUrl(video) {
    let url = window.location.href;
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

function parseVideoInfo() {
    let rawTitle = document.title.trim();
    const url = window.location.href;
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.length > 2) {
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

// --- 【黑科技核心】模糊匹配更新 ---
function autoUpdateFavorites(video) {
    if (!config.autoUpdateFav) return;
    const now = Date.now();
    if (now - lastFavUpdateTime < 10000) return;
    if (video.currentTime < 10) return;

    try {
        const info = parseVideoInfo();
        let sName = info.seriesName; // 解析出来的剧名 (可能是"播放器")
        let targetFavorite = null;

        // 策略A：名字直接匹配 (最理想)
        if (config.favorites && config.favorites[sName]) {
            targetFavorite = config.favorites[sName];
        } 
        
        // 策略B：黑科技 URL 匹配 (解决 Iframe 标题错误)
        else if (config.favorites) {
            // 获取来源页 URL (如果你在iframe里，这就是外层网页的地址)
            // 如果不在iframe里，这个值可能为空或者就是当前页
            const refUrl = document.referrer; 
            
            if (refUrl && refUrl.length > 10) {
                // 遍历所有收藏，看看有没有哪个收藏的URL跟当前来源页长得像
                // "长得像"的定义：URL的前80%是一样的
                const allKeys = Object.keys(config.favorites);
                for (const key of allKeys) {
                    const savedUrl = config.favorites[key].url;
                    if (savedUrl && areUrlsSimilar(savedUrl, refUrl)) {
                        // 找到了！虽然当前标题叫"播放器"，但来源页URL跟收藏里的《海贼王》一样
                        console.log(`Skipper黑科技: URL匹配成功! [${sName}] -> [${key}]`);
                        sName = key; // 强行把名字纠正过来
                        targetFavorite = config.favorites[key];
                        break;
                    }
                }
            }
        }

        // 如果找到了对应的收藏项，执行更新
        if (targetFavorite) {
            const newData = {
                series: sName, // 使用修正后的名字
                episode: info.episodeName, // 集数通常在iframe里能提取到 (比如 url 包含 02.mp4)
                site: targetFavorite.site, // 沿用原来的站点名
                
                // 关键：如果我们在iframe里，不要把iframe的垃圾url存进去
                // 优先使用原来的url (如果是自动更新)，或者 document.referrer
                url: document.referrer || targetFavorite.url || window.location.href,
                
                time: Math.floor(video.currentTime),
                duration: Math.floor(video.duration || 0),
                timestamp: now
            };
            config.favorites[sName] = newData;
            chrome.storage.local.set({ favorites: config.favorites });
            lastFavUpdateTime = now;
            console.log(`✅ 自动更新: ${sName} ${newData.episode}`);
        }
    } catch (e) { 
        console.error("自动更新出错", e);
    }
}

// 判断两个URL是否属于同一个系列
function areUrlsSimilar(url1, url2) {
    if (!url1 || !url2) return false;
    // 去掉参数
    const u1 = url1.split('?')[0];
    const u2 = url2.split('?')[0];
    
    // 如果域名都不一样，肯定不是
    if (new URL(u1).hostname !== new URL(u2).hostname) return false;

    // 简单算法：去掉最后一段 (通常是集数id)，比较前面的部分
    // 比如 .../play/123-1.html 和 .../play/123-2.html
    const path1 = u1.substring(0, u1.lastIndexOf('/'));
    const path2 = u2.substring(0, u2.lastIndexOf('/'));
    
    // 如果路径基本一致，或者是包含关系
    return path1 === path2 || path1.includes(path2) || path2.includes(path1);
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