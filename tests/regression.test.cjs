const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { env, player, favorite, video, Element, makeBus, source, root } = require('./browser-stubs.cjs');

test('opening a favorite moves it first without changing resume progress', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: {
        '示例番剧': favorite({ time: 600, timestamp: 10 }),
        '另一部': favorite({ series: '另一部', timestamp: 20 })
    } } });
    await e.boot('popup.js');
    const rows = () => e.el('favList').children.at(-1).children;
    assert.ok(rows()[0].innerHTML.includes('另一部'));
    rows()[1].click(); await e.flush();
    assert.ok(rows()[0].innerHTML.includes('示例番剧'));
    const saved = e.bus.data.favorites['示例番剧'];
    assert.equal(saved.time, 600);
    assert.equal(saved.timestamp, 10);
    assert.ok(saved.lastOpenedAt > 20);
    assert.equal(e.opened.length, 1);
    const backup = e.context.SkipperCore.makeBackup(e.bus.data.favorites, []);
    assert.equal(e.context.SkipperCore.parseBackup(backup).favorites['示例番剧'].lastOpenedAt, saved.lastOpenedAt);
});

test('all production scripts parse and manifest assets exist', () => {
    for (const f of ['tracker-core.js', 'background.js', 'content.js', 'popup.js', 'options.js']) new vm.Script(source(f), { filename: f });
    const m = JSON.parse(source('manifest.json'));
    for (const f of [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...m.content_scripts[0].js, ...Object.values(m.icons)]) assert.ok(fs.existsSync(path.join(root, f)), f);
    for (const html of ['popup.html', 'options.html']) assert.ok(source(html).indexOf('tracker-core.js') < source(html).indexOf(html.replace('.html', '.js')));
});
test('uncollected videos and individually disabled favorites do not skip', async () => {
    for (const config of [{ fav: null, initial: { autoSkipEnable: true } }, { fav: favorite({ autoSkipEnabled: false }) }]) {
        const { e, v } = await player(config); await e.tick(v); assert.equal(v.currentTime, 1);
    }
});
test('intro, outro and short video threshold still work', async () => {
    const a = await player(); await a.e.tick(a.v); assert.equal(a.v.currentTime, 90);
    const b = await player({ time: 1150 }); await b.e.tick(b.v); assert.equal(b.v.currentTime, 1200);
    const c = await player({ duration: 120 }); await c.e.tick(c.v); assert.equal(c.v.currentTime, 1);
});
test('explicit per-favorite switches override stored durations', async () => {
    const a = await player({ fav: favorite({ enableIntro: false }) }); await a.e.tick(a.v); assert.equal(a.v.currentTime, 1);
    const b = await player({ fav: favorite({ enableOutro: false }), time: 1150 }); await b.e.tick(b.v); assert.equal(b.v.currentTime, 1150);
});
test('resume restores 600 seconds before permitting progress writes', async () => {
    const { e, v } = await player({ fav: favorite({ time: 600, introTime: 0, outroTime: 0 }) });
    await e.tick(v, 500); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
    await e.tick(v, 1000); assert.equal(v.currentTime, 600); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
    await e.tick(v, 600); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
});
test('resume does not seek a different episode or override a user seek', async () => {
    const a = await player({ fav: favorite({ time: 600, introTime: 0 }), title: '示例番剧 第2集', url: 'https://example.test/play/2' });
    await a.e.tick(a.v); assert.equal(a.v.currentTime, 1);
    const b = await player({ fav: favorite({ time: 600, introTime: 0 }) }); b.v.currentTime = 100; b.v.fire('seeking'); await b.e.tick(b.v); assert.equal(b.v.currentTime, 100);
});
test('existing site resume is respected and completed favorite starts over', async () => {
    const a = await player({ fav: favorite({ time: 600 }), time: 300 }); await a.e.tick(a.v); assert.equal(a.v.currentTime, 300);
    const b = await player({ fav: favorite({ time: 1190, introTime: 0 }) }); await b.e.tick(b.v); assert.equal(b.v.currentTime, 1);
});
test('ordinary ended event restarts playback when enabled', async () => {
    const { e, v } = await player({ fav: favorite({ autoRestart: true, introTime: 0, outroTime: 0 }), time: 600 });
    await e.tick(v); v.currentTime = 1200; v.fire('ended'); await e.flush(); assert.equal(v.currentTime, 0); assert.equal(v.playCalls, 1);
});
test('next episode takes precedence over restart and works with zero outro', async () => {
    const button = new Element('button'); const { e, v } = await player({ fav: favorite({ autoPlayNext: true, autoRestart: true, outroTime: 0 }), time: 600, selectors: { '.bpx-player-ctrl-next': button } });
    await e.tick(v); v.currentTime = 1200; v.fire('ended'); await e.flush(); assert.equal(button.clicks, 1); assert.equal(v.playCalls, undefined);
});
test('outro next click happens once and hidden next controls are ignored', async () => {
    const button = new Element('button'); const a = await player({ fav: favorite({ autoPlayNext: true }), time: 1150, selectors: { '.bpx-player-ctrl-next': button } });
    await a.e.tick(a.v); await a.e.tick(a.v); assert.equal(button.clicks, 1);
    const hidden = new Element('button'); hidden.hidden = true;
    const b = await player({ fav: favorite({ autoPlayNext: true }), time: 1150, selectors: { '.bpx-player-ctrl-next': hidden } }); await b.e.tick(b.v); assert.equal(hidden.clicks, undefined); assert.equal(b.v.currentTime, 1200);
});
test('already-loaded iframe requests parent metadata and can skip immediately after settling', async () => {
    const { e, v } = await player({ iframe: true, title: '播放器' }); await e.tick(v); assert.equal(v.currentTime, 90); assert.ok(e.messages.some(m => m.action === 'getPageInfo'));
});
test('iframe can click next in parent document', async () => {
    const { e, v } = await player({ iframe: true, title: '播放器', time: 1150, fav: favorite({ autoPlayNext: true }) }); e.bus.topClicked = true;
    await e.tick(v); assert.equal(v.currentTime, 1150); assert.ok(e.messages.some(m => m.action === 'clickNextInTop'));
});
test('same-URL title changes refresh episode metadata without restoring old episode', async () => {
    const { e, v } = await player({ time: 100 }); await e.tick(v);
    e.document.title = '示例番剧 第2集'; v.currentTime = 1; await e.tick(v); await e.tick(v);
    assert.equal(e.bus.data.favorites['示例番剧'].episode, '第2集'); assert.notEqual(v.currentTime, 100);
});
test('maximum episode guard is applied in the serialized writer', async () => {
    const { e, v } = await player({ fav: favorite({ episode: '第12集', time: 600 }), initial: { onlySaveMaxEpisode: true }, title: '示例番剧 第3集', time: 100 });
    await e.tick(v); assert.equal(e.bus.data.favorites['示例番剧'].episode, '第12集'); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
});
test('two pages update different favorites without stale snapshot overwrites', async () => {
    const bus = makeBus({ favorites: { '示例番剧': favorite(), '另一部': favorite({ series: '另一部' }) } });
    const a = await player({ bus, time: 100 }); const b = await player({ bus, title: '另一部 第1集', url: 'https://example.test/other', time: 200 });
    await a.e.tick(a.v, 1500, false); await b.e.tick(b.v, 1500, false); await a.e.flush();
    assert.equal(bus.data.favorites['示例番剧'].time, 100); assert.equal(bus.data.favorites['另一部'].time, 200);
});
test('late progress preserves concurrent settings and does not resurrect deletion', async () => {
    const { e } = await player();
    const progress = { type: 'progress', key: '示例番剧', episode: '第1集', site: 'Web', url: 'https://example.test/play/1', time: 100, duration: 1200 };
    await e.mutate({ type: 'patch', key: '示例番剧', patch: { enableIntro: false } });
    await e.mutate(progress);
    assert.equal(e.bus.data.favorites['示例番剧'].enableIntro, false);
    assert.equal(e.bus.data.favorites['示例番剧'].time, 100);
    await e.mutate({ type: 'delete', key: '示例番剧' });
    await e.mutate({ ...progress, time: 200 });
    assert.equal(e.bus.data.favorites['示例番剧'], undefined);
});
test('storage errors are reported and do not poison later queued operations', async () => {
    const { e } = await player(); e.bus.failNextWrite = true;
    const failed = await e.mutate({ type: 'patch', key: '示例番剧', patch: { introTime: 30 } });
    assert.equal(failed.ok, false); assert.match(failed.error, /storage failure/);
    const success = await e.mutate({ type: 'patch', key: '示例番剧', patch: { introTime: 40 } });
    assert.equal(success.ok, true); assert.equal(e.bus.data.favorites['示例番剧'].introTime, 40);
});
test('folder changes preserve progress and register new folders in both views', async () => {
    const { e } = await player({ fav: favorite({ time: 600 }) });
    await e.mutate({ type: 'move', key: '示例番剧', folder: '新文件夹' });
    assert.ok(e.bus.data.favFolders.includes('新文件夹')); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
    await e.mutate({ type: 'deleteFolder', folder: '新文件夹' });
    assert.equal(e.bus.data.favorites['示例番剧'].folder, '默认收藏'); assert.equal(e.bus.data.favorites['示例番剧'].time, 600);
});
test('new install notice is read and only the top page consumes it', async () => {
    const a = await player({ initial: { showWhitelistNotice: true } }); assert.ok(a.e.el('bili-skipper-notice')); assert.equal(a.e.bus.data.showWhitelistNotice, false);
    const b = await player({ initial: { showWhitelistNotice: true }, iframe: true }); assert.equal(b.e.el('bili-skipper-notice'), null); assert.equal(b.e.bus.data.showWhitelistNotice, true);
});
test('popup persists per-favorite switch and time changes without changing another favorite', async () => {
    const e = env({ html: 'popup.html', initial: { favorites: { '示例番剧': favorite(), '另一部': favorite({ series: '另一部', introTime: 60 }) } } }); await e.boot('popup.js');
    e.el('enableIntro').checked = false; e.el('enableIntro').fire('change'); await e.flush();
    e.el('introTime').value = '120'; e.el('introTime').fire('input'); await e.flush();
    assert.equal(e.bus.data.favorites['示例番剧'].enableIntro, false); assert.equal(e.bus.data.favorites['示例番剧'].introTime, 120); assert.equal(e.bus.data.favorites['另一部'].introTime, 60);
});
test('bookmark creation and reopening preserve Bilibili timestamp and query parameters', async () => {
    const e = env({ html: 'popup.html', url: 'https://www.bilibili.com/video/BV_TEST?p=2' }); await e.boot('popup.js');
    e.el('addFavBtn').click(); await e.flush(); const item = e.bus.data.favorites['示例番剧']; assert.equal(new URL(item.url).searchParams.get('t'), '600'); assert.equal(new URL(item.url).searchParams.get('p'), '2');
});
test('legacy and wrapped backups import through either UI and exports share a schema', async () => {
    const legacy = { '示例番剧': favorite({ time: 600 }) };
    const wrapped = { version: '4.2', favorites: legacy, folders: ['默认收藏', '空文件夹'] };
    for (const data of [legacy, wrapped]) {
        const p = env({ html: 'popup.html' }); await p.boot('popup.js'); p.context.handleImport(data); await p.flush(); assert.equal(p.bus.data.favorites['示例番剧'].time, 600);
        const o = env({ html: 'options.html' }); await o.boot('options.js'); o.context.importFavorites({ target: { files: [{ text: JSON.stringify(data) }], value: 'file' } }); await o.flush(); assert.equal(o.bus.data.favorites['示例番剧'].time, 600);
        o.context.exportFavorites(); await o.flush(); const exported = JSON.parse(await o.blobs[0].text()); assert.ok(exported.favorites['示例番剧']); assert.ok(Array.isArray(exported.folders));
        p.all['.folder-chk:checked'] = [{ value: '默认收藏' }]; p.el('btnConfirmExport').click(); await p.flush(); const popupExport = JSON.parse(await p.blobs[0].text()); assert.equal(popupExport.format, exported.format);
    }
});
test('invalid import is rejected before modifying existing favorites', async () => {
    const e = env({ html: 'options.html', initial: { favorites: { '示例番剧': favorite() } } }); await e.boot('options.js');
    for (const data of [null, [], { version: '4.2', timestamp: 10 }, { favorites: { bad: { series: 'bad', url: 'javascript:alert(1)' } } }]) {
        e.context.importFavorites({ target: { files: [{ text: JSON.stringify(data) }], value: 'file' } }); await e.flush();
        assert.deepEqual(Object.keys(e.bus.data.favorites), ['示例番剧']);
    }
});
test('renamed favorite keeps matching, settings and progress updates', async () => {
    const bus = makeBus({ favorites: { '示例番剧': favorite() } }); const o = env({ html: 'options.html', bus }); await o.boot('options.js');
    o.context.renameFavorite('示例番剧'); await o.flush(); assert.ok(bus.data.favorites['改名后的番剧'].aliases.includes('示例番剧'));
    const p = await player({ bus }); await p.e.tick(p.v); assert.equal(p.v.currentTime, 90); p.v.currentTime = 100; await p.e.tick(p.v, 2500); assert.equal(bus.data.favorites['改名后的番剧'].time, 100);
});
test('secondary video does not overwrite main-player progress', async () => {
    const main = video(100), ad = video(10, 30); const e = env({ videos: [main, ad], initial: { favorites: { '示例番剧': favorite() } } }); await e.boot('content.js');
    await e.tick(main); await e.tick(ad); assert.equal(e.bus.data.favorites['示例番剧'].time, 100);
});
test('switching whitelist mode reloads the appropriate global or favorite controls', async () => {
    const e = env({ html: 'popup.html', initial: { introTime: 90, favorites: { '示例番剧': favorite({ introTime: 20 }) } } }); await e.boot('popup.js');
    assert.equal(Number(e.el('introTime').value), 20);
    e.el('whitelistMode').checked = false; e.el('whitelistMode').fire('change'); await e.flush(); assert.equal(Number(e.el('introTime').value), 90);
    e.el('whitelistMode').checked = true; e.el('whitelistMode').fire('change'); await e.flush(); assert.equal(Number(e.el('introTime').value), 20);
});
test('hash-based episode routes do not share resume positions', async () => {
    const { e, v } = await player({ fav: favorite({ time: 600, introTime: 0, episode: '观看中', url: 'https://example.test/#/episode/1' }), title: '示例番剧', url: 'https://example.test/#/episode/2' });
    await e.tick(v); assert.equal(v.currentTime, 1);
});
test('favorite titles and folder names are escaped in popup markup', async () => {
    const name = '<img id="injected" src="https://example.test/image">';
    const e = env({ html: 'popup.html', initial: { favorites: { [name]: favorite({ series: name, folder: '<b>folder</b>' }) } } }); await e.boot('popup.js');
    assert.equal(e.el('injected'), null);
    assert.ok(e.elements.some(element => element.innerHTML.includes('&lt;img')));
});
