// =========================================================
// Bilibili Skipper Ultimate (Auto Restart from Content)
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
    autoRestart: false, // 新增
    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300,
    autoPlayNext: false,
    keyForward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false },
    keyRewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false }
};

let isSwitchingEpisode = false;

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
    if (event.code !== keyConfig.code) return false;
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

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    config = { ...config, ...items };
    document.addEventListener('keydown', onKeyHandler);
    if (!window.biliMonitorInterval) {
        startMonitoring();
    }
});

chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
        if (config.hasOwnProperty(key)) {
            config[key] = changes[key].newValue;
        }
    }
});

// --- 键盘快捷键 ---
function onKeyHandler(event) {
    const isForward = isKeyMatch(event, config.keyForward);
    const isRewind = isKeyMatch(event, config.keyRewind);
    if (!isForward && !isRewind) return;

    const video = findMainVideo();
    if (!video) return;
    const skipTime = config.manualSkipTime;

    if (isForward) {
        video.currentTime += skipTime;
        showToast(`>>> 快进 ${skipTime} 秒`);
    } else if (isRewind) {
        video.currentTime -= skipTime;
        showToast(`<<< 快退 ${skipTime} 秒`);
    }
    event.preventDefault();
    event.stopPropagation();
}

// --- 自动监控逻辑 ---
let hasSkippedIntro = false;
let hasCheckedRestart = false; // 新增：标记是否已经检查过“完播重置”

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            
            // 当视频源改变（换集）时，重置所有状态标记
            const resetState = () => { 
                hasSkippedIntro = false; 
                isSwitchingEpisode = false; 
                hasCheckedRestart = false; // 换集后允许再次检查重置
            };
            
            video.addEventListener('loadedmetadata', resetState);
            video.addEventListener('durationchange', resetState); 
            video.addEventListener('seeking', () => { if(video.currentTime < 1) hasSkippedIntro = false; });
            
            video.dataset.hasSkipperListener = 'true';
        }
    }, 1000);
}

function handleTimeUpdate(e) {
    const video = e.target;
    
    // 1. 总开关检查
    if (config.autoSkipEnable !== true) return;
    
    // 2. 短视频保护 (不适用于“完播重置”，因为短视频也可能需要重看)
    // 但为了逻辑统一，且防止误伤几秒钟的广告，还是保留最小长度检查
    // 如果你希望短视频也生效，可以将下面的 minDuration 换成一个较小的固定值(如10)
    if (video.duration < config.minDuration) return; 

    // --- 新增：完播重置逻辑 ---
    // 只有在视频刚开始加载，且开启了功能，且没检查过时才运行
    if (config.autoRestart === true && !hasCheckedRestart) {
        // 定义“处于片尾”：剩余时间少于30秒，或者进度超过98%
        const timeLeft = video.duration - video.currentTime;
        const progress = video.currentTime / video.duration;

        if (timeLeft < 30 || progress > 0.98) {
            console.log("检测到视频处于片尾，执行重置...");
            // 重置到片头结束的位置 (如果没有设置片头，就是0)
            video.currentTime = config.enableIntro ? config.introTime : 0;
            showToast('↺ 视频已播完，重置到正片开始');
            
            // 如果重置的位置就是开头，也要标记已跳过片头，防止重复触发
            hasSkippedIntro = true; 
        }
        // 标记为已检查，无论是否触发重置，本集都不再检查
        hasCheckedRestart = true;
    }

    if (video.duration < (config.introTime + 5)) return;

    // --- 跳过片头 ---
    if (config.enableIntro === true) {
        if (video.currentTime < config.introTime && !hasSkippedIntro && video.currentTime > 0.5) {
            video.currentTime = config.introTime;
            hasSkippedIntro = true;
            showToast(`🚀 跳过片头`);
        }
    }

    // --- 跳过片尾 ---
    if (config.enableOutro === true) {
        if (config.outroTime > 0) {
            const triggerTime = video.duration - config.outroTime;
            if (video.currentTime > triggerTime && video.currentTime < video.duration) {
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

// --- 提示框 ---
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