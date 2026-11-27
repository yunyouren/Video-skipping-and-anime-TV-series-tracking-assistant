/* Shared data rules: no page access or network requests. */
(function (root) {
    'use strict';
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const defaultFolders = ['默认收藏', '国漫', '日漫', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    const safeKey = k => typeof k === 'string' && k.trim() && !['__proto__', 'prototype', 'constructor'].includes(k);
    const seconds = x => Math.max(0, Number.isFinite(Number(x)) ? Number(x) : 0);
    const escapeHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function validUrl(value) {
        try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
    }
    function canonicalUrl(value) {
        try { const u = new URL(value); u.searchParams.delete('t'); u.searchParams.delete('start'); if (/(^|\.)bilibili\.com$/.test(u.hostname)) { for (const k of ['spm_id_from', 'vd_source']) u.searchParams.delete(k); if (u.searchParams.get('p') === '1') u.searchParams.delete('p'); u.pathname = u.pathname.replace(/\/$/, ''); } if (/^#t=/.test(u.hash)) u.hash = ''; return u.href; } catch { return ''; }
    }
    function resumeUrl(value, time) {
        if (!validUrl(value)) return '';
        const u = new URL(value);
        if (/(^|\.)(bilibili\.com|youtube\.com|youtu\.be)$/.test(u.hostname)) u.searchParams.set('t', String(Math.floor(seconds(time))));
        return u.href;
    }
    function biliVideoId(value) {
        try { const u = new URL(value); return /(^|\.)bilibili\.com$/.test(u.hostname) ? /\/video\/(BV[a-zA-Z0-9]+)/.exec(u.pathname)?.[1] || null : null; } catch { return null; }
    }
    function episodeNumber(value) {
        const m = String(value || '').match(/^\s*第\s*(\d+)\s*期\s*$|第\s*(\d+)\s*[集话]|(?:Ep\.?|Vol\.?|P)\s*(\d+)|^\s*(\d+)(?:\s|$|[~～-])/i);
        return m ? Number(m[1] || m[2] || m[3] || m[4]) : null;
    }
    function episodeLabel(entry) {
        if ((entry.part && !/^\d+$/.test(entry.title)) || entry.number === null) return entry.title;
        const marker = entry.title.match(/第\s*\d+\s*[集话期]/)?.[0];
        return marker?.endsWith('期') ? marker : `第${entry.number}集`;
    }
    function sameEpisode(item, info, url) {
        if (!canonicalUrl(item.url) || canonicalUrl(item.url) !== canonicalUrl(url)) return false;
        const a = episodeNumber(item.episode), b = episodeNumber(info.episodeName);
        return a !== null && b !== null ? a === b : item.episode === info.episodeName;
    }
    function findFavorite(favorites, name, id, info) {
        const entries = Object.entries(favorites || {});
        if (id) return entries.find(([, item]) => object(item) && item.id === id) || null;
        if (info?.collectionId) return entries.find(([, item]) => item?.collectionId === info.collectionId)
            || entries.find(([, item]) => !item?.collectionId && (canonicalUrl(item?.url) === canonicalUrl(info.url)
                || info.collectionId.startsWith('bilibili:video:') && biliVideoId(item?.url) && biliVideoId(item.url) === biliVideoId(info.url))) || null;
        if (own(favorites || {}, name) && object(favorites[name])) return [name, favorites[name]];
        return entries.find(([, item]) => object(item) && Array.isArray(item.aliases) && item.aliases.includes(name)) || null;
    }
    function validateFavorite(item, key) {
        if (!safeKey(key) || !object(item) || !safeKey(item.series) || !validUrl(item.url)) throw new Error('备份中包含无效的收藏名称或网址');
        for (const field of ['time', 'duration', 'timestamp', 'lastOpenedAt', 'introTime', 'outroTime', 'minDuration']) {
            if (item[field] !== undefined && (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field] < 0)) throw new Error('备份中的时间字段无效');
        }
        for (const field of ['episode', 'site', 'folder', 'id', 'collectionId', 'collectionUrl']) if (item[field] !== undefined && typeof item[field] !== 'string') throw new Error('备份中的文字字段无效');
        for (const field of ['autoSkipEnabled', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext']) if (item[field] !== undefined && typeof item[field] !== 'boolean') throw new Error('备份中的开关字段无效');
        if (item.aliases !== undefined && (!Array.isArray(item.aliases) || !item.aliases.every(safeKey))) throw new Error('备份中的名称别名无效');
        if (item.pinned !== undefined && typeof item.pinned !== 'boolean') throw new Error('置顶设置无效');
        if (item.seriesCompleted !== undefined && typeof item.seriesCompleted !== 'boolean') throw new Error('全集已看标记无效');
        if (item.watchMarks !== undefined && (!object(item.watchMarks) || !Object.entries(item.watchMarks).every(([key, value]) => (validUrl(key) || /^episode:\d+$/.test(key)) && typeof value === 'boolean'))) throw new Error('已看标记无效');
        if (item.pinnedAt !== undefined && (!Number.isFinite(item.pinnedAt) || item.pinnedAt < 0)) throw new Error('置顶时间无效');
        if (item.catalog !== undefined && (!Array.isArray(item.catalog) || item.catalog.length > 2000 || !item.catalog.every(e => object(e) && typeof e.title === 'string' && Number.isInteger(e.number) && e.number >= 0 && (e.url === undefined || validUrl(e.url)) && (e.part === undefined || Number.isInteger(e.part) && e.part > 0)))) throw new Error('选集目录无效');
        if (item.episodeProgress !== undefined) {
            if (!object(item.episodeProgress)) throw new Error('单集进度无效');
            for (const [url, record] of Object.entries(item.episodeProgress)) {
                if (!validUrl(url) || !object(record) || !validUrl(record.url) || typeof record.episode !== 'string'
                    || !['time', 'duration', 'timestamp'].every(k => Number.isFinite(record[k]) && record[k] >= 0)) throw new Error('单集进度无效');
            }
        }
        if (item.episodeSettings !== undefined) {
            if (!object(item.episodeSettings)) throw new Error('单集设置无效');
            for (const [url, patch] of Object.entries(item.episodeSettings)) {
                if (!validUrl(url) || !object(patch)) throw new Error('单集设置无效');
                for (const [k, v] of Object.entries(patch)) {
                    if (['introTime', 'outroTime', 'minDuration'].includes(k)) { if (!Number.isFinite(v) || v < 0) throw new Error('单集时间无效'); }
                    else if (!['autoSkipEnabled', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext'].includes(k) || typeof v !== 'boolean') throw new Error('单集设置无效');
                }
            }
        }
        return { ...item, series: key, folder: item.folder || '默认收藏', aliases: [...new Set([key, item.series, ...(item.aliases || [])])] };
    }
    function parseBackup(data) {
        if (!object(data)) throw new Error('备份必须是 JSON 对象');
        const wrapped = object(data.favorites) && !validUrl(data.favorites.url);
        const raw = wrapped ? data.favorites : data;
        if (wrapped && data.folders !== undefined && (!Array.isArray(data.folders) || !data.folders.every(s => typeof s === 'string' && s.trim()))) throw new Error('备份中的文件夹列表无效');
        const favorites = {};
        for (const [key, item] of Object.entries(raw)) favorites[key] = validateFavorite(item, key);
        const folders = [...new Set([...(wrapped ? data.folders || [] : []), ...Object.values(favorites).map(x => x.folder)])];
        return { favorites, folders };
    }
    function makeBackup(favorites, folders) {
        return { format: 'video-skipper', version: '4.4', timestamp: Date.now(), dateStr: new Date().toLocaleString(), ...parseBackup({ favorites, folders }) };
    }
    function settings(config, item, url) {
        if (item && url && item.episodeSettings?.[canonicalUrl(url)]) item = { ...item, ...item.episodeSettings[canonicalUrl(url)] };
        const result = { ...config };
        if (item) {
            for (const k of ['introTime', 'outroTime', 'minDuration', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext']) if (item[k] !== undefined) result[k] = item[k];
            if (item.enableIntro === undefined && item.introTime !== undefined) result.enableIntro = config.enableIntro !== false && item.introTime > 0;
            if (item.enableOutro === undefined && item.outroTime !== undefined) result.enableOutro = config.enableOutro !== false && item.outroTime > 0;
        }
        result.enabled = config.whitelistMode ? !!item && item.autoSkipEnabled !== false : config.autoSkipEnable === true;
        return result;
    }
    function watchKey(url, number) { return validUrl(url) ? canonicalUrl(url) : Number.isInteger(number) && number >= 0 ? `episode:${number}` : null; }
    function watchState(item, record, entry = {}) {
        if (item.seriesCompleted === true) return '已看完';
        const mark = item.watchMarks?.[watchKey(entry.url || record?.url, entry.number)]
            ?? item.watchMarks?.[watchKey(null, entry.number ?? episodeNumber(record?.episode))];
        if (mark !== undefined) return mark ? '已看完' : '未看';
        return !record || !record.time ? '未看' : record.duration > 0 && (record.time / record.duration >= .95 || record.duration - record.time < 30) ? '已看完' : '看到一半';
    }
    function episodeEntries(item) {
        const records = Object.values(item.episodeProgress || {});
        if (!records.some(r => canonicalUrl(r.url) === canonicalUrl(item.url))) records.push(item);
        const catalog = item.catalog?.length ? [...item.catalog] : [];
        const matchedUrls = new Set();
        const entries = catalog.map(entry => {
            const matches = records.filter(r => entry.url ? canonicalUrl(r.url) === canonicalUrl(entry.url) : episodeNumber(r.episode) === entry.number);
            const record = matches.length === 1 ? matches[0] : null;
            if (record) matchedUrls.add(canonicalUrl(record.url));
            return { ...entry, record };
        });
        for (const record of records) if (!matchedUrls.has(canonicalUrl(record.url))) entries.push({ title: record.episode || '观看中', number: episodeNumber(record.episode), url: record.url, record });
        return entries.sort((a, b) => (a.part ?? a.number ?? 0) - (b.part ?? b.number ?? 0)).map(entry => {
            let url = entry.record?.url || entry.url;
            if (!url && item.collectionId && entry.number !== null) {
                const target = new URL(item.url); target.searchParams.delete('t'); target.searchParams.set('skipper_collection', item.collectionId); target.searchParams.set('skipper_episode', String(entry.number)); url = target.href;
            }
            return { ...entry, label: episodeLabel(entry),
                state: watchState(item, entry.record, entry), openUrl: url, markUrl: entry.url || entry.record?.url };
        });
    }
    function applyMutation(state, op) {
        const favorites = { ...(state.favorites || {}) };
        let folders = [...(state.favFolders || defaultFolders)];
        const found = findFavorite(favorites, op.key, op.id);
        const key = found?.[0], item = found?.[1];
        const addFolder = name => { if (name && !folders.includes(name)) folders.push(name); };
        switch (op.type) {
            case 'resetEpisodeSettings': {
                if (item && validUrl(op.url)) { const episodeSettings = { ...item.episodeSettings }; delete episodeSettings[canonicalUrl(op.url)]; favorites[key] = { ...item, episodeSettings }; }
                break;
            }
            case 'editProgress': {
                if (!item || !validUrl(op.url)) throw new Error('找不到该集记录');
                const urlKey = canonicalUrl(op.url), current = canonicalUrl(item.url) === urlKey;
                const record = item.episodeProgress?.[urlKey] || (current ? item : null);
                if (!record || record.duration <= 0) throw new Error('该集尚无可编辑的播放进度');
                if (op.expectedTimestamp !== record.timestamp) throw new Error('该集进度已更新，请刷新列表后重试；编辑前请暂停视频');
                if (!Number.isFinite(op.time) || op.time < 0 || op.time > record.duration) throw new Error('进度必须在0与视频总秒数之间');
                const updated = { url: record.url, episode: record.episode, time: Math.floor(op.time), duration: record.duration, timestamp: Date.now() };
                favorites[key] = { ...item, ...(current ? { time: updated.time, timestamp: updated.timestamp } : {}), episodeProgress: { ...item.episodeProgress, [urlKey]: updated } };
                break;
            }
            case 'completeSeries':
                if (item && typeof op.completed === 'boolean') favorites[key] = { ...item, seriesCompleted: op.completed };
                break;
            case 'watched': {
                const markKey = watchKey(op.url, op.number);
                if (item && markKey && typeof op.watched === 'boolean') favorites[key] = { ...item,
                    ...(op.watched === false ? { seriesCompleted: false } : {}), watchMarks: { ...item.watchMarks, [markKey]: op.watched } };
                break;
            }
            case 'pin':
                if (item) favorites[key] = { ...item, pinned: op.pinned === true, pinnedAt: op.pinned ? Date.now() : 0 };
                break;
            case 'catalog':
                if (item && item.collectionId === op.collectionId && Array.isArray(op.episodes)) {
                    const catalog = op.episodes.filter(e => object(e) && typeof e.title === 'string' && Number.isInteger(e.number) && e.number >= 0)
                        .slice(0, 2000).map(e => ({ number: e.number, title: e.title.slice(0, 500),
                            ...(Number.isInteger(e.part) && e.part > 0 && validUrl(e.url) ? { part: e.part, url: e.url } : {}) }));
                    if (catalog.length) favorites[key] = { ...item, catalog };
                }
                break;
            case 'add': {
                const incoming = validateFavorite(op.item, op.item?.series);
                const existing = findFavorite(favorites, incoming.series, null, incoming);
                if (existing) favorites[existing[0]] = { ...existing[1], folder: incoming.folder, ...(incoming.collectionId ? { collectionId: incoming.collectionId, collectionUrl: incoming.collectionUrl } : {}) };
                else {
                    if (favorites[incoming.series]) incoming.series += ` [${incoming.collectionId || Date.now()}]`;
                    incoming.id = root.crypto?.randomUUID?.() || `fav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    favorites[incoming.series] = incoming;
                }
                addFolder(incoming.folder); break;
            }
            case 'patch':
                if (item) {
                    const patch = {};
                    for (const k of ['introTime', 'outroTime', 'minDuration']) if (op.patch[k] !== undefined) patch[k] = seconds(op.patch[k]);
                    for (const k of ['autoSkipEnabled', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext']) if (typeof op.patch[k] === 'boolean') patch[k] = op.patch[k];
                    if (item.collectionId && validUrl(op.episodeUrl)) favorites[key] = { ...item,
                        episodeSettings: { ...item.episodeSettings, [canonicalUrl(op.episodeUrl)]: { ...item.episodeSettings?.[canonicalUrl(op.episodeUrl)], ...patch } } };
                    else favorites[key] = { ...item, ...patch };
                }
                break;
            case 'open':
                if (item) favorites[key] = { ...item, lastOpenedAt: Date.now() };
                break;
            case 'progress':
                if (item && validUrl(op.url) && Number.isFinite(op.time) && Number.isFinite(op.duration) && op.time >= 0 && op.duration > 0) {
                    const urlKey = canonicalUrl(op.url);
                    const history = { ...item.episodeProgress };
                    if (validUrl(item.url) && !history[canonicalUrl(item.url)]) history[canonicalUrl(item.url)] = { url: item.url, episode: item.episode || '', time: item.time || 0, duration: item.duration || 0, timestamp: item.timestamp || 0 };
                    const record = { url: op.url, episode: String(op.episode || ''), time: Math.floor(Math.min(op.time, op.duration)), duration: Math.floor(op.duration), timestamp: op.timestamp || Date.now() };
                    if (!history[urlKey] || history[urlKey].timestamp <= record.timestamp) history[urlKey] = record;
                    favorites[key] = { ...item, episodeProgress: history };
                    const oldEp = episodeNumber(item.episode), newEp = episodeNumber(op.episode);
                    if (state.onlySaveMaxEpisode && oldEp !== null && newEp !== null && newEp < oldEp) break;
                    if (op.timestamp && item.timestamp > op.timestamp) break;
                    favorites[key] = { ...favorites[key], episode: String(op.episode || ''), site: String(op.site || item.site || 'Web'), url: op.url,
                        ...(op.collectionId ? { collectionId: op.collectionId, collectionUrl: op.collectionUrl } : {}),
                        time: Math.floor(Math.min(op.time, op.duration)), duration: Math.floor(op.duration), timestamp: op.timestamp || Date.now() };
                }
                break;
            case 'delete': if (item) delete favorites[key]; break;
            case 'clear': for (const k of Object.keys(favorites)) delete favorites[k]; break;
            case 'move':
                if (item) { const folder = String(op.folder || '默认收藏'); favorites[key] = { ...item, folder }; addFolder(folder); }
                break;
            case 'rename':
                if (item) {
                    const name = String(op.name || '').trim();
                    if (!safeKey(name)) throw new Error('名称无效');
                    if (name === key) break;
                    const target = favorites[name];
                    const winner = target && (target.timestamp || 0) > (item.timestamp || 0) ? target : item;
                    favorites[name] = { ...winner, series: name, aliases: [...new Set([key, name, ...(item.aliases || []), ...(target?.aliases || [])])] };
                    delete favorites[key];
                }
                break;
            case 'addFolder': addFolder(String(op.folder || '').trim()); break;
            case 'deleteFolder':
                if (op.folder === '默认收藏') throw new Error('不能删除默认收藏夹');
                folders = folders.filter(f => f !== op.folder);
                for (const [k, value] of Object.entries(favorites)) if (value.folder === op.folder) favorites[k] = { ...value, folder: '默认收藏' };
                addFolder('默认收藏'); break;
            case 'import': {
                const data = parseBackup(op.data);
                for (const [k, value] of Object.entries(data.favorites)) if (!favorites[k] || (value.timestamp || 0) >= (favorites[k].timestamp || 0)) favorites[k] = value;
                for (const f of data.folders) addFolder(f);
                break;
            }
            default: throw new Error('未知收藏操作');
        }
        const ids = new Set();
        for (const [key, value] of Object.entries(favorites)) {
            if (!object(value)) continue;
            if (!value.id || ids.has(value.id)) {
                favorites[key] = { ...value, id: root.crypto?.randomUUID?.() || `fav-${Date.now()}-${Math.random().toString(36).slice(2)}` };
            }
            ids.add(favorites[key].id);
        }
        return { favorites, favFolders: folders };
    }
    let contextInvalidated = false;
    const invalidationHandlers = new Set();
    let scriptVersion = null;
    try { scriptVersion = chrome.runtime.getManifest().version; } catch {}
    const refreshMessage = '扩展已重新加载，请刷新视频页面后继续记录进度';
    function invalidateContext() {
        if (contextInvalidated) return;
        contextInvalidated = true;
        for (const handler of invalidationHandlers) handler();
    }
    function contextValid() {
        if (contextInvalidated) return false;
        try { if (typeof chrome !== 'undefined' && chrome.runtime?.id) return true; } catch {}
        invalidateContext();
        return false;
    }
    function onInvalidated(handler) { invalidationHandlers.add(handler); }
    function sendMessage(message, callback) {
        if (!contextValid()) { callback?.(null, refreshMessage); return; }
        try {
            chrome.runtime.sendMessage(message, response => {
                let error;
                try { error = chrome.runtime.lastError?.message; } catch (caught) { error = caught.message; }
                if (/context invalidated/i.test(error || '')) invalidateContext();
                callback?.(response, contextInvalidated ? refreshMessage : error || null);
            });
        } catch (error) {
            if (/context invalidated/i.test(error.message)) invalidateContext();
            callback?.(null, contextInvalidated ? refreshMessage : error.message);
        }
    }
    function mutate(op, callback) {
        sendMessage({ action: 'mutateFavorites', operation: op }, (response, transportError) => {
            const error = transportError || (!response?.ok && (response?.error || '保存失败，请重新加载扩展后重试'));
            callback?.(error ? null : response.data, error || null);
        });
    }
    root.SkipperCore = { defaultFolders, escapeHtml, validUrl, canonicalUrl, resumeUrl, episodeNumber, episodeLabel, sameEpisode, findFavorite, parseBackup, makeBackup, settings, watchKey, watchState, episodeEntries, applyMutation, mutate, contextValid, onInvalidated, sendMessage, scriptVersion };
})(globalThis);
