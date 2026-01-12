// background.js

// 监听插件安装或更新事件
chrome.runtime.onInstalled.addListener(() => {
    console.log("Bilibili Skipper 已安装/更新，正在注入脚本...");

    // 查找所有符合条件的视频标签页 (包括 B站, 爱奇艺, 腾讯, 樱花等)
    chrome.tabs.query({
        url: [
            "*://*.bilibili.com/video/*",
            "*://*.bilibili.com/bangumi/play/*",
            "*://*.iqiyi.com/*",
            "*://v.qq.com/*",
            "*://*.yinghuacd.com/*",
            "*://*.yhdmp.com/*" 
        ]
    }, (tabs) => {
        // 遍历每一个标签页，把 content.js 再次注入进去
        for (const tab of tabs) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            }).then(() => {
                console.log(`已注入脚本到标签页: ${tab.title}`);
            }).catch(err => console.log(err));
        }
    });
});
// 监听来自 content.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 处理获取 Tab 标题的请求 (用于解决 Iframe 无法获取顶层标题导致自动更新失效的问题)
    if (request.action === "getTabTitle") {
        // sender.tab.title 包含了顶层标签页的标题
        const title = sender.tab ? sender.tab.title : "";
        const url = sender.tab ? sender.tab.url : "";
        sendResponse({ title: title, url: url });
        return true; // 保持消息通道开启
    }

    // 【新增】同步进度消息转发：从 Iframe -> Background -> Top Frame
    if (request.action === "syncVideoProgress") {
        if (sender.tab && sender.tab.id) {
            // 定向发送给该标签页的 Frame 0 (即主页面)
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "triggerAutoUpdate",
                time: request.time,
                duration: request.duration
            }, { frameId: 0 }); // 关键：只发给主框架
        }
    }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 只有当页面加载完成 (complete) 且有 URL 时才尝试注入
    if (changeInfo.status === 'complete' && tab.url) {
        // 排除 chrome:// 开头的系统页面，防止报错
        if (!tab.url.startsWith('chrome://')) {
             chrome.scripting.executeScript({
                target: { tabId: tabId, allFrames: true }, // allFrames: true 很重要
                files: ["content.js"]
            }).catch(err => {
                // 忽略一些权限报错（比如无法注入到应用商店页面）
            });
        }
    }
});