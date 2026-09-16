const test = require('node:test');
const assert = require('node:assert/strict');
const { env, favorite, video, Element } = require('./browser-stubs.cjs');

async function collectionPlayer(initial = {}) {
    const h1 = new Element(); h1.textContent = '【简中】宝可梦地平线 第138话 剧情标题';
    const link = new Element('a'); link.href = '//space.bilibili.com/435684728/channel/collectiondetail?sid=5892471';
    link.textContent = '【熟肉】宝可梦地平线';
    const next = new Element(); next.title = '【简中】宝可梦地平线 第139话 下一话';
    const root = new Element(); root.querySelectorAll = () => [next]; link.closest = () => root;
    const v = video(100);
    const e = env({ initial, videos: [v], url: 'https://www.bilibili.com/video/BV1ixVa6QEZP/',
        selectors: { '.video-pod__header a[href*="collectiondetail?"]': link, h1 } });
    await e.boot('content.js');
    let info; e.dispatch({ action: 'getNiceTitle' }, {}, x => info = x);
    return { e, v, h1, next, info };
}
test('collection metadata uses real episode and stable id, not playlist position', async () => {
    const { info } = await collectionPlayer();
    assert.equal(info.episode, '第138话');
    assert.equal(info.collectionId, 'bilibili:collection:5892471');
    assert.equal(info.series, '【熟肉】宝可梦地平线');
});
test('different titles in same collection update one bookmark and never restore previous video time', async () => {
    const item = favorite({ series: '自定义名字', collectionId: 'bilibili:collection:5892471', time: 600,
        episode: '第137话', url: 'https://www.bilibili.com/video/BVprevious/', enableIntro: false, enableOutro: false });
    const { e, v } = await collectionPlayer({ favorites: { '自定义名字': item } });
    await e.tick(v); await e.tick(v, 2500);
    assert.equal(Object.keys(e.bus.data.favorites).length, 1);
    assert.equal(e.bus.data.favorites['自定义名字'].episode, '第138话');
    assert.equal(v.currentTime, 100);
});
test('legacy bookmark on same BV upgrades identity without losing switches', async () => {
    const { e, v } = await collectionPlayer({ favorites: { '旧标题': favorite({ series: '旧标题',
        url: 'https://www.bilibili.com/video/BV1ixVa6QEZP?spm_id_from=abc&vd_source=xyz', enableIntro: false }) } });
    await e.tick(v); await e.tick(v, 2500);
    assert.equal(e.bus.data.favorites['旧标题'].collectionId, 'bilibili:collection:5892471');
    assert.equal(e.bus.data.favorites['旧标题'].enableIntro, false);
});
test('next episode is confined to matching collection and stops when missing', async () => {
    const { e, next } = await collectionPlayer();
    let result; e.dispatch({ action: 'clickNext' }, {}, x => result = x);
    assert.equal(result.clicked, true); assert.equal(next.clicks, 1);
    next.title = '第140话'; e.dispatch({ action: 'clickNext' }, {}, x => result = x);
    assert.equal(result.clicked, false); assert.equal(next.clicks, 1);
});
test('same-name collections remain distinct; one-episode overrides round-trip', async () => {
    const e = env(); await e.boot('background.js'); e.bus.background = e;
    for (const n of [1, 2]) await e.mutate({ type: 'add', item: favorite({ collectionId: `bilibili:collection:${n}` }) });
    assert.equal(Object.keys(e.bus.data.favorites).length, 2);
    const [key, item] = Object.entries(e.bus.data.favorites)[0];
    await e.mutate({ type: 'patch', key, id: item.id, episodeUrl: item.url, patch: { introTime: 12, enableIntro: true } });
    const core = e.context.SkipperCore, saved = e.bus.data.favorites[key];
    assert.equal(core.settings({ whitelistMode: true }, saved, item.url).introTime, 12);
    assert.equal(core.settings({ whitelistMode: true }, saved, item.url + '?p=2').introTime, 90);
    assert.ok(core.parseBackup(core.makeBackup(e.bus.data.favorites, [])).favorites[key].episodeSettings);
});
test('popup collection bookmark defaults skip off and saves per-episode controls', async () => {
    const { e: page, info } = await collectionPlayer();
    page.bus.top = page;
    const popup = env({ html: 'popup.html', bus: page.bus }); await popup.boot('popup.js');
    popup.el('addFavBtn').click(); await popup.flush();
    let saved = popup.bus.data.favorites[info.series];
    assert.equal(saved.collectionId, info.collectionId);
    assert.equal(saved.episode, '第138话');
    assert.equal(saved.enableIntro, false); assert.equal(saved.enableOutro, false);
    assert.equal(popup.el('enableIntro').checked, false);
    popup.el('episodeScope').checked = true; popup.el('episodeScope').fire('change');
    popup.el('introTime').value = '17'; popup.el('introTime').fire('input'); await popup.flush();
    saved = popup.bus.data.favorites[info.series];
    assert.equal(saved.episodeSettings[popup.context.SkipperCore.canonicalUrl(info.url)].introTime, 17);
    assert.notEqual(saved.introTime, 17);
});
test('unwatched episode navigation selects inside the collection before recording progress', async () => {
    const { e, v, h1, next } = await collectionPlayer({ favorites: { '收藏': favorite({ series: '收藏', collectionId: 'bilibili:collection:5892471' }) } });
    e.window.location.href += '?skipper_collection=bilibili%3Acollection%3A5892471&skipper_episode=139';
    e.window.history = { replaceState(_, __, url) { e.window.location.href = url; } };
    await e.tick(v); assert.equal(next.clicks, 1); assert.equal(e.bus.data.favorites['收藏'].episode, '第1集');
    h1.textContent = '宝可梦地平线 第139话';
    await e.tick(v); await e.tick(v, 2500);
    assert.equal(e.bus.data.favorites['收藏'].episode, '第139话');
    assert.ok(!e.window.location.href.includes('skipper_episode'));
    assert.equal(e.bus.data.favorites['收藏'].catalog[0].number, 139);
});
