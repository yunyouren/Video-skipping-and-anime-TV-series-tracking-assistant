const test = require('node:test');
const assert = require('node:assert/strict');
const { env, Element, favorite, video } = require('./browser-stubs.cjs');

async function partsPage({ bv = 'BV1f3RcBKENW', part = 9, active = part, labels = ['01','02','03','04','05','07','08','09','10','11','12','13'], initial = {}, legacy = false } = {}) {
    const title = '沃德朴一家（第一季/英配）';
    const h1 = new Element(); h1.textContent = title;
    const nodes = labels.map(text => {
        const node = new Element(), label = new Element(); label.title = text; label.textContent = text;
        node.querySelector = () => label; return node;
    });
    const headTitle = new Element(); headTitle.title = title;
    const head = new Element(); head.querySelector = () => headTitle;
    const group = new Element(); group.querySelectorAll = () => nodes; group.querySelector = () => nodes[active - 1]; head.closest = () => group;
    const v = video(100), url = `https://www.bilibili.com/video/${bv}/?p=${part}`;
    const selectors = { '.video-title': h1, h1 };
    if (legacy) { selectors['#multi_page'] = group; }
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
