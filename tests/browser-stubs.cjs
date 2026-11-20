const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const copy = x => x === undefined ? undefined : structuredClone(x);
class Element {
    constructor(tag = 'div', registry = []) {
        this.tagName = tag.toUpperCase(); this.registry = registry; this.children = []; this.listeners = {};
        this.style = {}; this.dataset = {}; this.value = ''; this.checked = false; this.id = '';
        this.innerText = ''; this.textContent = ''; this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set innerHTML(html) {
        this.html = html;
        for (const m of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
            const e = new Element(m[1], this.registry); e.id = m[2]; this.registry.push(e);
        }
    }
    get innerHTML() { return this.html || ''; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    fire(name, extra = {}) { for (const f of this.listeners[name] || []) f({ target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }); }
    appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
    removeChild(e) { this.children = this.children.filter(c => c !== e); }
    remove() { this.parentNode?.removeChild(this); }
    querySelector(s) { return s.startsWith('.') && this.innerHTML.includes(s.slice(1)) ? ((this.queries ||= {})[s] ||= new Element('button')) : null; }
    querySelectorAll() { return []; }
    getAttribute(k) { return this[k] ?? null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest() { return null; }
    click() { this.clicks = (this.clicks || 0) + 1; this.fire('click'); }
    play() { this.paused = false; this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); }
}
const video = (time = 1, duration = 1200) => Object.assign(new Element('video'), { currentTime: time, duration, paused: false, readyState: 4 });
const favorite = (extra = {}) => ({ series: '示例番剧', episode: '第1集', time: 0, duration: 1200, site: 'Web', url: 'https://example.test/play/1', folder: '默认收藏', timestamp: 1, autoSkipEnabled: true, introTime: 90, outroTime: 60, minDuration: 300, ...extra });
const makeBus = initial => ({ data: copy(initial || {}), jobs: [], listeners: [], writes: [] });
function env({ initial = {}, bus = makeBus(initial), title = '示例番剧 第1集', url = 'https://example.test/play/1', iframe = false, videos = [], selectors = {}, html } = {}) {
    let now = 1700000000000;
    const elements = [], all = {}, alerts = [], blobs = [], opened = [], messages = [], listeners = [], installs = [];
    const body = new Element('body', elements), document = new Element('document', elements);
    Object.assign(document, { body, documentElement: body, title });
    document.createElement = tag => { const e = new Element(tag, elements); elements.push(e); return e; };
    document.createDocumentFragment = () => new Element('fragment', elements);
    document.getElementById = id => elements.find(e => e.id === id) || null;
    document.querySelector = selector => selectors[selector] || null;
    document.querySelectorAll = selector => selector === 'video' ? videos : all[selector] || [];
    if (html) document.innerHTML = source(html);
    const window = new Element('window');
    Object.assign(window, { self: window, top: iframe ? {} : window, innerWidth: 1280, innerHeight: 720, location: { href: url, hash: '' } });
    const chrome = {
        storage: {
            local: {
                get(keys, cb) {
                    const result = keys == null ? copy(bus.data) : Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, copy(Object.hasOwn(bus.data, k) ? bus.data[k] : v)]));
                    bus.jobs.push(() => cb(result));
                },
                set(data, cb) {
                    const snapshot = copy(data); bus.writes.push(snapshot);
                    bus.jobs.push(() => {
                        if (bus.failNextWrite) { bus.failNextWrite = false; chrome.runtime.lastError = { message: 'simulated storage failure' }; cb?.(); delete chrome.runtime.lastError; return; }
                        const changes = {};
                        for (const [k, v] of Object.entries(snapshot)) {
                            if (JSON.stringify(bus.data[k]) !== JSON.stringify(v)) changes[k] = { oldValue: copy(bus.data[k]), newValue: copy(v) };
                            bus.data[k] = copy(v);
                        }
                        if (Object.keys(changes).length) for (const f of bus.listeners) bus.jobs.push(() => f(copy(changes), 'local'));
                        if (cb) bus.jobs.push(cb);
                    });
                }
            }, onChanged: { addListener(f) { bus.listeners.push(f); } }
        },
        runtime: {
            id: 'test-extension',
            getURL(file) { return `chrome-extension://test-extension/${file}`; },
            getManifest() { return JSON.parse(source('manifest.json')); },
            onMessage: { addListener(f) { listeners.push(f); } }, onInstalled: { addListener(f) { installs.push(f); } },
            sendMessage(message, cb) {
                messages.push(copy(message));
                bus.jobs.push(() => bus.background.dispatch(message, { url: html ? chrome.runtime.getURL(html) : window.location.href, frameId: iframe ? 1 : 0, tab: { id: 1, title: iframe ? '示例番剧 第1集' : document.title, url: iframe ? 'https://example.test/play/1' : window.location.href } }, cb || (() => {})));
            }, openOptionsPage() {}
        },
        tabs: {
            query(q, cb) { bus.jobs.push(() => cb([{ id: 1 }])); },
            sendMessage(id, message, options, cb) {
                if (typeof options === 'function') cb = options;
                bus.jobs.push(() => {
                    if (bus.top && message.action !== 'getRequestVideoInfo') { bus.top.dispatch(message, {}, cb); return; }
                    cb?.(message.action === 'getNiceTitle' ? { series: '示例番剧', sourceSeries: '示例番剧', episode: '第1集', site: 'Web', url, scriptVersion: JSON.parse(source('manifest.json')).version, contextActive: true }
                        : message.action === 'clickNext' ? { clicked: !!bus.topClicked }
                        : { series: '示例番剧', episode: '第1集', site: 'Web', url: url + '?t=600', time: 600, duration: 1200, timestamp: now });
                });
            }, create(data) { opened.push(data); }, reload(id, options, cb) { bus.reloadedTab = id; cb?.(); }
        }, i18n: { getMessage() { return ''; } }
    };
    class FakeURL extends URL {
        static createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }
        static revokeObjectURL() {}
    }
    if (bus.syncStorage) chrome.storage.sync = bus.syncStorage;
    const context = vm.createContext({ document, window, chrome, console, Blob, URL: FakeURL, crypto: webcrypto, TextEncoder,
        Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
        setTimeout() { return 1; }, clearTimeout() {}, MutationObserver: class { observe() {} },
        alert(x) { alerts.push(x); }, confirm() { return true; }, prompt() { return '改名后的番剧'; },
        FileReader: class { readAsText(file) { bus.jobs.push(() => this.onload({ target: { result: file.text } })); } }
    });
    context.importScripts = (...names) => names.forEach(name => vm.runInContext(source(name), context, { filename: name }));
    const e = { context, bus, document, window, elements, all, alerts, blobs, opened, messages, installs,
        el: id => document.getElementById(id),
        dispatch(message, sender = {}, cb = () => {}) { for (const f of listeners) f(message, sender, cb); },
        async flush() {
            let idle = 0;
            for (let i = 0; i < 1000; i++) {
                if (bus.jobs.length) { idle = 0; bus.jobs.shift()(); } else idle++;
                await Promise.resolve();
                if (idle > 20) return;
            }
            throw new Error('Callback queue did not settle');
        },
        async boot(name) {
            if (name !== 'background.js' && !bus.background) { bus.background = env({ bus }); await bus.background.boot('background.js'); }
            if (name !== 'background.js') context.importScripts('tracker-core.js');
            context.importScripts(name);
            if (html) document.fire('DOMContentLoaded');
            await this.flush();
        },
        async tick(v, ms = 1500, flush = true) { now += ms; v.fire('timeupdate'); if (flush) await this.flush(); },
        advanceTime(ms) { now += ms; },
        async mutate(op) { let response; chrome.runtime.sendMessage({ action: 'mutateFavorites', operation: op }, r => { response = r; }); await this.flush(); return response; }
    };
    return e;
}
async function player({ fav = favorite(), initial = {}, time = 1, duration = 1200, ...rest } = {}) {
    const v = video(time, duration);
    const e = env({ initial: { favorites: fav ? { [fav.series]: fav } : {}, ...initial }, videos: [v], ...rest });
    await e.boot('content.js'); return { e, v };
}
module.exports = { env, player, favorite, video, Element, makeBus, source, root };
