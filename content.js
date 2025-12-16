// 监听键盘按键事件
document.addEventListener('keydown', (event) => {
    // 只有当用户按下 Shift 键时才触发
    if (!event.shiftKey) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    // 获取页面上的视频元素
    const video = document.querySelector('video');
    if (!video) return;

    // --- 关键修改：从存储中读取用户设定的时间 ---
    chrome.storage.local.get(['userSkipTime'], (result) => {
        // 如果读取到了就用读取的值，没读取到（比如第一次用）就默认 90 秒
        const skipSeconds = result.userSkipTime || 90;

        let actionTriggered = false;
        let message = '';

        // 检测 Shift + 右箭头 (快进)
        if (event.key === 'ArrowRight') {
            video.currentTime += skipSeconds;
            message = `>>> 快进 ${skipSeconds} 秒`;
            actionTriggered = true;
        } 
        // 检测 Shift + 左箭头 (快退)
        else if (event.key === 'ArrowLeft') {
            video.currentTime -= skipSeconds;
            message = `<<< 快退 ${skipSeconds} 秒`;
            actionTriggered = true;
        }

        if (actionTriggered) {
            // 阻止网页默认的滚动行为等
            event.preventDefault();
            event.stopPropagation();
            showToast(message);
        }
    });
});

// --- 提示框代码 (保持不变) ---
let toastTimeout;
function showToast(text) {
    let toast = document.getElementById('bili-skipper-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bili-skipper-toast';
        toast.style.cssText = `
            position: fixed; top: 20%; left: 50%; transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.7); color: white; padding: 10px 20px;
            border-radius: 5px; font-size: 16px; z-index: 999999; pointer-events: none;
            transition: opacity 0.3s; font-family: sans-serif;
        `;
        document.body.appendChild(toast);
    }
    toast.innerText = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 1500);
}

console.log("Bilibili Skipper v2 已加载");