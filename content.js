// =========================================================
// Bilibili Skipper Ultimate (Instant Next)
// =========================================================

if (window.hasBiliSkipperLoaded) {
    throw new Error("脚本已运行，跳过重复加载");
}
window.hasBiliSkipperLoaded = true;

// --- 全局配置 ---
let config = {
    autoSkipEnable: false,
    introTime: 90,
    outroTime: 0,
    manualSkipTime: 90,
    minDuration: 300,
    autoPlayNext: false 
};

// 状态锁：防止一秒钟内连续点击十次下一集
let isSwitchingEpisode = false;

// --- 辅助：智能寻找主视频 ---
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

// --- 核心：尝试点击下一集 ---
function tryClickNext() {
    // B站各种播放器版本的“下一集”按钮选择器
    const selectors = [
        '.bpx-player-ctrl-next',       // 新版主流
        '.squirtle-video-next',        // 番剧常用
        '.bilibili-player-video-btn-next', // 旧版
        '[aria-label="下一个"]',
        '.switch-btn.next',
        '#multi_page .cur + li a'      // 分P列表的下一集
    ];

    for (const sel of selectors) {
        const btn = document.querySelector(sel);
        // 只要按钮存在，哪怕它是隐藏的(hover才显示)，直接点也是有效的
        if (btn && !btn.disabled) {
            console.log("Skipper: 找到下一集按钮，点击 ->", sel);
            btn.click();
            return true;
        }
    }
    return false;
}

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    config = items;
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

// --- 键盘快捷键 (保持不变) ---
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

// --- 自动监控逻辑 ---
let hasSkippedIntro = false;

function startMonitoring() {
    window.biliMonitorInterval = setInterval(() => {
        const video = findMainVideo();
        if (!video) return;

        // 确保只绑定一次
        if (!video.dataset.hasSkipperListener) {
            video.addEventListener('timeupdate', handleTimeUpdate);
            
            // 重置各种状态锁
            const resetState = () => {
                hasSkippedIntro = false;
                isSwitchingEpisode = false; // 换集后解锁
            };
            
            video.addEventListener('loadedmetadata', resetState);
            // 兼容某些单页应用场景
            video.addEventListener('durationchange', resetState); 
            video.addEventListener('seeking', () => {
                 if(video.currentTime < 1) hasSkippedIntro = false; 
            });
            
            video.dataset.hasSkipperListener = 'true';
        }
    }, 1000);
}

function handleTimeUpdate(e) {
    const video = e.target;
    
    // 1. 基础检查
    if (config.autoSkipEnable !== true) return;
    if (video.duration < config.minDuration) return;
    if (video.duration < (config.introTime + 5)) return;

    // --- 跳过片头 ---
    if (video.currentTime < config.introTime && !hasSkippedIntro && video.currentTime > 0.5) {
        video.currentTime = config.introTime;
        hasSkippedIntro = true;
        showToast(`🚀 跳过片头`);
    }

    // --- 跳过片尾 (极速切集逻辑) ---
    if (config.outroTime > 0) {
        const triggerTime = video.duration - config.outroTime;
        
        // 当播放进度刚刚超过触发线
        if (video.currentTime > triggerTime && video.currentTime < video.duration) {
            
            // 如果已经正在切换中，就别再操作了，防止连点
            if (isSwitchingEpisode) return;

            // 方案 A: 极速切集 (用户开启了"触发下一集")
            if (config.autoPlayNext === true) {
                const success = tryClickNext();
                if (success) {
                    isSwitchingEpisode = true; // 上锁
                    showToast('🚀 正在切集...');
                    return; // 直接退出，绝不执行下面的跳进度条
                }
            }
            
            // 方案 B: 降级方案 (没开开关，或者找不到下一集按钮)
            // 只有找不到按钮时，才使用“拉进度条”作为备选
            if (!isSwitchingEpisode) { 
                // 为了防止 B 站的 buffer 卡顿，直接拉到结束前 0.1秒 往往比拉到 duration 更稳
                video.currentTime = video.duration; 
                showToast(`🚀 跳过片尾`);
                // 这里不上锁，因为可能需要多次尝试拉到底
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