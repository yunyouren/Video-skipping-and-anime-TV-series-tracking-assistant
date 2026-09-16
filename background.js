importScripts('tracker-core.js');

// Serialize all favorite writes and merge each change with the latest stored data.
let favoriteQueue = Promise.resolve();
const diagnosticWrites = new Map();
chrome.tabs.onRemoved?.addListener(tabId => diagnosticWrites.delete(tabId));
function storageGet(defaults) {
    return new Promise((resolve, reject) => chrome.storage.local.get(defaults, data => {
        const error = chrome.runtime.lastError;
        error ? reject(new Error(error.message)) : resolve(data);
    }));
}
function storageSet(data) {
    return new Promise((resolve, reject) => chrome.storage.local.set(data, () => {
        const error = chrome.runtime.lastError;
        error ? reject(new Error(error.message)) : resolve();
    }));
}
chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install' || details.reason === 'update') chrome.storage.local.set({ showWhitelistNotice: true });
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSaveStatus') { sendResponse(diagnosticWrites.get(request.tabId) || { state: '本次后台运行尚无保存记录' }); return false; }
    if (request.action === 'mutateFavorites') {
        const task = favoriteQueue.then(async () => {
            const state = await storageGet({ favorites: {}, favFolders: SkipperCore.defaultFolders, onlySaveMaxEpisode: false });
            const data = SkipperCore.applyMutation(state, request.operation || {});
            await storageSet(data);
            if (request.operation?.type === 'progress' && sender.tab?.id !== undefined) diagnosticWrites.set(sender.tab.id, { state: '已保存', time: Date.now(), error: null });
            sendResponse({ ok: true, data });
        });
        favoriteQueue = task.catch(error => {
            if (request.operation?.type === 'progress' && sender.tab?.id !== undefined) diagnosticWrites.set(sender.tab.id, { state: '保存失败', time: Date.now(), error: error.message });
            sendResponse({ ok: false, error: error.message });
        });
        return true;
    }
    if (request.action === 'getTabTitle' || request.action === 'getPageInfo') {
        const result = { title: sender.tab?.title || '', url: sender.tab?.url || '' };
        if (request.action === 'getPageInfo' && sender.tab?.id !== undefined) {
            chrome.tabs.sendMessage(sender.tab.id, { action: 'getNiceTitle' }, { frameId: 0 }, info => {
                if (!chrome.runtime.lastError && info) result.info = info;
                sendResponse(result);
            });
            return true;
        }
        sendResponse(result);
        return false;
    }
    if (request.action === 'clickNextInTop' && sender.tab?.id !== undefined && sender.frameId !== 0) {
        chrome.tabs.sendMessage(sender.tab.id, { action: 'clickNext' }, { frameId: 0 }, result => {
            sendResponse({ clicked: !chrome.runtime.lastError && !!result?.clicked });
        });
        return true;
    }
    if (request.action === 'openOptionsPage') chrome.runtime.openOptionsPage();
    return false;
});
