const test = require('node:test');
const assert = require('node:assert/strict');
const { env, favorite, makeBus } = require('./browser-stubs.cjs');

function sharedStorage() {
    return {
        records: {}, fail: false, writes: 0,
        async get() { return structuredClone(this.records); },
        async set(changes) {
            if (this.fail) throw Error('QUOTA_BYTES exceeded');
            Object.assign(this.records, structuredClone(changes));
            this.writes++;
        }
    };
}

async function device(syncStorage, initial = {}) {
    const bus = makeBus(initial);
    bus.syncStorage = syncStorage;
    const view = env({ html: 'options.html', bus });
    await view.boot('options.js');
    async function request(message, url = 'chrome-extension://test-extension/options.html#settings') {
        let response;
        bus.background.advanceTime(3001);
        bus.background.dispatch(message, { url }, value => { response = value; });
        // Web Crypto completes on the event loop, outside the simulated callbacks.
        for (let n = 0; n < 100 && response === undefined; n++) {
            await view.flush();
            if (response === undefined) await new Promise(resolve => setTimeout(resolve, 1));
        }
        return response;
    }
    const enabled = value => request({ action: 'setBrowserSync', enabled: value });
    const sync = () => request({ action: 'syncBrowserData' });
    return { view, bus, request, enabled, sync };
}

async function mutate(view, operation) {
    // See request above. A new favorite may require an asynchronous identity digest.
    let response;
    view.bus.background.dispatch({ action: 'mutateFavorites', operation }, {}, value => { response = value; });
    for (let n = 0; n < 100 && response === undefined; n++) {
        await view.flush();
        if (response === undefined) await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(response?.ok, true);
}

test('opt in on another profile restores favorites and keeps rich history local', async () => {
    const storage = sharedStorage();
    const item = favorite({ time: 755, seriesCompleted: true, folder: '已完成', introTime: 34,
        episodeProgress: { 'https://example.test/play/1': { url: 'https://example.test/play/1', episode: '第1集', time: 755, duration: 1200, timestamp: 1 } },
        catalog: [{ title: '第1集', number: 1 }] });
    const a = await device(storage, { favorites: { [item.series]: item }, favFolders: ['默认收藏', '已完成'] });
    const b = await device(storage);
    await a.sync();
    assert.equal(storage.writes, 0);
    a.bus.background.dispatch({ action: 'setBrowserSync', enabled: true }, { url: 'https://example.test' }, () => assert.fail('Website cannot change sync settings'));
    await a.view.flush();
    assert.equal(a.bus.data.browserSyncEnabled, undefined);
    assert.equal((await a.enabled(true)).status.error, null);
    assert.equal((await b.enabled(true)).status.error, null);
    const restored = b.bus.data.favorites[item.series];
    assert.equal(restored.time, 755);
    assert.equal(restored.folder, '已完成');
    assert.equal(restored.seriesCompleted, true);
    assert.equal(restored.introTime, 34);
    assert.equal(restored.catalog, undefined);
    assert.equal(restored.episodeProgress, undefined);
    assert.deepEqual(a.bus.data.favorites[item.series].episodeProgress, item.episodeProgress);
});

test('simultaneous playback and organization converge across profiles', async () => {
    const storage = sharedStorage();
    const a = await device(storage, { favorites: { 示例番剧: favorite() } });
    const b = await device(storage, { favorites: { 示例番剧: favorite({ time: 150, timestamp: 10 }) } });
    await a.enabled(true);
    await b.enabled(true);
    await a.sync();
    assert.equal(a.bus.data.favorites.示例番剧.time, 150);
    await mutate(a.view, { type: 'move', key: '示例番剧', folder: '日漫' });
    await mutate(a.view, { type: 'completeSeries', key: '示例番剧', completed: true });
    await mutate(b.view, { type: 'progress', key: '示例番剧', url: 'https://example.test/play/2', episode: '第2集', time: 125, duration: 1200, timestamp: 25 });
    await b.sync();
    await a.sync();
    await b.sync();
    const restored = b.bus.data.favorites.示例番剧;
    assert.equal(restored.folder, '日漫');
    assert.equal(restored.seriesCompleted, true);
    assert.equal(restored.time, 125);
    assert.equal(restored.url, 'https://example.test/play/2');
    assert.equal(a.bus.data.favorites.示例番剧.time, 125);
    assert.equal(a.bus.data.favorites.示例番剧.episodeProgress['https://example.test/play/1'].time, 150);
    const writes = storage.writes;
    await a.sync();
    await b.sync();
    assert.equal(storage.writes, writes);
});

test('deleted favorite stays deleted after stale playback, and quota failure leaves local writes available', async () => {
    const storage = sharedStorage();
    const a = await device(storage, { favorites: { 示例番剧: favorite() } });
    const b = await device(storage);
    await a.enabled(true);
    await b.enabled(true);
    await mutate(a.view, { type: 'delete', key: '示例番剧' });
    storage.fail = true;
    const failed = await a.sync();
    assert.match(failed.status.error, /上限/);
    assert.equal(a.bus.data.favorites.示例番剧, undefined);
    await mutate(b.view, { type: 'progress', key: '示例番剧', url: 'https://example.test/play/1', time: 70, duration: 100 });
    assert.equal(b.bus.data.favorites.示例番剧.time, 70);
    storage.fail = false;
    await a.sync();
    await b.sync();
    assert.equal(b.bus.data.favorites.示例番剧, undefined);
    assert.equal(b.bus.data.browserSyncStatus.error, null);
    await b.enabled(false);
    const writes = storage.writes;
    await b.sync();
    assert.equal(storage.writes, writes);
});
