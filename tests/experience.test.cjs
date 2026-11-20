const test = require('node:test');
const assert = require('node:assert/strict');
const { env, favorite, player } = require('./browser-stubs.cjs');

test('each episode restores its own progress and survives backup', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite({ time: 600 }) } } }); await e.boot('popup.js');
    await e.mutate({ type: 'progress', key: '示例番剧', url: 'https://example.test/play/2', episode: '第2集', time: 200, duration: 1200, timestamp: 100 });
    const saved = e.bus.data.favorites['示例番剧'];
    assert.equal(saved.episodeProgress['https://example.test/play/1'].time, 600);
    assert.equal(saved.episodeProgress['https://example.test/play/2'].time, 200);
    const p = await player({ fav: saved }); await p.e.tick(p.v); assert.equal(p.v.currentTime, 600);
    const backup = e.context.SkipperCore.makeBackup(e.bus.data.favorites, []);
    assert.equal(e.context.SkipperCore.parseBackup(backup).favorites['示例番剧'].episodeProgress['https://example.test/play/2'].time, 200);
});
test('maximum-episode preference preserves individual rewind progress', async () => {
    const e = env({ html: 'popup.html', initial: { onlySaveMaxEpisode: true, favorites: { '示例番剧': favorite({ episode: '第12集' }) } } }); await e.boot('popup.js');
    await e.mutate({ type: 'progress', key: '示例番剧', url: 'https://example.test/play/3', episode: '第3集', time: 123, duration: 1200 });
    const item = e.bus.data.favorites['示例番剧']; assert.equal(item.episode, '第12集'); assert.equal(item.episodeProgress['https://example.test/play/3'].time, 123);
});
test('quick intro and outro set measured values without changing progress', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite({ time: 99 }) } } }); await e.boot('popup.js');
    e.el('setIntroHere').click(); await e.flush(); e.el('setOutroHere').click(); await e.flush();
    const item = e.bus.data.favorites['示例番剧']; assert.equal(item.introTime, 600); assert.equal(item.outroTime, 600); assert.equal(item.time, 99);
    assert.equal(item.enableIntro, true); assert.equal(item.enableOutro, true);
});
test('pin overrides name sort and progress writes do not shuffle open list', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { A: favorite({ series: 'A', id: 'a', timestamp: 2 }), B: favorite({ series: 'B', id: 'b', timestamp: 1 }) } } }); await e.boot('popup.js');
    const first = () => e.el('favList').children.at(-1).children[0].innerHTML;
    await e.mutate({ type: 'progress', key: 'B', url: 'https://example.test/play/2', episode: '第2集', time: 12, duration: 100 });
    assert.ok(first().includes('>A</div>'));
    e.el('refreshOrder').click(); assert.ok(first().includes('>B</div>'));
    e.el('sortMode').value = 'name'; e.el('sortMode').fire('change'); await e.flush(); assert.ok(first().includes('>A</div>'));
    await e.mutate({ type: 'pin', key: 'B', pinned: true }); assert.ok(first().includes('📌 B'));
});
test('diagnostics report save failures and recover after a successful write', async () => {
    const p = await player(); await p.e.tick(p.v); p.e.bus.failNextWrite = true;
    p.v.currentTime = 200; await p.e.tick(p.v, 2500);
    let report; p.e.dispatch({ action: 'diagnostics' }, {}, r => report = r);
    assert.equal(report.saveStatus.state, '保存失败');
    p.v.currentTime = 202; await p.e.tick(p.v, 2500);
    p.e.dispatch({ action: 'diagnostics' }, {}, r => report = r); assert.equal(report.saveStatus.state, '已保存');
    assert.equal(report.website, 'example.test'); assert.equal(report.url, undefined);
});
test('manual watched toggle preserves playback and survives subsequent writes and backup', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite({ time: 600 }) } } }); await e.boot('popup.js');
    const row = () => e.el('favList').children.at(-1).children[0];
    row().querySelector('.btn-watched').click(); await e.flush();
    const core = e.context.SkipperCore;
    let item = e.bus.data.favorites['示例番剧']; assert.equal(core.watchState(item, item), '已看完'); assert.equal(item.time, 600);
    await e.mutate({ type: 'progress', key: item.series, url: item.url, episode: item.episode, time: 601, duration: 1200 });
    item = e.bus.data.favorites['示例番剧']; assert.equal(core.watchState(item, item), '已看完');
    assert.deepEqual(JSON.parse(JSON.stringify(core.parseBackup(core.makeBackup(e.bus.data.favorites, [])).favorites[item.series].watchMarks)), item.watchMarks);
    row().querySelector('.btn-watched').click(); await e.flush(); item = e.bus.data.favorites[item.series];
    assert.equal(core.watchState(item, item), '未看'); assert.equal(item.time, 601);
});
test('quick folder selector moves immediately without opening video or changing progress', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite({ time: 600 }) } } }); await e.boot('popup.js');
    const select = e.el('favList').children.at(-1).children[0].querySelector('.quick-folder');
    select.value = '日漫'; select.fire('change'); await e.flush();
    assert.equal(e.bus.data.favorites['示例番剧'].folder, '日漫'); assert.equal(e.bus.data.favorites['示例番剧'].time, 600); assert.equal(e.opened.length, 0);
});
test('unplayed catalog episode mark remains visible after gaining a playback record', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite() } } }); await e.boot('popup.js');
    await e.mutate({ type: 'watched', key: '示例番剧', number: 2, watched: true });
    const core = e.context.SkipperCore, item = e.bus.data.favorites['示例番剧'];
    assert.equal(core.watchState(item, null, { number: 2 }), '已看完');
    assert.equal(core.watchState(item, { url: 'https://example.test/2', episode: '第2集', time: 10, duration: 100 }), '已看完');
    assert.equal(core.watchState(item, null, { number: 3 }), '未看');
});
test('whole-series completion hides without deleting and can be shown and undone', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite({ time: 600 }) } } }); await e.boot('popup.js');
    e.el('favList').children.at(-1).children[0].querySelector('.btn-series-complete').click(); await e.flush();
    assert.equal(e.bus.data.favorites['示例番剧'].seriesCompleted, true);
    assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
    assert.ok(e.el('favList').innerHTML.includes('已看完'));
    await e.mutate({ type: 'progress', key: '示例番剧', url: 'https://example.test/play/1', episode: '第1集', time: 601, duration: 1200 });
    const core = e.context.SkipperCore;
    assert.equal(core.parseBackup(core.makeBackup(e.bus.data.favorites, [])).favorites['示例番剧'].seriesCompleted, true);
    assert.ok(e.el('favList').innerHTML.includes('已看完'));
    e.el('showCompleted').checked = true; e.el('showCompleted').fire('change'); await e.flush();
    e.el('favList').children.at(-1).children[0].querySelector('.btn-series-complete').click(); await e.flush();
    assert.equal(e.bus.data.favorites['示例番剧'].seriesCompleted, false);
    const reopened = env({ html: 'popup.html', bus: e.bus }); await reopened.boot('popup.js');
    assert.ok(reopened.el('favList').children.at(-1).children[0].innerHTML.includes('示例番剧'));
});
