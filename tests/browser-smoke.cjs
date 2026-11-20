/* Optional real Chromium check. Install playwright, then run node tests/browser-smoke.cjs.
   Uses a temporary browser profile and a local 60-second silent media fixture only. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const extensionRoot = process.env.SKIPPER_EXTENSION_PATH || root;
const artifactDir = process.env.SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'skipper-browser-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skipper-profile-'));
const wav = Buffer.alloc(44 + 8000 * 60 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const server = http.createServer((req, res) => {
    if (req.url === '/media.wav') {
        const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
        if (range) {
            const start = Number(range[1]), end = Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1);
            res.writeHead(206, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}`, 'Content-Length': end - start + 1 });
            res.end(wav.subarray(start, end + 1));
        } else { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': wav.length }); res.end(wav); }
        return;
    }
    const embedded = req.url.startsWith('/embedded');
    const frame = req.url.startsWith('/frame');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${frame ? '播放器' : '测试番剧 第1集'}</title></head><body>
        ${embedded ? '<iframe src="/frame" width="800" height="450"></iframe>' : '<video id="video" controls muted preload="auto" src="/media.wav" style="width:800px;height:450px"></video>'}
        ${frame ? '' : '<button class="next" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">下一集</button>'}
    </body></html>`);
});
async function until(read, predicate, description, timeout = 8000) {
    const start = Date.now();
    let value;
    while (Date.now() - start < timeout) {
        value = await read(); if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${description}: ${JSON.stringify(value)}`);
}
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const errors = [], passed = [];
    const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
            args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`, '--autoplay-policy=no-user-gesture-required'] });
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const id = worker.url().split('/')[2];
        const get = () => worker.evaluate(() => chrome.storage.local.get(null));
        const set = data => worker.evaluate(data => chrome.storage.local.set(data), data);
        const item = { series: '测试番剧', episode: '第1集', site: 'Web', folder: '默认收藏', url: `${base}/watch`, time: 10, duration: 60, timestamp: 1,
            autoSkipEnabled: true, introTime: 3, outroTime: 2, minDuration: 1, enableIntro: false, enableOutro: false, autoRestart: false, autoPlayNext: false };
        await set({ favorites: { '测试番剧': item }, favFolders: ['默认收藏'], whitelistMode: true, autoUpdateFav: true, showWhitelistNotice: true });
        const page = await context.newPage(); await page.goto(`${base}/watch`);
        await page.waitForSelector('#bili-skipper-notice'); await page.locator('#bili-notice-gotit').click();
        await page.waitForFunction(() => document.querySelector('video').readyState > 0);
        await page.evaluate(() => {
            window.mediaTrace = [];
            const v = document.querySelector('video');
            for (const name of ['timeupdate', 'seeking', 'seeked', 'pause', 'loadedmetadata', 'durationchange']) {
                v.addEventListener(name, () => window.mediaTrace.push({ name, time: v.currentTime, seeking: v.seeking, at: Date.now() }));
            }
        });
        await page.evaluate(() => document.querySelector('video').play());
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 10, null, { timeout: 5000 });
        await page.evaluate(() => document.querySelector('video').pause());
        await until(get, data => data.favorites['测试番剧'].time >= 10, 'resume progress save').catch(async error => {
            console.error('MEDIA TRACE', await page.evaluate(() => window.mediaTrace));
            console.error('MEDIA CURRENT', await page.evaluate(() => ({ time: document.querySelector('video').currentTime, title: document.title })));
            throw error;
        });
        pass('Real media resume and initial notice');

        const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
        popup.on('dialog', dialog => dialog.accept());
        await page.bringToFront(); await popup.reload();
        await until(() => popup.locator('#introTime').inputValue(), v => v === '3', 'popup should read active favorite');
        await popup.locator('label:has(#enableIntro)').click();
        await until(get, data => data.favorites['测试番剧'].enableIntro === true, 'favorite switch on');
        await popup.locator('label:has(#enableIntro)').click();
        await until(get, data => data.favorites['测试番剧'].enableIntro === false, 'favorite switch off');
        pass('Popup writes actual per-favorite settings');

        let state = await get(); state.favorites['测试番剧'].time = 0; await set({ favorites: state.favorites });
        await page.reload(); await page.waitForFunction(() => document.querySelector('video').readyState > 0);
        await page.evaluate(() => document.querySelector('video').play());
        await page.waitForFunction(() => document.querySelector('video').currentTime > 1.2);
        assert.ok(await page.evaluate(() => document.querySelector('video').currentTime < 2.5));
        await page.bringToFront(); await popup.locator('label:has(#enableIntro)').click();
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 3);
        await page.evaluate(() => document.querySelector('video').pause());
        pass('Disabled intro stays disabled; enabling skips real media');

        const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html#favorites`);
        options.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? '改名后的测试番剧' : undefined));
        await options.locator('.btn-edit-fav').first().click();
        await until(get, data => !!data.favorites['改名后的测试番剧'], 'rename');
        await page.bringToFront(); await popup.reload();
        assert.equal(await popup.locator('.fav-series').first().textContent(), '改名后的测试番剧');
        await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 15; return v.play(); });
        await until(get, data => data.favorites['改名后的测试番剧'].time >= 15, 'renamed progress update').catch(async error => {
            console.error('RENAME MEDIA', await page.evaluate(() => { const v = document.querySelector('video'); return { time: v.currentTime, seeking: v.seeking, paused: v.paused, readyState: v.readyState, duration: v.duration }; }));
            throw error;
        });
        await page.evaluate(() => document.querySelector('video').pause());
        pass('Rename retains live matching and progress');

        const downloadEvent = options.waitForEvent('download'); await options.locator('#btnExportFavs').click();
        const download = await downloadEvent; const backupPath = path.join(artifactDir, 'browser-backup.json'); await download.saveAs(backupPath);
        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')); assert.ok(backup.favorites['改名后的测试番剧']);
        await set({ favorites: {} }); await popup.locator('#importInput').setInputFiles(backupPath);
        await until(get, data => !!data.favorites['改名后的测试番剧'], 'cross-view import');
        pass('Options export restores through popup import');

        state = await get(); const saved = state.favorites['改名后的测试番剧'];
        saved.url = `${base}/embedded`; saved.time = 10; saved.enableIntro = false; saved.autoRestart = true; saved.enableOutro = false;
        await set({ favorites: state.favorites });
        await page.goto(`${base}/embedded`); const frame = page.frames().find(frame => frame.url().endsWith('/frame'));
        await frame.waitForFunction(() => document.querySelector('video').readyState > 0);
        await frame.evaluate(() => document.querySelector('video').play());
        await frame.waitForFunction(() => document.querySelector('video').currentTime >= 10);
        pass('Actual iframe receives parent identity and resumes');
        await frame.evaluate(() => { document.querySelector('video').currentTime = 59.8; });
        await frame.waitForFunction(() => { const v = document.querySelector('video'); return v.currentTime < 2 && !v.paused; });
        pass('Actual ended event restarts playback');
        state = await get(); state.favorites['改名后的测试番剧'].autoPlayNext = true; await set({ favorites: state.favorites });
        await until(() => get(), data => data.favorites['改名后的测试番剧'].autoPlayNext, 'next setting');
        await frame.evaluate(() => { document.querySelector('video').currentTime = 59.8; });
        await page.waitForFunction(() => document.querySelector('.next').dataset.clicks === '1');
        assert.ok(await frame.evaluate(() => document.querySelector('video').currentTime >= 59));
        pass('Iframe next button relay takes precedence over restart');

        await options.goto(`chrome-extension://${id}/options.html#settings`); await options.locator('#chkOnlySaveMaxEpisode').check();
        await until(get, data => data.onlySaveMaxEpisode === true, 'advanced autosave');
        pass('Advanced settings save immediately');
        await set({ favorites: { '测试番剧': { ...item, id: 'experience-test', episodeProgress: {
            [`${base}/watch`]: { url: `${base}/watch`, episode: '第1集', time: 10, duration: 60, timestamp: 1 },
            [`${base}/second`]: { url: `${base}/second`, episode: '第2集', time: 59, duration: 60, timestamp: 2 }
        } } }, onlySaveMaxEpisode: false });
        await page.goto(`${base}/watch`);
        await page.waitForFunction(() => document.querySelector('video').readyState > 0);
        await page.evaluate(() => document.querySelector('video').play());
        await page.waitForFunction(() => document.querySelector('video').currentTime >= 10);
        await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 20; });
        await page.bringToFront(); await popup.reload();
        await popup.locator('#setIntroHere').click();
        await until(get, data => data.favorites['测试番剧'].introTime === 20, 'quick intro');
        await popup.locator('#setOutroHere').click();
        await until(get, data => data.favorites['测试番剧'].outroTime === 40, 'quick outro');
        pass('Quick skip controls measure current playback position');
        await popup.locator('.fav-item').hover(); await popup.locator('.btn-pin').click();
        await until(get, data => data.favorites['测试番剧'].pinned === true, 'pin favorite');
        await popup.locator('#sortMode').selectOption('name');
        await until(get, data => data.favoriteSortMode === 'name', 'sort preference');
        pass('Pin and sort preferences persist');
        await popup.locator('.fav-item').hover(); await popup.locator('.btn-episodes').click();
        await popup.getByRole('button', { name: /第2集 · 已看完/ }).waitFor();
        const openedPromise = context.waitForEvent('page');
        await popup.getByRole('button', { name: /第2集 · 已看完/ }).click();
        const selected = await openedPromise; await selected.waitForLoadState(); assert.ok(selected.url().includes('/second')); await selected.close();
        pass('Inline episode status and direct navigation work');
        await page.bringToFront(); await popup.locator('#copyDiagnostics').click();
        await until(() => popup.locator('#diagnosticText').inputValue(), text => text.includes(JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8')).version) && text.includes('saveStatus'), 'diagnostic text');
        pass('Diagnostic report is available for copy or manual fallback');
        await set({ favFolders: ['默认收藏', '日漫'] });
        await page.bringToFront(); await popup.reload();
        await popup.locator('#folderSelect').selectOption('__ALL__');
        await popup.locator('.btn-watched').click();
        await until(get, data => Object.values(data.favorites['测试番剧'].watchMarks || {}).includes(true), 'mark watched');
        await popup.locator('.btn-watched').click();
        await until(get, data => Object.values(data.favorites['测试番剧'].watchMarks || {}).includes(false), 'mark unwatched');
        await popup.locator('.quick-folder').selectOption('日漫');
        await until(get, data => data.favorites['测试番剧'].folder === '日漫', 'quick move folder');
        pass('Watched toggle and immediate folder move work without opening a video');
        await popup.locator('.btn-series-complete').click();
        await until(get, data => data.favorites['测试番剧'].seriesCompleted === true, 'whole series complete');
        await until(() => popup.locator('.fav-item').count(), count => count === 0, 'completed series hidden');
        await popup.locator('#showCompleted').check();
        await popup.locator('.btn-series-complete').waitFor();
        await popup.locator('.btn-series-complete').click();
        await until(get, data => data.favorites['测试番剧'].seriesCompleted === false, 'undo series complete');
        await popup.locator('#showCompleted').uncheck();
        await popup.locator('.fav-item').waitFor();
        pass('Whole series completion hides, reveals and restores without deleting data');
        const managerState = await get(); managerState.favorites['测试番剧'].collectionId = 'test-collection';
        await set({ favorites: managerState.favorites });
        await options.goto(`chrome-extension://${id}/options.html#favorites`);
        await options.locator('.btn-details-fav').click();
        await options.locator('.favorite-editor > .settings-form .setting-introTime').fill('17');
        await options.locator('.favorite-editor > .settings-form .btn-save-settings').click();
        await until(get, data => data.favorites['测试番剧'].introTime === 17, 'options favorite settings');
        await options.locator('.episode-row').first().locator('.btn-episode-settings').click();
        await options.locator('.episode-settings .setting-introTime').fill('7');
        await options.locator('.episode-settings .btn-save-settings').click();
        await until(get, data => Object.values(data.favorites['测试番剧'].episodeSettings || {}).some(p => p.introTime === 7), 'options episode settings');
        await options.locator('.episode-row').first().locator('.btn-episode-settings').click();
        await options.locator('.btn-reset-episode').click();
        await until(get, data => Object.keys(data.favorites['测试番剧'].episodeSettings || {}).length === 0, 'reset options episode settings');
        await options.locator('.episode-edit-time').first().fill('23');
        await options.locator('.btn-save-progress').first().click();
        await until(get, data => data.favorites['测试番剧'].time === 23, 'options progress edit');
        pass('Options manager edits favorite settings, episode overrides and playback progress');
        await options.locator('.quick-folder-fav').selectOption('默认收藏');
        await until(get, data => data.favorites['测试番剧'].folder === '默认收藏', 'options quick folder');
        await options.locator('.btn-complete-fav').click();
        await until(() => options.locator('.favorite-card').count(), n => n === 0, 'options hide complete');
        await options.locator('#favoritesStatusFilter').selectOption('completed');
        await options.locator('.btn-complete-fav').click();
        await options.locator('#favoritesStatusFilter').selectOption('all');
        await options.locator('.favorite-card').waitFor();
        await options.locator('.btn-details-fav').click();
        pass('Options manager moves folders and restores completed favorites');
        await options.goto(`chrome-extension://${id}/options.html#settings`);
        assert.equal(await options.locator('#browserSyncEnabled').isChecked(), false);
        await options.locator('#browserSyncEnabled').check();
        await until(get, data => data.browserSyncEnabled && data.browserSyncStatus?.checkedAt, 'browser sync checked');
        const syncState = await worker.evaluate(() => chrome.storage.sync.get(null));
        const syncKey = Object.keys(syncState).find(key => syncState[key].fields?.series?.[2] === '测试番剧');
        assert.ok(syncKey, 'favorite in browser sync storage');
        assert.equal(syncState[syncKey].fields.progress[2].time, 23);
        assert.equal(syncState[syncKey].fields.episodeProgress, undefined);
        await worker.evaluate(async key => {
            const value = (await chrome.storage.sync.get(key))[key];
            value.fields.seriesCompleted = [Date.now() + 100, 'other-device', true];
            await chrome.storage.sync.set({ [key]: value });
        }, syncKey);
        await until(get, data => data.favorites['测试番剧'].seriesCompleted === true, 'browser sync change');
        await options.locator('#browserSyncEnabled').uncheck();
        await until(get, data => data.browserSyncEnabled === false, 'browser sync disabled');
        pass('Browser account sync is opt-in and applies a change received through real sync storage');
        const labels = ['01','02','03','04','05','07','08','09','10','11','12','13'];
        await context.route('https://www.bilibili.com/video/BV1f3RcBKENW/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>10_哔哩哔哩_bilibili</title><h1>沃德朴一家（第一季/英配）</h1><div class="video-pod"><div class="video-pod__header"><a href="https://space.bilibili.com/352610954/channel/collectiondetail?sid=6048304">美漫</a></div><div class="multi-p"><div class="simple-base-item active head"><div class="title" title="沃德朴一家（第一季/英配）">沃德朴一家（第一季/英配）</div></div><div class="page-list">${labels.map((label, i) => `<div class="simple-base-item page-item ${i === 8 ? 'active' : ''}"><div class="title" title="${label}" onclick="document.body.dataset.selected='${i + 1}'">${label}</div></div>`).join('')}</div></div></div>` }));
        const parts = await context.newPage(); await parts.goto('https://www.bilibili.com/video/BV1f3RcBKENW/?p=9');
        const readParts = action => worker.evaluate(async action => {
            const tab = (await chrome.tabs.query({})).find(t => t.url.includes('BV1f3RcBKENW'));
            return chrome.tabs.sendMessage(tab.id, { action }, { frameId: 0 });
        }, action);
        const partInfo = await until(() => readParts('getNiceTitle').catch(() => null), info => !!info?.collectionId, 'multipart identification');
        assert.equal(partInfo.series, '沃德朴一家（第一季/英配）'); assert.equal(partInfo.episode, '第10集');
        assert.equal(partInfo.collectionId, 'bilibili:video:BV1f3RcBKENW');
        await parts.evaluate(() => {
            document.querySelectorAll('.page-item').forEach((el, index) => el.addEventListener('click', () => { document.body.dataset.selected = String(index + 1); }));
        });
        assert.equal((await readParts('clickNext')).clicked, true);
        assert.equal(await parts.locator('body').getAttribute('data-selected'), '10');
        pass('Bilibili multipart DOM identifies actual episode and confines next to current BV');
        await popup.screenshot({ path: path.join(artifactDir, 'popup.png'), fullPage: true });
        await options.screenshot({ path: path.join(artifactDir, 'options.png'), fullPage: true });
        const recoveryPopup = await context.newPage();
        await recoveryPopup.addInitScript(() => {
            const send = chrome.tabs.sendMessage.bind(chrome.tabs);
            chrome.tabs.sendMessage = (...args) => {
                if (args[1]?.action === 'getNiceTitle') { args.at(-1)({ scriptVersion: 'old-test-version', contextActive: false }); return; }
                return send(...args);
            };
        });
        await recoveryPopup.goto(`chrome-extension://${id}/popup.html`);
        await page.bringToFront(); await recoveryPopup.reload();
        await recoveryPopup.locator('#pageRefreshNotice').waitFor({ state: 'visible' });
        const refreshed = page.waitForEvent('domcontentloaded');
        await recoveryPopup.locator('#reloadVideoPage').click(); await refreshed;
        const recovered = await until(() => worker.evaluate(async url => {
            const tab = (await chrome.tabs.query({})).find(t => t.url === url);
            return tab ? chrome.tabs.sendMessage(tab.id, { action: 'getNiceTitle' }, { frameId: 0 }).catch(() => null) : null;
        }, `${base}/watch`), info => info?.contextActive === true, 'fresh page script handshake');
        assert.equal(recovered.scriptVersion, JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8')).version);
        await recoveryPopup.close();
        pass('Stale-version warning button refreshes video page and current handshake succeeds');
        await page.bringToFront();
        await worker.evaluate(() => chrome.runtime.reload()).catch(error => {
            if (!/closed|destroyed|Target|worker/i.test(error.message)) throw error;
        });
        await page.evaluate(() => {
            const v = document.querySelector('video');
            v.dispatchEvent(new Event('timeupdate')); v.dispatchEvent(new Event('pause')); v.dispatchEvent(new Event('ended'));
        });
        await page.waitForFunction(() => document.querySelector('#skipper-refresh-notice')?.textContent.includes('刷新'));
        pass('Actual extension reload leaves old video page without uncaught context errors');

        assert.deepEqual(errors, []);
        const result = { passed, pageErrors: errors, browser: context.browser()?.version(), profile, artifactDir };
        fs.writeFileSync(path.join(artifactDir, 'browser-results.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await context?.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
