// background.js

// 安装/更新时设置首次提示标记
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.storage.local.set({ showWhitelistNotice: true });
    }
});

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. 处理获取 Tab 标题
    if (request.action === "getTabTitle") {
        const title = sender.tab ? sender.tab.title : "";
        const url = sender.tab ? sender.tab.url : "";
        sendResponse({ title: title, url: url });
        return true; 
    }

    // 2. 处理进度同步 (Iframe -> Background -> Top Frame)
    if (request.action === "syncVideoProgress") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "triggerAutoUpdate",
                time: request.time,
                duration: request.duration
            }, { frameId: 0 });
        }
    }

    // 3. 打开选项页
    if (request.action === "openOptionsPage") {
        chrome.runtime.openOptionsPage();
    }
});