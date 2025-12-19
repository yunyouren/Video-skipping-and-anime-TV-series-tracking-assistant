// background.js

// 监听插件安装或更新事件
chrome.runtime.onInstalled.addListener(() => {
    console.log("Bilibili Skipper 已安装/更新，正在注入脚本...");

    // 查找所有符合条件的 Bilibili 视频标签页
    chrome.tabs.query({
        url: [
            "*://*.bilibili.com/video/*",
            "*://*.bilibili.com/bangumi/play/*"
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
// 监听浏览器标签页更新（比如用户在 YouTube 从一个视频点到另一个视频）
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