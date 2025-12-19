// =========================================================
// Bilibili Skipper & Universal Video Control v4.0
// =========================================================

if (window.hasBiliSkipperLoaded) {
    throw new Error("Bilibili Skipper 脚本已存在，停止重复加载");
}
window.hasBiliSkipperLoaded = true;

// --- 全局配置变量 ---
let config = {
    autoSkipEnable: false,
    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300 // 默认值
};

// --- 辅助函数：智能寻找主视频 ---
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

// --- 初始化流程 ---
chrome.storage.local.get(config, (items) => {
    config = items;
    console.log("Skipper 配置已加载:", config);
    
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
    console.log("配置已更新:", config);
});

// --- 键盘快捷键逻辑 ---
function onKeyHandler(event) {
    if (!event.shiftKey) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    const video = findMainVideo();
    if (!video) return;

    const skipTime = config.manualSkipTime;

    if (event.key === 'ArrowRight') {
        video.currentTime += skipTime;
        showToast(`>>> 快进 ${skipTime} 秒`);
    } else if (event.key === 'ArrowLeft') {
        video.currentTime -= skipTime;
        showToast(`<<< 快退 ${skipTime} 秒`);
    }
    
    event.preventDefault();
    event.stopPropagation();
}

// --- 自动跳过核心监控 ---
let hasSkippedIntro = false;

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            video.addEventListener('loadedmetadata', () => { hasSkippedIntro = false; });
            video.addEventListener('seeking', () => {
                 if(video.currentTime < 1) hasSkippedIntro = false; 
            });
            video.dataset.hasSkipperListener = 'true';
        }
    }, 1000);
}

function handleTimeUpdate(e) {
    const video = e.target;
    
    // 1. 基础开关检查
    if (config.autoSkipEnable !== true) return;
    
    // 2. 【关键新增】短视频保护检查
    // 如果视频总时长 < 设置的保护阈值，直接忽略，不执行任何自动跳过
    if (video.duration < config.minDuration) return;

    // 3. 安全检查：如果视频还没片头长，也不跳
    if (video.duration < (config.introTime + 5)) return;

    // --- 跳过片头 ---
    if (video.currentTime < config.introTime && !hasSkippedIntro && video.currentTime > 0.5) {
        video.currentTime = config.introTime;
        hasSkippedIntro = true;
        showToast(`🚀 跳过片头 (视频总长 > ${Math.floor(video.duration/60)}分)`);
    }

    // --- 跳过片尾 ---
    if (config.outroTime > 0) {
        const endTimePoint = video.duration - config.outroTime;
        if (video.currentTime > endTimePoint && video.currentTime < video.duration) {
            video.currentTime = video.duration;
            showToast(`🚀 跳过片尾`);
        }
    }
}

// --- 提示框 UI ---
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