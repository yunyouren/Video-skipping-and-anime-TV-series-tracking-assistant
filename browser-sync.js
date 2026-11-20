// A register keeps a value and its revision. Progress, organization and marks
// merge independently so playback on one device cannot undo edits on another.
const BrowserSync = (() => {
    const prefix = 'skipper:v1:';
    const foldersKey = `${prefix}folders`;
    const empty = { version: 1, fields: {} };
    const progressFields = ['url', 'episode', 'time', 'duration', 'timestamp'];
    const metadata = ['series', 'site', 'folder', 'collectionId', 'collectionUrl', 'aliases', 'seriesCompleted', 'pinned', 'pinnedAt',
        'introTime', 'outroTime', 'minDuration', 'autoSkipEnabled', 'enableIntro', 'enableOutro', 'autoPlayNext', 'autoRestart'];
    const own = (obj, key) => Object.hasOwn(obj, key);
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const favoriteKey = key => typeof key === 'string' && /^skipper:v1:[a-f0-9]{32}$/.test(key);
    const stamp = (value, time, device) => [time, device, value];

    function newer(a, b) {
        if (!a) return b;
        if (!b) return a;
        if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
        if (a[1] !== b[1]) return a[1] > b[1] ? a : b;
        return JSON.stringify(a[2]) >= JSON.stringify(b[2]) ? a : b;
    }

    async function keyFor(item) {
        if (favoriteKey(item.browserSyncKey)) return item.browserSyncKey;
        const name = item.aliases?.[0] || item.series;
        const identity = item.collectionId ? ['collection', item.collectionId] : ['title', new URL(item.url).hostname, name];
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
        return prefix + Array.from(new Uint8Array(hash).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function project(item) {
        const fields = {};
        for (const key of metadata) if (item[key] !== undefined) fields[key] = item[key];
        const progress = Object.fromEntries(progressFields.map(key => [key, item[key]]));
        progress.url = SkipperCore.canonicalUrl(item.url);
        progress.episode ??= '';
        progress.time ??= 0;
        progress.duration ??= 0;
        progress.timestamp ??= 0;
        fields.progress = progress;
        for (const [key, value] of Object.entries(item.watchMarks || {})) fields[`mark:${key}`] = value;
        return fields;
    }

    async function stage(before, after, saved) {
        const device = saved?.device || crypto.randomUUID();
        const clock = Math.max(Date.now(), (saved?.clock || 0) + 1);
        const records = { ...saved?.records };
        const favorites = { ...after.favorites };
        const previous = new Map();
        const seen = new Set();

        if (saved) {
            for (const item of Object.values(before.favorites)) {
                if (favoriteKey(item?.browserSyncKey)) previous.set(item.browserSyncKey, item);
            }
        }
        for (const [name, item] of Object.entries(favorites)) {
            if (!SkipperCore.validUrl(item?.url)) continue;
            const key = await keyFor(item);
            seen.add(key);
            if (item.browserSyncKey !== key) favorites[name] = { ...item, browserSyncKey: key };
            const oldItem = previous.get(key);
            if (oldItem === item && records[key]) continue;
            const old = records[key] || empty;
            const existed = old.fields.present?.[2] === true;
            const fields = existed ? { ...old.fields } : {};
            const current = project(item);
            const prior = oldItem ? project(oldItem) : {};
            if (!existed || !oldItem) fields.present = stamp(true, saved ? clock : 0, device);
            for (const field of new Set([...Object.keys(current), ...Object.keys(prior)])) {
                if (existed && equal(current[field], prior[field])) continue;
                const value = current[field] ?? null;
                const time = field === 'progress' ? current.progress.timestamp : saved ? clock : 0;
                fields[field] = stamp(value, time, device);
            }
            records[key] = { version: 1, fields };
        }
        // Deletions are explicit. A stale playback update cannot bring a favorite back.
        for (const key of previous.keys()) {
            if (!seen.has(key)) records[key] = { version: 1, fields: { present: stamp(false, clock, device) } };
        }

        const oldFolders = new Set(saved ? before.favFolders : []);
        const currentFolders = new Set(after.favFolders);
        const folders = { ...records[foldersKey]?.fields };
        for (const name of new Set([...oldFolders, ...currentFolders])) {
            if (oldFolders.has(name) !== currentFolders.has(name)) {
                folders[`folder:${name}`] = stamp(currentFolders.has(name), saved ? clock : 0, device);
            }
        }
        records[foldersKey] = { version: 1, fields: folders };
        return { favorites, favFolders: after.favFolders, browserSyncJournal: { device, clock, records } };
    }

    function merge(local = empty, remote = empty) {
        const fields = { ...local.fields };
        if (remote?.version === 1 && remote.fields && typeof remote.fields === 'object') {
            for (const [key, value] of Object.entries(remote.fields)) {
                if (!Array.isArray(value) || value.length !== 3 || !Number.isFinite(value[0]) || typeof value[1] !== 'string') continue;
                if (!/^(present|progress|mark:.+|folder:.+)$/.test(key) && !metadata.includes(key)) continue;
                fields[key] = newer(own(fields, key) ? fields[key] : undefined, value);
            }
        }
        if (fields.present?.[2] === false) return { version: 1, fields: { present: fields.present } };
        return { version: 1, fields };
    }

    function restore(favorites, folders, records, onlySaveMaxEpisode) {
        const result = { ...favorites };
        const byKey = new Map(Object.entries(favorites).map(([name, item]) => [item?.browserSyncKey, name]));
        const knownFolders = new Set(['默认收藏', ...folders]);
        for (const [key, revision] of Object.entries(records[foldersKey]?.fields || {})) {
            if (!key.startsWith('folder:')) continue;
            const name = key.slice(7);
            if (revision[2] === true) knownFolders.add(name);
            if (revision[2] === false && name !== '默认收藏') knownFolders.delete(name);
        }
        for (const [key, { fields }] of Object.entries(records)) {
            if (!favoriteKey(key)) continue;
            const oldName = byKey.get(key);
            const current = oldName === undefined ? null : favorites[oldName];
            if (fields.present?.[2] === false) {
                if (oldName !== undefined) delete result[oldName];
                continue;
            }
            const series = fields.series?.[2];
            const progress = fields.progress?.[2];
            if (fields.present?.[2] !== true || typeof series !== 'string' || !SkipperCore.validUrl(progress?.url)) continue;

            const item = { ...current, browserSyncKey: key, id: current?.id || crypto.randomUUID() };
            for (const field of metadata) {
                if (!own(fields, field)) continue;
                if (fields[field][2] === null) delete item[field]; else item[field] = fields[field][2];
            }
            const marks = { ...current?.watchMarks };
            for (const [field, revision] of Object.entries(fields)) {
                if (!field.startsWith('mark:')) continue;
                if (revision[2] === null) delete marks[field.slice(5)]; else marks[field.slice(5)] = revision[2];
            }
            if (current?.watchMarks || Object.keys(marks).length) item.watchMarks = marks;
            const oldEpisode = SkipperCore.episodeNumber(current?.episode);
            const newEpisode = SkipperCore.episodeNumber(progress.episode);
            const keepHighest = onlySaveMaxEpisode && oldEpisode !== null && newEpisode !== null && oldEpisode > newEpisode;
            const previousProgress = current ? project(current).progress : null;
            if (!current || !keepHighest && progress.timestamp >= previousProgress.timestamp && !equal(progress, previousProgress)) {
                for (const field of progressFields) item[field] = progress[field];
                const urlKey = SkipperCore.canonicalUrl(progress.url);
                if (previousProgress) {
                    const history = { ...current.episodeProgress };
                    if (previousProgress.url !== urlKey && !history[previousProgress.url]) history[previousProgress.url] = previousProgress;
                    if (history[urlKey] && history[urlKey].timestamp <= progress.timestamp) history[urlKey] = progress;
                    if (Object.keys(history).length) item.episodeProgress = history;
                }
            }
            let name = item.series;
            if (records[foldersKey]?.fields[`folder:${item.folder}`]?.[2] === false) item.folder = '默认收藏';
            // Distinguish different works with the same display name.
            if (name !== oldName && own(result, name)) name = `${name} [${key.slice(-8)}]`;
            try {
                const validated = SkipperCore.parseBackup({ favorites: { [name]: item } }).favorites[name];
                if (!validated) continue;
                if (oldName !== undefined && oldName !== name) delete result[oldName];
                result[name] = validated;
                if (records[foldersKey]?.fields[`folder:${validated.folder}`]?.[2] !== false) knownFolders.add(validated.folder);
            } catch { /* Keep the existing local record if a synced record is invalid. */ }
        }
        return { favorites: result, favFolders: [...knownFolders] };
    }

    function reconcile(state, remote) {
        const journal = state.browserSyncJournal;
        const records = {};
        const changes = {};
        let clock = journal.clock;
        for (const key of new Set([...Object.keys(journal.records), ...Object.keys(remote)])) {
            if (!favoriteKey(key) && key !== foldersKey) continue;
            const combined = merge(journal.records[key], remote[key]);
            records[key] = combined;
            for (const revision of Object.values(combined.fields)) clock = Math.max(clock, revision[0]);
            const incoming = remote[key];
            if (incoming?.version !== 1 || !incoming.fields || Object.keys(incoming.fields).length !== Object.keys(combined.fields).length
                || Object.entries(combined.fields).some(([field, value]) => !equal(value, incoming.fields[field]))) changes[key] = combined;
        }
        return { ...restore(state.favorites, state.favFolders, records, state.onlySaveMaxEpisode),
            browserSyncJournal: { ...journal, clock, records }, changes };
    }

    return { prefix, stage, reconcile };
})();
