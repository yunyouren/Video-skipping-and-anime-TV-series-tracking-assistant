// =========================================================
// Bilibili Skipper Ultimate (Safe Landing Fix)
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
let hasTriggeredRestart = false; 
let videoLoadStartTime = 0;      
let restartCooldownTime = 0; // 新增：重置后的冷却时间戳

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
                restartCooldownTime = 0; // 重置冷却
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

function handleTimeUpdate(e) {
    const video = e.target;
    
    // 1. 总开关
    if (config.autoSkipEnable !== true) return;
    
    // 2. 短视频保护
    if (video.duration < config.minDuration) return; 

    // --- 【逻辑 A】完播重置 (Safe Landing) ---
    if (config.autoRestart === true && !hasTriggeredRestart) {
        // 在视频加载前4秒内持续检测
        if (Date.now() - videoLoadStartTime < 4000) {
            const timeLeft = video.duration - video.currentTime;
            
            // 如果处于片尾
            if (timeLeft < 30 || video.currentTime / video.duration > 0.95) {
                console.log("Skipper: 触发完播重置...");

                // >>> 安全计算核心 <<<
                // 1. 计算片尾触发线
                const outroTriggerTime = video.duration - (config.enableOutro ? config.outroTime : 0);
                // 2. 计算理想的重置位置 (片头结束处)
                let targetPos = config.enableIntro ? config.introTime : 0;

                // 3. 碰撞检测：如果 理想位置 >= 片尾触发线，说明会撞车
                if (targetPos >= outroTriggerTime) {
                    console.log("Skipper: 片头片尾重叠，强制重置到 0秒");
                    targetPos = 0; // 强制降落到 0秒
                }

                video.currentTime = targetPos;
                showToast(`↺ 已重置到 ${targetPos}秒`);
                
                // 标记状态
                hasTriggeredRestart = true;
                hasSkippedIntro = true;
                // 设置5秒的无敌时间：这5秒内禁止检测片尾，防止B站进度条回弹误判
                restartCooldownTime = Date.now() + 5000; 
            }
        }
    }

    // --- 【逻辑 B】跳过片头 ---
    const outroTriggerTime = video.duration - (config.enableOutro ? config.outroTime : 0);
    const targetIntroTime = config.introTime;
    const isOverlap = targetIntroTime >= outroTriggerTime;

    if (config.enableIntro === true && !isOverlap) { 
        if (video.currentTime < targetIntroTime && !hasSkippedIntro && video.currentTime > 0.5) {
             // 如果在无敌时间内，不要乱动（虽然这里通常是跳去同一个地方，但为了稳定）
             if (Date.now() < restartCooldownTime) {
                 // 仅仅标记为已跳过，不做动作
                 hasSkippedIntro = true; 
             } else if (targetIntroTime < video.duration) {
                video.currentTime = targetIntroTime;
                hasSkippedIntro = true;
                showToast(`🚀 跳过片头`);
            }
        }
    }

    // --- 【逻辑 C】跳过片尾 ---
    if (config.enableOutro === true) {
        // 如果当前处于“重置后的无敌时间”内，直接跳过片尾检测！
        // 这就是解决“直接下一集”的关键
        if (Date.now() < restartCooldownTime) return;

        if (config.outroTime > 0) {
            if (video.currentTime > outroTriggerTime && video.currentTime < video.duration) {
                // 加载保护：刚加载页面的4秒内如果不重置，也不跳片尾
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