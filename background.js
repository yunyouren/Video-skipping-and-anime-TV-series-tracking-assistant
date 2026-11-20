importScripts('tracker-core.js', 'browser-sync.js');

// Serialize all favorite writes and merge each change with the latest stored data.
let favoriteQueue = Promise.resolve();
const diagnosticWrites = new Map();
const browserSyncDefaults = { browserSyncEnabled: false, browserSyncJournal: null };
const favoriteDefaults = { favorites: {}, favFolders: SkipperCore.defaultFolders, onlySaveMaxEpisode: false, ...browserSyncDefaults };
let syncTimer;
let syncDeadline = Infinity;
let lastExchange = 0;
const syncInterval = 20000;
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
function enqueueFavorites(operation) {
    const task = favoriteQueue.then(operation);
    favoriteQueue = task.catch(() => {});
    return task;
}

const syncStorage = chrome.storage.sync;
syncStorage?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});

async function exchangeBrowserSync(state) {
    if (!state.browserSyncEnabled) return null;
    lastExchange = Date.now();
    let status;
    try {
        if (!syncStorage) throw new Error('此浏览器没有提供扩展同步存储');
        const remote = await syncStorage.get(null);
        const { changes, ...merged } = BrowserSync.reconcile(state, remote);
        await storageSet(merged);
        if (Object.keys(changes).length) await syncStorage.set(changes);
        status = { checkedAt: Date.now(), error: null };
    } catch (error) {
        const message = /quota|max_items/i.test(error.message) ? '浏览器同步空间或写入次数已达上限，本机进度仍可正常保存。' : error.message;
        status = { checkedAt: Date.now(), error: message };
    }
    await storageSet({ browserSyncStatus: status });
    return status;
}

async function syncBrowserData() {
    const state = await storageGet(favoriteDefaults);
    if (state.browserSyncEnabled && !state.browserSyncJournal) {
        Object.assign(state, await BrowserSync.stage(state, state, null));
        await storageSet({ favorites: state.favorites, browserSyncJournal: state.browserSyncJournal });
    }
    return exchangeBrowserSync(state);
}

function scheduleBrowserSync(delay) {
    const deadline = Date.now() + delay;
    if (deadline >= syncDeadline) return;
    clearTimeout(syncTimer);
    syncDeadline = deadline;
    syncTimer = setTimeout(() => {
        syncDeadline = Infinity;
        enqueueFavorites(syncBrowserData).catch(console.error);
    }, delay);
}

chrome.runtime.onStartup?.addListener(() => scheduleBrowserSync(0));
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(key => key.startsWith(BrowserSync.prefix))) scheduleBrowserSync(300);
});

function isExtensionPage(sender) {
    if (!sender.url) return false;
    const page = sender.url.split('#')[0];
    return page === chrome.runtime.getURL('options.html') || page === chrome.runtime.getURL('popup.html');
}

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install' || details.reason === 'update') chrome.storage.local.set({ showWhitelistNotice: true });
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'setBrowserSync' || request.action === 'syncBrowserData') {
        if (!isExtensionPage(sender)) return false;
        enqueueFavorites(async () => {
            if (request.action === 'setBrowserSync') {
                const enabled = request.enabled === true;
                await storageSet({ browserSyncEnabled: enabled });
                if (!enabled) { clearTimeout(syncTimer); syncDeadline = Infinity; return null; }
            }
            if (Date.now() - lastExchange < 3000 && request.action === 'syncBrowserData') {
                scheduleBrowserSync(Math.max(0, 3000 - (Date.now() - lastExchange)));
                return (await storageGet({ browserSyncStatus: null })).browserSyncStatus;
            }
            return syncBrowserData();
        }).then(status => sendResponse({ ok: true, status }), error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (request.action === 'getSaveStatus') { sendResponse(diagnosticWrites.get(request.tabId) || { state: '本次后台运行尚无保存记录' }); return false; }
    if (request.action === 'mutateFavorites') {
        enqueueFavorites(async () => {
            const operation = request.operation || {};
            const state = await storageGet(favoriteDefaults);
            if (state.browserSyncEnabled && !state.browserSyncJournal) Object.assign(state, await BrowserSync.stage(state, state, null));
            let data = SkipperCore.applyMutation(state, operation);
            const syncRelevant = !['catalog', 'open', 'resetEpisodeSettings'].includes(operation.type) && !(operation.type === 'patch' && operation.episodeUrl);
            if (syncRelevant && state.browserSyncJournal) {
                data = await BrowserSync.stage(state, data, state.browserSyncJournal);
            }
            await storageSet(data);
            if (request.operation?.type === 'progress' && sender.tab?.id !== undefined) diagnosticWrites.set(sender.tab.id, { state: '已保存', time: Date.now(), error: null });
            sendResponse({ ok: true, data: { favorites: data.favorites, favFolders: data.favFolders } });
            if (syncRelevant && state.browserSyncEnabled) {
                const interval = operation.type === 'progress' && !operation.flushSync ? syncInterval : 3000;
                scheduleBrowserSync(Math.max(0, lastExchange + interval - Date.now()));
            }
        }).catch(error => {
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
