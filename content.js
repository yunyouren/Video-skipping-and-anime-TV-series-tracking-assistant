// =========================================================
// Bilibili Skipper Ultimate (Auto Domain Match)
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
    keyRewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false },
    savedPresets: [] // 存储预设列表
};

let isSwitchingEpisode = false;

// --- 初始化 ---
chrome.storage.local.get(config, (items) => {
    config = { ...config, ...items };
    
    // 1. 【核心逻辑】执行自动网址匹配
    checkAndApplyAutoMatch();

    // 2. 启动功能
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

// --- 新增：自动匹配函数 ---
function checkAndApplyAutoMatch() {
    // 必须有预设才匹配
    if (!config.savedPresets || config.savedPresets.length === 0) return;

    const currentUrl = window.location.href;
    
    // 寻找匹配项 (只要 URL 包含 domain 关键词即可)
    // 注意：如果有多个匹配，取第一个找到的
    const matchedPreset = config.savedPresets.find(p => p.domain && p.domain.trim() !== "" && currentUrl.includes(p.domain));

    if (matchedPreset) {
        console.log("Skipper: 检测到域名匹配 ->", matchedPreset.name);
        
        // 覆盖当前内存中的配置
        config.introTime = matchedPreset.intro;
        config.outroTime = matchedPreset.outro;
        config.autoRestart = matchedPreset.restart;
        config.autoPlayNext = matchedPreset.next;
        config.enableIntro = (matchedPreset.intro > 0);
        config.enableOutro = (matchedPreset.outro > 0);
        // 如果你希望自动匹配时也开启总开关，解开下面这行注释
        // config.autoSkipEnable = true; 

        // 提示用户
        // 稍微延迟一点显示，让用户注意到
        setTimeout(() => {
            showToast(`🤖 已自动应用: ${matchedPreset.name}`);
        }, 1000);

        // 【可选】是否将自动匹配的结果写回硬盘？
        // 写回的好处：点开插件图标时，看到的界面就是匹配后的状态
        // 坏处：会覆盖掉你之前的全局设置
        // 建议：写回。因为用户既然打开了这个网站，就希望插件处于这个状态。
        chrome.storage.local.set({
            introTime: matchedPreset.intro,
            outroTime: matchedPreset.outro,
            autoRestart: matchedPreset.restart,
            autoPlayNext: matchedPreset.next,
            enableIntro: (matchedPreset.intro > 0),
            enableOutro: (matchedPreset.outro > 0)
        });
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
let restartCooldownTime = 0;

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

    // --- 完播重置 (Safe Landing) ---
    if (config.autoRestart === true && !hasTriggeredRestart) {
        if (Date.now() - videoLoadStartTime < 4000) {
            const timeLeft = video.duration - video.currentTime;
            
            if (timeLeft < 30 || video.currentTime / video.duration > 0.95) {
                console.log("Skipper: 触发完播重置...");

                const outroTriggerTime = video.duration - (config.enableOutro ? config.outroTime : 0);
                let targetPos = config.enableIntro ? config.introTime : 0;

                if (targetPos >= outroTriggerTime) {
                    targetPos = 0;
                }

                video.currentTime = targetPos;
                showToast(`↺ 已重置到 ${targetPos}秒`);
                
                hasTriggeredRestart = true;
                hasSkippedIntro = true;
                restartCooldownTime = Date.now() + 5000; 
            }
        }
    }

    // --- 跳过片头 ---
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

    // --- 跳过片尾 ---
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