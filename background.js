// background.js

// 只保留消息监听，移除 onInstalled 和 onUpdated 中的 executeScript 逻辑
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
});