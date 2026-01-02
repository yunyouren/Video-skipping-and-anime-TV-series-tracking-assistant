// =========================================================
// Bilibili Skipper Ultimate (With Toggle Switches)
// =========================================================

if (window.hasBiliSkipperLoaded) {
    throw new Error("脚本已运行，跳过重复加载");
}
window.hasBiliSkipperLoaded = true;

// --- 全局配置 ---
let config = {
    autoSkipEnable: false,
    enableIntro: true,   // 新增
    enableOutro: true,   // 新增
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

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            const resetState = () => { hasSkippedIntro = false; isSwitchingEpisode = false; };
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
    
    // 2. 短视频保护
    if (video.duration < config.minDuration) return;
    if (video.duration < (config.introTime + 5)) return;

    // --- 跳过片头 (必须开启独立开关) ---
    if (config.enableIntro === true) {
        if (video.currentTime < config.introTime && !hasSkippedIntro && video.currentTime > 0.5) {
            video.currentTime = config.introTime;
            hasSkippedIntro = true;
            showToast(`🚀 跳过片头`);
        }
    }

    // --- 跳过片尾 (必须开启独立开关) ---
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