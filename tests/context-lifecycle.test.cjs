const test = require('node:test');
const assert = require('node:assert/strict');
const { player, env } = require('./browser-stubs.cjs');

test('old page stops messaging and playback control after extension context invalidation', async () => {
    const { e, v } = await player(); await e.tick(v); await e.tick(v);
    let calls = 0;
    e.context.chrome.runtime.sendMessage = () => { calls++; throw new Error('Extension context invalidated.'); };
    v.currentTime = 200;
    await assert.doesNotReject(() => e.tick(v, 2500));
    v.currentTime = 1;
    await assert.doesNotReject(() => e.tick(v, 2500));
    assert.equal(calls, 1); assert.equal(v.currentTime, 1);
    v.fire('pause'); v.fire('ended'); v.fire('loadedmetadata'); await e.flush();
    assert.equal(calls, 1);
    assert.equal(e.elements.filter(el => el.id === 'skipper-refresh-notice').length, 1);
    assert.ok(e.el('skipper-refresh-notice').children.some(el => el.textContent === '刷新页面'));
});
test('popup detects stale page version and offers reload without touching stored favorites', async () => {
    const e = env({ html: 'popup.html' });
    e.context.chrome.tabs.sendMessage = (...args) => args.at(-1)({ scriptVersion: '4.9', contextActive: false });
    await e.boot('popup.js');
    assert.equal(e.el('pageRefreshNotice').style.display, 'block');
    e.el('reloadVideoPage').click(); await e.flush();
    assert.equal(e.bus.reloadedTab, 1);
    assert.equal(e.bus.data.favorites, undefined);
});
test('popup stays compact when the page script version is current', async () => {
    const e = env({ html: 'popup.html' }); await e.boot('popup.js');
    assert.equal(e.el('pageRefreshNotice').style.display, 'none');
});
test('runtime id disappears after reload without attempting another write', async () => {
    const { e, v } = await player(); await e.tick(v);
    e.context.chrome.runtime.id = undefined;
    const count = e.messages.length;
    await e.tick(v, 2500);
    assert.equal(e.messages.length, count);
});
test('ordinary messaging errors are reported without invalidating the context', async () => {
    const { e } = await player();
    e.context.chrome.runtime.sendMessage = (_, cb) => { e.context.chrome.runtime.lastError = { message: 'Could not establish connection.' }; cb(); delete e.context.chrome.runtime.lastError; };
    let error; e.context.SkipperCore.mutate({ type: 'open' }, (_, value) => error = value);
    assert.equal(error, 'Could not establish connection.'); assert.equal(e.context.SkipperCore.contextValid(), true);
});
