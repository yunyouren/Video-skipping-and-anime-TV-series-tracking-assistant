const test = require('node:test');
const assert = require('node:assert/strict');
const { env, favorite } = require('./browser-stubs.cjs');
const walk = (node, cls) => node.children.flatMap(child => [child, ...walk(child, cls)]).filter(child => child.className?.split(' ').includes(cls));
const card = e => e.el('favListContainer').children.at(-1);

test('options mark complete and restore immediately update popup visibility', async () => {
    const o = env({ html: 'options.html', initial: { favorites: { '示例番剧': favorite() } } }); await o.boot('options.js');
    const popup = env({ html: 'popup.html', bus: o.bus }); await popup.boot('popup.js');
    walk(card(o), 'btn-complete-fav')[0].click(); await o.flush();
    assert.equal(o.bus.data.favorites['示例番剧'].seriesCompleted, true);
    assert.ok(popup.el('favList').innerHTML.includes('已隐藏'));
    o.el('favoritesStatusFilter').value = 'completed'; o.el('favoritesStatusFilter').fire('change');
    walk(card(o), 'btn-complete-fav')[0].click(); await o.flush();
    assert.equal(o.bus.data.favorites['示例番剧'].seriesCompleted, false);
    assert.ok(!popup.el('favList').innerHTML.includes('已隐藏'));
});
test('options settings editor only patches fields and preserves watch state and playback', async () => {
    const o = env({ html: 'options.html', initial: { whitelistMode: false, favorites: { '示例番剧': favorite({ time: 600, watchMarks: { 'https://example.test/play/1': true } }) } } }); await o.boot('options.js');
    walk(card(o), 'btn-details-fav')[0].click();
    walk(card(o), 'setting-introTime')[0].value = '17';
    walk(card(o), 'btn-save-settings')[0].click(); await o.flush();
    const saved = o.bus.data.favorites['示例番剧']; assert.equal(saved.introTime, 17); assert.equal(saved.time, 600);
    assert.equal(saved.autoSkipEnabled, true); assert.equal(saved.watchMarks[saved.url], true);
});
test('manual progress edit validates range and rejects stale concurrent edits', async () => {
    const o = env({ html: 'options.html', initial: { favorites: { '示例番剧': favorite({ time: 600 }) } } }); await o.boot('options.js');
    walk(card(o), 'btn-details-fav')[0].click();
    const input = walk(card(o), 'episode-edit-time')[0], save = walk(card(o), 'btn-save-progress')[0];
    input.value = '333'; save.click(); await o.flush(); assert.equal(o.bus.data.favorites['示例番剧'].time, 333);
    const item = o.bus.data.favorites['示例番剧'];
    const invalid = await o.mutate({ type: 'editProgress', key: item.series, url: item.url, time: 2000, expectedTimestamp: item.timestamp });
    assert.equal(invalid.ok, false);
    const before = item.timestamp;
    await o.mutate({ type: 'progress', key: item.series, url: item.url, episode: item.episode, time: 400, duration: 1200, timestamp: before + 1 });
    const stale = await o.mutate({ type: 'editProgress', key: item.series, url: item.url, time: 50, expectedTimestamp: before });
    assert.equal(stale.ok, false); assert.equal(o.bus.data.favorites[item.series].time, 400);
});
test('episode settings override can be reset and other episodes survive editing', async () => {
    const o = env({ html: 'options.html', initial: { favorites: { '示例番剧': favorite({ collectionId: 'bilibili:video:BVtest' }) } } }); await o.boot('options.js');
    const url = 'https://example.test/play/1';
    await o.mutate({ type: 'patch', key: '示例番剧', episodeUrl: url, patch: { introTime: 12 } });
    await o.mutate({ type: 'patch', key: '示例番剧', episodeUrl: 'https://example.test/play/2', patch: { introTime: 24 } });
    await o.mutate({ type: 'resetEpisodeSettings', key: '示例番剧', url });
    const item = o.bus.data.favorites['示例番剧'], core = o.context.SkipperCore;
    assert.equal(core.settings({}, item, url).introTime, 90); assert.equal(core.settings({}, item, 'https://example.test/play/2').introTime, 24);
    assert.ok(core.parseBackup(core.makeBackup(o.bus.data.favorites, [])).favorites['示例番剧'].episodeSettings);
});
