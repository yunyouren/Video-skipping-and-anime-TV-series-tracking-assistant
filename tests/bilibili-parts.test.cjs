const test = require('node:test');
const assert = require('node:assert/strict');
const { env, Element, favorite, video } = require('./browser-stubs.cjs');

async function partsPage({ bv = 'BV1f3RcBKENW', part = 9, active = part, labels = ['01','02','03','04','05','07','08','09','10','11','12','13'],
    initial = {}, legacy = false, standalone = false, title = '沃德朴一家（第一季/英配）', listTitle = title, listBv } = {}) {
    const h1 = new Element(); h1.textContent = title;
    const nodes = labels.map(text => {
        const node = new Element(), label = new Element(); label.title = text; label.textContent = text;
        node.querySelector = () => label; return node;
    });
    const headTitle = new Element(); headTitle.title = listTitle;
    const head = new Element(); head.querySelector = () => headTitle;
    const group = new Element(); group.querySelectorAll = () => nodes; group.querySelector = () => nodes[active - 1]; head.closest = () => group;
    if (listBv) {
        const wrapper = new Element(); wrapper['data-key'] = listBv;
        group.closest = selector => selector === '.video-pod__item[data-key^="BV"]' ? wrapper : null;
    }
    const v = video(100), url = `https://www.bilibili.com/video/${bv}/?p=${part}`;
    const selectors = { '.video-title': h1, h1 };
    if (legacy) { selectors['#multi_page'] = group; }
    else if (standalone) {
        group.querySelectorAll = selector => selector === ':scope > .video-pod__item' ? nodes : [];
        group.querySelector = selector => selector === ':scope > .video-pod__item.active' ? nodes[active - 1] : null;
        selectors['.video-pod > .video-pod__body > .video-pod__list.multip'] = group;
    }
    else selectors['.video-pod .simple-base-item.active.head'] = head;
    const e = env({ title: `${labels[part - 1]}_哔哩哔哩_bilibili`, url, videos: [v], initial, selectors });
    await e.boot('content.js');
    const info = () => { let result; e.dispatch({ action: 'getNiceTitle' }, {}, r => result = r); return result; };
    return { e, v, nodes, info, url };
}
test('P9 reads title 10 and scopes favorite and catalog to the BV', async () => {
    const p = await partsPage(); const info = p.info();
    assert.equal(info.series, '沃德朴一家（第一季/英配）'); assert.equal(info.episode, '第10集');
    assert.equal(info.collectionId, 'bilibili:video:BV1f3RcBKENW');
    await p.e.mutate({ type: 'add', item: favorite({ series: info.series, collectionId: info.collectionId, url: p.url }) });
    await p.e.tick(p.v); await p.e.tick(p.v, 2500);
    const item = p.e.bus.data.favorites[info.series];
    assert.equal(item.catalog.length, 12); assert.equal(item.catalog[8].number, 10);
    assert.equal(new URL(item.catalog[8].url).searchParams.get('p'), '9');
    assert.equal(item.episode, '第10集');
    assert.ok(p.e.context.SkipperCore.parseBackup(p.e.context.SkipperCore.makeBackup(p.e.bus.data.favorites, [])).favorites[info.series].catalog[8].part === 9);
});
test('standalone Bilibili parts use the video title, actual P11 label and part order', async () => {
    const labels = Array.from({ length: 15 }, (_, i) => `分P内容 ${i + 1}`);
    labels[10] = '10_DCAC_单相逆变与方波_四个开关，翻出交流';
    const title = '电力电子技术 速通版 2小时';
    const p = await partsPage({ bv: 'BV1bus96AEhB', part: 11, standalone: true, labels, title });
    const info = p.info();
    assert.equal(info.pending, false);
    assert.equal(info.series, title);
    assert.equal(info.episode, labels[10]);
    assert.equal(info.collectionId, 'bilibili:video:BV1bus96AEhB');
    await p.e.mutate({ type: 'add', item: favorite({ series: title, collectionId: info.collectionId, url: p.url }) });
    await p.e.tick(p.v); await p.e.tick(p.v, 2500);
    const { catalog } = p.e.bus.data.favorites[title];
    assert.equal(catalog.length, 15);
    assert.equal(new URL(catalog[10].url).searchParams.get('p'), '11');
    let reply;
    p.e.dispatch({ action: 'clickNext' }, {}, result => reply = result);
    assert.equal(reply.clicked, true);
    assert.equal(p.nodes[11].clicks, 1);
});
test('standalone parts wait for the active row to match the URL', async () => {
    for (const active of [0, 2]) {
        const p = await partsPage({ part: 3, active, standalone: true, labels: ['序章', '正片', '花絮'] });
        assert.equal(p.info().pending, true);
        let reply;
        p.e.dispatch({ action: 'clickNext' }, {}, result => reply = result);
        assert.equal(reply.clicked, false);
    }
});
test('multipart collection matches a playlist title alias by the wrapper BV', async () => {
    const bv = 'BV1ATNWzeEFN';
    const title = '【飞佛 Phineas and Ferb】5/1+1.5 暑假街霸&今日阴转妈妈';
    const p = await partsPage({ bv, part: 1, title, listBv: bv,
        listTitle: 'S5E01p1+p2 暑假街霸&今日阴转妈妈', labels: ['OP', '暑', '假'] });
    const info = p.info();
    assert.equal(info.pending, false);
    assert.equal(info.series, title);
    assert.equal(info.episode, 'OP');
    assert.equal(info.collectionId, `bilibili:video:${bv}`);
});

test('matching display titles do not bypass a stale BV or an unset active part', async () => {
    for (const settings of [{ listBv: 'BV1ATNWzeEFN' }, { listBv: 'BV1f3RcBKENW', active: 0 }]) {
        const p = await partsPage(settings);
        assert.equal(p.info().pending, true);
        let reply;
        p.e.dispatch({ action: 'clickNext' }, {}, result => reply = result);
        assert.equal(reply.clicked, false);
    }
});
test('next follows actual part order across missing labels and stops at end', async () => {
    const p = await partsPage({ part: 5 });
    let result; p.e.dispatch({ action: 'clickNext' }, {}, r => result = r);
    assert.equal(result.clicked, true); assert.equal(p.nodes[5].clicks, 1);
    const last = await partsPage({ part: 12 }); last.e.dispatch({ action: 'clickNext' }, {}, r => result = r);
    assert.equal(result.clicked, false);
});
test('switching part restores only that part and migrates legacy BV favorite', async () => {
    const p = await partsPage({ initial: { favorites: { '自定义名称': favorite({ series: '自定义名称', url: 'https://www.bilibili.com/video/BV1f3RcBKENW/?p=8', time: 600, enableIntro: false }) } } });
    assert.equal(p.info().series, '自定义名称');
    await p.e.tick(p.v); await p.e.tick(p.v, 2500);
    const item = p.e.bus.data.favorites['自定义名称']; assert.equal(item.collectionId, 'bilibili:video:BV1f3RcBKENW');
    assert.equal(p.v.currentTime, 100); assert.equal(item.episodeProgress['https://www.bilibili.com/video/BV1f3RcBKENW?p=8'].time, 600);
});
test('old category collection is retained and never matched to a multipart work', async () => {
    const original = favorite({ series: '美漫', collectionId: 'bilibili:collection:6048304', url: 'https://www.bilibili.com/video/BV1f3RcBKENW/?p=9', time: 500 });
    const p = await partsPage({ initial: { favorites: { '美漫': original } } });
    await p.e.tick(p.v); assert.equal(p.e.bus.data.favorites['美漫'].time, 500);
    const info = p.info(); await p.e.mutate({ type: 'add', item: favorite({ series: info.series, url: p.url, collectionId: info.collectionId }) });
    const other = await partsPage({ bv: 'BVdifferent', initial: p.e.bus.data });
    await other.e.tick(other.v); assert.equal(Object.keys(other.e.bus.data.favorites).length, 2);
});
test('stale active part blocks writes until the DOM matches the URL', async () => {
    const p = await partsPage({ active: 8, initial: { favorites: { '作品': favorite({ series: '作品', collectionId: 'bilibili:video:BV1f3RcBKENW', url: 'https://www.bilibili.com/video/BV1f3RcBKENW/?p=9', time: 600 }) } } });
    assert.equal(p.info().pending, true); await p.e.tick(p.v); await p.e.tick(p.v, 2500);
    assert.equal(p.e.bus.data.favorites['作品'].time, 600);
});
test('legacy part list supports nonnumeric labels and canonical P1 identity', async () => {
    const p = await partsPage({ part: 2, labels: ['序章', '正片', '花絮'], legacy: true });
    assert.equal(p.info().episode, '正片'); assert.equal(p.info().pending, false);
    const core = p.e.context.SkipperCore;
    assert.equal(core.canonicalUrl('https://www.bilibili.com/video/BVtest/?p=1&t=99'), core.canonicalUrl('https://www.bilibili.com/video/BVtest/'));
});
test('duplicate part labels retain separate progress and direct popup URLs', async () => {
    const p = await partsPage({ part: 2, labels: ['10', '10', '花絮'] });
    const info = p.info(); await p.e.mutate({ type: 'add', item: favorite({ series: info.series, url: p.url, collectionId: info.collectionId }) });
    await p.e.tick(p.v); await p.e.tick(p.v, 2500);
    const popup = env({ html: 'popup.html', bus: p.e.bus }); await popup.boot('popup.js');
    popup.el('favList').children.at(-1).children[0].querySelector('.btn-episodes').click();
    const first = popup.elements.find(el => el.title === '10（P1）');
    const second = popup.elements.find(el => el.title === '10（P2）');
    assert.ok(first.textContent.includes('未看')); assert.ok(second.textContent.includes('看到一半'));
    first.click(); await popup.flush(); assert.equal(new URL(popup.opened[0].url).searchParams.get('p'), '1');
});
