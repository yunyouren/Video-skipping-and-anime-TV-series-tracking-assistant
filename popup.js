// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + Right' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + Left' }
};

const defaultFolders = ["默认收藏", "国漫", "日漫", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

let tempKeyForward = null;
let tempKeyRewind = null;
let currentFavorites = {};
let currentFolders = [];
let targetMoveSeries = null;
let visibleCount = 20;
let popupConfig = {};
let currentPageInfo = null;
let sortMode = 'recent';
let showCompleted = false;
let stableOrder = new Map();
const expandedEpisodes = new Set();
const PAGE_SIZE = 20;

document.addEventListener('DOMContentLoaded', () => {
    SkipperCore.sendMessage({ action: 'syncBrowserData' });
    document.getElementById('reloadVideoPage').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs.length) return;
            chrome.tabs.reload(tabs[0].id, {}, () => {
                if (chrome.runtime.lastError) showFloatingToast('刷新失败，请手动刷新视频页');
                else window.close?.();
            });
        });
    });
    chrome.storage.local.get({ favoriteSortMode: 'recent', showCompletedFavorites: false }, data => {
        showCompleted = data.showCompletedFavorites === true;
        document.getElementById('showCompleted').checked = showCompleted;
        sortMode = data.favoriteSortMode === 'name' ? 'name' : 'recent';
        document.getElementById('sortMode').value = sortMode;
        stableOrder.clear(); renderFavoritesList();
    });
    document.getElementById('sortMode').addEventListener('change', e => {
        sortMode = e.target.value; stableOrder.clear();
        chrome.storage.local.set({ favoriteSortMode: sortMode }); renderFavoritesList();
    });
    document.getElementById('refreshOrder').addEventListener('click', () => { stableOrder.clear(); renderFavoritesList(); });
    document.getElementById('showCompleted').addEventListener('change', e => {
        showCompleted = e.target.checked; visibleCount = PAGE_SIZE; stableOrder.clear();
        chrome.storage.local.set({ showCompletedFavorites: showCompleted }); renderFavoritesList();
    });
    for (const [id, isIntro] of [['setIntroHere', true], ['setOutroHere', false]]) {
        document.getElementById(id).addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (!tabs.length) return;
                chrome.tabs.sendMessage(tabs[0].id, { action: 'getRequestVideoInfo' }, video => {
                    if (chrome.runtime.lastError || !video || !Number.isFinite(video.time) || !Number.isFinite(video.duration) || video.duration <= 0) { showFloatingToast('未检测到可用视频，请刷新页面后重试'); return; }
                    const seconds = Math.max(0, Math.floor(isIntro ? video.time : video.duration - video.time));
                    const patch = isIntro ? { introTime: seconds, enableIntro: true } : { outroTime: seconds, enableOutro: true };
                    chrome.tabs.sendMessage(tabs[0].id, { action: 'getNiceTitle' }, { frameId: 0 }, info => {
                        if (chrome.runtime.lastError || !info) { showFloatingToast('无法识别当前页面，请刷新后重试'); return; }
                        const item = currentFavorites[info.series];
                        const saved = () => {
                            document.getElementById(isIntro ? 'introTime' : 'outroTime').value = seconds;
                            document.getElementById(isIntro ? 'enableIntro' : 'enableOutro').checked = true;
                            showFloatingToast(isIntro ? `片头结束设为 ${seconds} 秒` : `片尾设为距结尾 ${seconds} 秒`);
                        };
                        if (document.getElementById('whitelistMode').checked) {
                            if (!item) { showFloatingToast('请先收藏当前视频，再设置跳过位置'); return; }
                            mutateFavorites({ type: 'patch', key: info.series, id: item.id, patch,
                                episodeUrl: info.collectionId && document.getElementById('episodeScope').checked ? info.url : undefined }, saved);
                        } else chrome.storage.local.set(patch, () => { if (chrome.runtime.lastError) showFloatingToast('设置保存失败'); else saved(); });
                    });
                });
            });
        });
    }
    document.getElementById('copyDiagnostics').addEventListener('click', () => {
        const publish = async report => {
            const output = JSON.stringify(report, null, 2);
            const box = document.getElementById('diagnosticText'); box.value = output; box.style.display = 'none';
            try { await navigator.clipboard.writeText(output); document.getElementById('diagnosticStatus').textContent = '诊断信息已复制，可粘贴反馈。'; }
            catch { box.style.display = 'block'; box.select?.(); document.getElementById('diagnosticStatus').textContent = '自动复制失败，请在下方手动复制。'; }
        };
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const base = { version: chrome.runtime.getManifest().version, generatedAt: new Date().toISOString(),
                favoriteCount: Object.keys(currentFavorites).length, sortMode };
            if (!tabs.length) { publish({ ...base, error: '没有活动标签页' }); return; }
            chrome.tabs.sendMessage(tabs[0].id, { action: 'diagnostics' }, { frameId: 0 }, report => {
                const error = chrome.runtime.lastError?.message;
                chrome.runtime.sendMessage({ action: 'getSaveStatus', tabId: tabs[0].id }, saveStatus => {
                    const backgroundError = chrome.runtime.lastError?.message;
                    publish({ ...base, ...(report || {}), ...(saveStatus ? { saveStatus } : {}),
                        ...(error || !report ? { error: error || '页面未响应，请刷新视频页' } : {}), ...(backgroundError ? { backgroundError } : {}) });
                });
            });
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        enableIntro: true,
        enableOutro: true,
        autoRestart: false,
        autoUpdateFav: true,

        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind,
        favorites: {},
        favFolders: defaultFolders,
        customTagRules: [],
        manualEnableSites: [],
        whitelistMode: true
    }, (items) => {
        try { setupTagSettings(items.customTagRules); } catch(e) { console.error("TagSettings Error:", e); }

        popupConfig = items;
        loadConfigToUI(items);
        currentFavorites = items.favorites;
        currentFolders = [...new Set([...items.favFolders, ...Object.values(items.favorites).filter(x => x && typeof x === 'object').map(x => x.folder || '默认收藏')])];

        document.getElementById('autoUpdateFav').checked = items.autoUpdateFav;
        document.getElementById('whitelistMode').checked = items.whitelistMode || false;

        renderFolderSelect();

        document.getElementById('currentSeriesHint').textContent = items.whitelistMode ? '未收藏时修改默认设置，收藏后生效' : '全局设置';
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "getNiceTitle" }, { frameId: 0 }, (titleResponse) => {
                const connectionError = chrome.runtime.lastError;
                const stale = connectionError || !titleResponse?.contextActive || titleResponse?.scriptVersion !== chrome.runtime.getManifest().version;
                document.getElementById('pageRefreshNotice').style.display = stale ? 'block' : 'none';
                document.getElementById('pageRefreshReason').textContent = connectionError || !titleResponse ? '页面尚未连接扩展，刷新后重试。' : stale ? '页面脚本已失效或版本较旧，刷新后恢复进度记录。' : '';
                if (connectionError) return;
                if (titleResponse && titleResponse.series) {
                    currentPageInfo = titleResponse;
                    document.getElementById('episodeScopeRow').style.display = titleResponse.collectionId ? 'block' : 'none';
                    const seriesName = titleResponse.series;
                    const favItem = currentFavorites[seriesName];
                    if (favItem && items.whitelistMode) {
                        document.getElementById('currentSeriesHint').textContent = `当前收藏：${seriesName}（独立设置）`;
                        if (favItem.folder && currentFolders.includes(favItem.folder)) {
                            document.getElementById('folderSelect').value = favItem.folder;
                            renderFavoritesList();
                        }
                        const effective = SkipperCore.settings(items, favItem);
                        loadConfigToUI({ ...items, ...effective, autoSkipEnable: favItem.autoSkipEnabled !== false });
                        updateStatusText(favItem.autoSkipEnabled !== false);
                    }

                }
            });
        });

        document.getElementById('folderSelect').addEventListener('change', () => {
            visibleCount = PAGE_SIZE;
            renderFavoritesList();
        });

        document.getElementById('newFolderBtn').addEventListener('click', () => {
            const name = prompt("请输入新收藏夹名称 (例如: 补番中):");
            if (name && !currentFolders.includes(name)) {
                currentFolders.push(name);
                mutateFavorites({ type: 'addFolder', folder: name }, () => renderFolderSelect(name));
            }
        });

        document.getElementById('delFolderBtn').addEventListener('click', () => {
             const select = document.getElementById('folderSelect');
             const folder = select.value;

             if (folder === "__ALL__") {
                 alert('无法删除"全部展示"视图。\n请切换到具体文件夹后再执行删除操作。');
                 return;
             }

             if (folder === "默认收藏") {
                 alert("无法删除默认收藏夹");
                 return;
             }
             if (confirm(`删除文件夹 "${folder}"？\n其中的番剧将移动到 "默认收藏"。`)) {
                  mutateFavorites({ type: 'deleteFolder', folder }, () => renderFolderSelect('默认收藏'));
             }
        });

        renderFavoritesList();
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;
        updateStatusText(items.autoSkipEnable);
    });

    document.getElementById('btnImport').addEventListener('click', () => {
        document.getElementById('importInput').click();
    });

    document.getElementById('importInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                handleImport(json);
            } catch (err) {
                alert("❌ 文件格式错误");
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    const exportModal = document.getElementById('exportModal');

    document.getElementById('btnOpenExportModal').addEventListener('click', () => {
        const listDiv = document.getElementById('exportFolderList');
        listDiv.innerHTML = '';

        const selectAllDiv = document.createElement('div');
        selectAllDiv.className = 'check-item';
        selectAllDiv.style.borderBottom = '1px dashed #eee';
        selectAllDiv.style.marginBottom = '5px';
        selectAllDiv.style.paddingBottom = '5px';
        selectAllDiv.innerHTML = `<label><input type="checkbox" id="checkAllFolders" checked> <strong>全选</strong></label>`;
        listDiv.appendChild(selectAllDiv);

        currentFolders.forEach(folder => {
            const div = document.createElement('div');
            div.className = 'check-item';
            div.innerHTML = `<label><input type="checkbox" class="folder-chk" value="${SkipperCore.escapeHtml(folder)}" checked> ${SkipperCore.escapeHtml(folder)}</label>`;
            listDiv.appendChild(div);
        });

        document.getElementById('checkAllFolders').addEventListener('change', (e) => {
            const checkboxes = listDiv.querySelectorAll('.folder-chk');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });

        exportModal.style.display = 'flex';
    });

    document.getElementById('btnCancelExport').addEventListener('click', () => {
        exportModal.style.display = 'none';
    });

    document.getElementById('btnConfirmExport').addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.folder-chk:checked');
        const selectedFolders = Array.from(checkboxes).map(cb => cb.value);

        if (selectedFolders.length === 0) {
            alert("请至少选择一个文件夹！");
            return;
        }

        const filteredFavorites = {};
        let count = 0;

        Object.values(currentFavorites).forEach(item => {
            const itemFolder = item.folder || "默认收藏";
            if (selectedFolders.includes(itemFolder)) {
                filteredFavorites[item.series] = item;
                count++;
            }
        });

        if (count === 0) {
            alert("选中的文件夹中没有番剧数据！");
            return;
        }

        let exportData;
        try { exportData = SkipperCore.makeBackup(filteredFavorites, selectedFolders); }
        catch (error) { showFloatingToast(error.message); return; }

        const date = new Date();
        const dateStr = date.getFullYear() +
                        (date.getMonth()+1).toString().padStart(2, '0') +
                        date.getDate().toString().padStart(2, '0');

        const safeFolderName = selectedFolders.length === 1 ? selectedFolders[0].replace(/[\\/:*?"<>|]/g, "_") : '';
        const nameSuffix = selectedFolders.length === 1 ? `-${safeFolderName}` : '';
        const filename = `skipper-backup${nameSuffix}-${dateStr}.json`;

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        exportModal.style.display = 'none';
        showFloatingToast(`✅ 已导出 ${count} 部番剧`);
    });

    let moveModal = document.getElementById('moveModal');
    let moveSelect = document.getElementById('moveTargetSelect');

    document.getElementById('btnCancelMove').addEventListener('click', () => {
        moveModal.style.display = 'none';
        targetMoveSeries = null;
    });

    document.getElementById('btnConfirmMove').addEventListener('click', () => {
        if (!targetMoveSeries || !currentFavorites[targetMoveSeries]) return;

        const newFolder = moveSelect.value;
        mutateFavorites({ type: 'move', key: targetMoveSeries, id: currentFavorites[targetMoveSeries].id, folder: newFolder }, () => {
            moveModal.style.display = 'none';
            targetMoveSeries = null;
            showFloatingToast(`✅ 已移动到 [${newFolder}]`);
        });
        document.getElementById('episodeScope').addEventListener('change', () => {
            const item = currentPageInfo && currentFavorites[currentPageInfo.series];
            if (!item) return;
            const effective = SkipperCore.settings(popupConfig, item, document.getElementById('episodeScope').checked ? currentPageInfo.url : undefined);
            loadConfigToUI({ ...popupConfig, ...effective, autoSkipEnable: effective.enabled });
        });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.favorites) currentFavorites = changes.favorites.newValue || {};
        if (changes.favFolders) { currentFolders = changes.favFolders.newValue || defaultFolders; renderFolderSelect(); }
        if (changes.favorites || changes.favFolders) renderFavoritesList();
    });
});

function handleImport(data) {
    let parsed;
    try { parsed = SkipperCore.parseBackup(data); }
    catch (error) { alert(`❌ ${error.message}`); return; }
    const count = Object.keys(parsed.favorites).length;
    if (!confirm(`导入 ${count} 部番剧？同名记录保留更新时间较新的进度。`)) return;
    mutateFavorites({ type: 'import', data }, () => showFloatingToast(`✅ 已导入 ${count} 条记录`));
}

document.getElementById('autoUpdateFav').addEventListener('change', (e) => { chrome.storage.local.set({ autoUpdateFav: e.target.checked }); });
document.getElementById('whitelistMode').addEventListener('change', (e) => {
    const isOn = e.target.checked;
    chrome.storage.local.set({ whitelistMode: isOn }, () => {
        if (chrome.runtime.lastError) { showFloatingToast(chrome.runtime.lastError.message); return; }
        chrome.storage.local.get(popupConfig, items => {
            popupConfig = items;
            loadConfigToUI(items);
            updateStatusText(items.autoSkipEnable);
            document.getElementById('currentSeriesHint').textContent = isOn ? '未收藏时修改默认设置，收藏后生效' : '全局设置';
            if (!isOn) return;
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (!tabs.length) return;
                chrome.tabs.sendMessage(tabs[0].id, { action: 'getNiceTitle' }, { frameId: 0 }, info => {
                    if (chrome.runtime.lastError || !info) return;
                    const item = currentFavorites[info.series];
                    if (!item) return;
                    loadConfigToUI({ ...items, ...SkipperCore.settings(items, item), autoSkipEnable: item.autoSkipEnabled !== false });
                    updateStatusText(item.autoSkipEnabled !== false);
                    document.getElementById('currentSeriesHint').textContent = `当前收藏：${info.series}（独立设置）`;
                });
            });
        });
        showFloatingToast(isOn ? '🎯 白名单模式已开启，仅对已收藏生效' : '🌐 已切换为全局模式');
    });
});

document.getElementById('addFavBtn').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "getNiceTitle" }, { frameId: 0 }, (titleResponse) => {
            if (chrome.runtime.lastError) { showFloatingToast("请刷新视频页面后重试"); return; }
            if (titleResponse?.pending) { showFloatingToast('分P列表正在加载，请稍后再收藏'); return; }
            chrome.tabs.sendMessage(tabs[0].id, { action: "getRequestVideoInfo" }, (videoResponse) => {
                if (chrome.runtime.lastError) { }
                if (!videoResponse) { showFloatingToast("❌ 失败：未检测到视频"); return; }
                let finalData = videoResponse;
                if (titleResponse) {
                    if (titleResponse.series && titleResponse.series !== "樱花动漫") {
                        finalData.series = titleResponse.series;
                        if (finalData.episode === "观看中" && titleResponse.episode) finalData.episode = titleResponse.episode;
                    }
                    if (titleResponse.url) finalData.url = SkipperCore.resumeUrl(titleResponse.url, finalData.time);
                    finalData.aliases = [titleResponse.sourceSeries || titleResponse.series];
                    if (titleResponse.collectionId) {
                        finalData.collectionId = titleResponse.collectionId;
                        finalData.collectionUrl = titleResponse.collectionUrl;
                        finalData.episode = titleResponse.episode;
                    }
                    if (titleResponse.site) finalData.site = titleResponse.site;
                }

                const currentFolder = document.getElementById('folderSelect').value;
                let targetFolder = currentFolder;

                if (targetFolder === "__ALL__") {
                    targetFolder = "默认收藏";
                }

                finalData.folder = targetFolder;

                finalData.autoSkipEnabled = document.getElementById('autoSkipEnable').checked;

                finalData.introTime = parseInt(document.getElementById('introTime').value) || 0;
                finalData.outroTime = parseInt(document.getElementById('outroTime').value) || 0;
                finalData.minDuration = parseInt(document.getElementById('minDuration').value) || 0;

                for (const key of ['enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext']) {
                    finalData[key] = document.getElementById(key).checked;
                }
                if (finalData.collectionId && !SkipperCore.findFavorite(currentFavorites, finalData.series, null, finalData)) {
                    finalData.enableIntro = false;
                    finalData.enableOutro = false;
                }
                mutateFavorites({ type: 'add', item: finalData }, () => {
                    if (finalData.collectionId) {
                        const saved = SkipperCore.findFavorite(currentFavorites, finalData.series, null, finalData);
                        if (saved) {
                            currentPageInfo = { ...titleResponse, series: saved[0] };
                            document.getElementById('episodeScopeRow').style.display = 'block';
                            document.getElementById('episodeScope').checked = false;
                            document.getElementById('currentSeriesHint').textContent = `当前合集：${saved[0]}（默认设置）`;
                            const effective = SkipperCore.settings(popupConfig, saved[1]);
                            loadConfigToUI({ ...popupConfig, ...effective, autoSkipEnable: effective.enabled });
                        }
                    }
                    showFloatingToast(`✅ 已收藏到 [${targetFolder}]\n${finalData.series}`);
                });
            });
        });
    });
});

function showFloatingToast(msg) {
    let toast = document.getElementById('my-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'my-toast';
        toast.className = 'toast-popup';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2000);
}

function mutateFavorites(operation, onSaved) {
    SkipperCore.mutate(operation, (data, error) => {
        if (error) { renderFavoritesList(); showFloatingToast(`❌ ${error}`); return; }
        currentFavorites = data.favorites;
        stableOrder.clear();
        currentFolders = data.favFolders;
        renderFolderSelect();
        renderFavoritesList();
        onSaved?.();
    });
}
function renderFolderSelect(selectValue) {
    const select = document.getElementById('folderSelect');
    const oldVal = selectValue || select.value || "__ALL__";
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = "__ALL__";
    allOpt.innerText = "≡ 全部展示";
    select.appendChild(allOpt);

    currentFolders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.innerText = f;
        select.appendChild(opt);
    });

    select.value = oldVal;
    if (select.value !== oldVal) {
        select.value = "__ALL__";
    }
}

function renderFavoritesList() {
    const listDiv = document.getElementById('favList');
    const currentFolder = document.getElementById('folderSelect').value;
    document.getElementById('completedCount').textContent = '';

    if (!currentFavorites || Object.keys(currentFavorites).length === 0) {
        listDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#999; font-size:12px;">暂无收藏</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    let sortedItems = Object.values(currentFavorites).filter(item => item && typeof item.series === 'string' && SkipperCore.validUrl(item.url));

    if (currentFolder !== "__ALL__") {
        sortedItems = sortedItems.filter(item => {
            const itemFolder = item.folder || "默认收藏";
            return itemFolder === currentFolder;
        });
    }

    const completedCount = sortedItems.filter(item => item.seriesCompleted === true).length;
    document.getElementById('completedCount').textContent = completedCount ? `(${completedCount})` : '';
    if (!showCompleted) sortedItems = sortedItems.filter(item => item.seriesCompleted !== true);
    const recentTime = item => Math.max(item.timestamp || 0, item.lastOpenedAt || 0);
    sortedItems.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)
        || (a.pinned && b.pinned ? (a.pinnedAt || 0) - (b.pinnedAt || 0) : 0)
        || (sortMode === 'name' ? a.series.localeCompare(b.series, 'zh-CN')
            : stableOrder.size ? (stableOrder.get(a.id || a.series) ?? 100000) - (stableOrder.get(b.id || b.series) ?? 100000) : recentTime(b) - recentTime(a)));
    sortedItems.forEach((item, index) => { if (!stableOrder.has(item.id || item.series)) stableOrder.set(item.id || item.series, index); });

    if (sortedItems.length === 0) {
        const msg = completedCount && !showCompleted ? `已隐藏 ${completedCount} 部已看完收藏，勾选“已看”可找回` : currentFolder === "__ALL__" ? "暂无任何收藏" : `"${currentFolder}" 为空`;
        listDiv.innerHTML = `<div style="padding:15px; text-align:center; color:#999; font-size:12px;">${SkipperCore.escapeHtml(msg)}</div>`;
        return;
    }

    const totalItems = sortedItems.length;
    const itemsToShow = sortedItems.slice(0, visibleCount);

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    itemsToShow.forEach(item => {
        const div = document.createElement('div');
        div.className = 'fav-item';

        let folderBadge = '';
        if (currentFolder === "__ALL__") {
            folderBadge = `<span style="background:#f0f0f0; color:#888; padding:1px 4px; border-radius:3px; margin-right:4px; font-size:10px; border:1px solid #eee;">${SkipperCore.escapeHtml(item.folder || '默认')}</span>`;
        }

        div.innerHTML = `
            <div class="fav-series">${item.pinned ? '📌 ' : ''}${SkipperCore.escapeHtml(item.series)}</div>
            <div class="fav-episode">
                <span style="display:flex; align-items:center;">
                    ${folderBadge} <span class="fav-tag">${SkipperCore.escapeHtml(item.site)}</span>
                    <span style="max-width: 80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${SkipperCore.escapeHtml(item.episode)}</span>
                </span>
                <span class="fav-time">${formatTime(item.time)} / ${formatTime(item.duration)}</span>
            </div>
            <div class="fav-actions" style="position: absolute; right: 5px; top: 5px; display: none;">
                <button class="btn-pin">${item.pinned ? '取消置顶' : '置顶'}</button>
                ${item.collectionId || item.episodeProgress ? '<button class="btn-episodes" title="展开集数与进度">选集</button>' : ''}
                <button class="btn-del" title="删除" style="border:1px solid #ffcccc; background:#fff; color:red; cursor:pointer; font-size:10px;">×</button>
            </div>
            <div class="fav-quick fav-actions">
                <button class="btn-watched" title="切换最近记录这一集的已看状态">${SkipperCore.watchState(item, item) === '已看完' ? '✓ 本集' : '本集已看'}</button>
                <button class="btn-series-complete" title="标记整部作品已看完并隐藏，可从已看列表恢复">${item.seriesCompleted ? '取消全集已看' : '全集已看'}</button>
                <select class="quick-folder" aria-label="移动到文件夹" title="选择文件夹后立即移动"></select>
            </div>
        `;

        div.onmouseenter = () => {
            const actions = div.querySelector('.fav-actions');
            if(actions) actions.style.display = 'block';
        };
        div.onmouseleave = () => {
            const actions = div.querySelector('.fav-actions');
            if(actions) actions.style.display = 'none';
        };

        div.addEventListener('click', (e) => {
            if (e.target.closest('.fav-actions')) return;
            mutateFavorites({ type: 'open', key: item.series, id: item.id }, () => {
                chrome.tabs.create({ url: SkipperCore.resumeUrl(item.url, item.time) });
            });
        });

        div.querySelector('.btn-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`删除「${item.series}」？开启账号同步时，删除也会同步到其他电脑。`)) {
                mutateFavorites({ type: 'delete', key: item.series, id: item.id });
            }
        });
        div.querySelector('.btn-episodes')?.addEventListener('click', e => {
            e.stopPropagation();
            const key = item.id || item.series;
            if (expandedEpisodes.has(key)) expandedEpisodes.delete(key); else expandedEpisodes.add(key);
            renderFavoritesList();
        });
        div.querySelector('.btn-pin').addEventListener('click', e => {
            e.stopPropagation(); mutateFavorites({ type: 'pin', key: item.series, id: item.id, pinned: !item.pinned });
        });
        if (expandedEpisodes.has(item.id || item.series)) {
            const panel = document.createElement('div'); panel.className = 'episode-panel';
            panel.addEventListener('click', e => e.stopPropagation());
            const records = Object.values(item.episodeProgress || {});
            if (!records.some(r => SkipperCore.canonicalUrl(r.url) === SkipperCore.canonicalUrl(item.url))) records.push(item);
            const entries = item.catalog?.length ? item.catalog : records.map(r => ({ number: SkipperCore.episodeNumber(r.episode), title: r.episode, record: r }));
            [...entries].sort((a, b) => (a.part ?? a.number ?? 0) - (b.part ?? b.number ?? 0)).forEach(entry => {
                const matches = records.filter(r => entry.url ? SkipperCore.canonicalUrl(r.url) === SkipperCore.canonicalUrl(entry.url) : SkipperCore.episodeNumber(r.episode) === entry.number);
                const record = entry.record || (matches.length === 1 ? matches[0] : null);
                const state = SkipperCore.watchState(item, record, entry);
                const button = document.createElement('button');
                const label = SkipperCore.episodeLabel(entry);
                button.textContent = `${label} · ${state}${record?.time ? ` · ${formatTime(record.time)}` : ''}`;
                button.title = `${entry.title}${entry.part ? `（P${entry.part}）` : ''}`;
                button.addEventListener('click', e => {
                    e.stopPropagation();
                    let url = record?.url || entry.url;
                    if (!url && item.collectionId && entry.number !== null) { const target = new URL(item.url); target.searchParams.delete('t'); target.searchParams.set('skipper_collection', item.collectionId); target.searchParams.set('skipper_episode', String(entry.number)); url = target.href; }
                    if (SkipperCore.validUrl(url)) mutateFavorites({ type: 'open', key: item.series, id: item.id }, () => chrome.tabs.create({ url: SkipperCore.resumeUrl(url, state === '已看完' ? 0 : record?.time || 0) }));
                });
                const cell = document.createElement('div'); cell.className = 'episode-cell';
                const mark = document.createElement('button'); mark.className = 'episode-mark';
                mark.textContent = state === '已看完' ? '✓' : '○';
                mark.title = state === '已看完' ? '标记为未看' : '标记为已看';
                const markUrl = entry.url || record?.url;
                mark.disabled = !SkipperCore.watchKey(markUrl, entry.number);
                mark.addEventListener('click', e => {
                    e.stopPropagation();
                    mutateFavorites({ type: 'watched', key: item.series, id: item.id, url: markUrl,
                        number: entry.number, watched: state !== '已看完' });
                });
                cell.appendChild(button); cell.appendChild(mark); panel.appendChild(cell);
            });
            if (!item.catalog?.length) { const hint = document.createElement('div'); hint.className = 'episode-hint'; hint.textContent = '播放合集视频后补全目录'; panel.appendChild(hint); }
            div.appendChild(panel);
        }

        const folderSelect = div.querySelector('.quick-folder');
        currentFolders.forEach(folder => {
            const option = document.createElement('option'); option.value = folder; option.textContent = folder;
            folderSelect.appendChild(option);
        });
        folderSelect.value = item.folder || '默认收藏';
        folderSelect.addEventListener('click', e => e.stopPropagation());
        folderSelect.addEventListener('change', e => {
            e.stopPropagation(); const target = e.target.value;
            mutateFavorites({ type: 'move', key: item.series, id: item.id, folder: target }, () => showFloatingToast(`已移到 ${target}`));
        });
        div.querySelector('.btn-watched').addEventListener('click', e => {
            e.stopPropagation();
            mutateFavorites({ type: 'watched', key: item.series, id: item.id, url: item.url,
                watched: SkipperCore.watchState(item, item) !== '已看完' });
        });
        div.querySelector('.btn-series-complete').addEventListener('click', e => {
            e.stopPropagation();
            mutateFavorites({ type: 'completeSeries', key: item.series, id: item.id, completed: !item.seriesCompleted }, () => {
                if (!item.seriesCompleted) {
                    showCompleted = false; document.getElementById('showCompleted').checked = false;
                    chrome.storage.local.set({ showCompletedFavorites: false }); renderFavoritesList();
                    showFloatingToast('已标记全集已看并隐藏，可勾选“已看”找回');
                }
            });
        });

        fragment.appendChild(div);
    });

    if (visibleCount < totalItems) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.style.textAlign = 'center';
        loadMoreDiv.style.padding = '10px';
        loadMoreDiv.innerHTML = `<button id="btnLoadMore" style="padding:5px 15px; cursor:pointer; background:#f0f0f0; border:1px solid #ddd; border-radius:4px;">加载更多 (${totalItems - visibleCount})</button>`;
        fragment.appendChild(loadMoreDiv);

        setTimeout(() => {
            document.getElementById('btnLoadMore')?.addEventListener('click', () => {
                visibleCount += PAGE_SIZE;
                renderFavoritesList();
            });
        }, 0);
    }

    listDiv.innerHTML = '';
    listDiv.appendChild(fragment);
}

function loadConfigToUI(items) {
    items.keyForward = items.keyForward || defaultKeys.forward;
    items.keyRewind = items.keyRewind || defaultKeys.rewind;
    document.getElementById('autoSkipEnable').checked = items.autoSkipEnable;
    document.getElementById('enableIntro').checked = items.enableIntro;
    document.getElementById('enableOutro').checked = items.enableOutro;
    document.getElementById('autoRestart').checked = items.autoRestart;
    document.getElementById('autoPlayNext').checked = items.autoPlayNext;
    document.getElementById('introTime').value = items.introTime;
    document.getElementById('outroTime').value = items.outroTime;
    document.getElementById('manualSkipTime').value = items.manualSkipTime;
    document.getElementById('minDuration').value = items.minDuration;
    document.getElementById('keyForward').value = items.keyForward.keyName;
    document.getElementById('keyRewind').value = items.keyRewind.keyName;
}

function setupKeyRecorder(elementId, saveCallback) {
    const input = document.getElementById(elementId);
    input.addEventListener('keydown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        const keys = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
        let cleanKey = e.code.replace('Key', '').replace('Arrow', '');
        if(e.code === 'ArrowRight') cleanKey = 'Right';
        if(e.code === 'ArrowLeft') cleanKey = 'Left';
        keys.push(cleanKey);
        input.value = keys.join(' + ');
        saveCallback({ code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, keyName: input.value });
    });
}

function autoSaveSettings(key, value) {
    const perSeries = ['introTime', 'outroTime', 'minDuration', 'autoSkipEnable', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext'];
    const saveGlobal = () => chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) showFloatingToast(`❌ ${chrome.runtime.lastError.message}`);
        else popupConfig[key] = value;
    });
    if (!perSeries.includes(key) || !document.getElementById('whitelistMode').checked) { saveGlobal(); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs.length) { saveGlobal(); return; }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getNiceTitle' }, { frameId: 0 }, res => {
            const failed = chrome.runtime.lastError;
            const item = !failed && res && currentFavorites[res.series];
            if (!item) { saveGlobal(); return; }
            mutateFavorites({ type: 'patch', key: res.series, id: item.id,
                episodeUrl: res.collectionId && document.getElementById('episodeScope').checked ? res.url : undefined,
                patch: { [key === 'autoSkipEnable' ? 'autoSkipEnabled' : key]: value } });
        });
    });
}

['introTime', 'outroTime', 'manualSkipTime', 'minDuration'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        const input = document.getElementById(id);
        if (input.value === '') return;
        const number = Number(input.value);
        if (!Number.isFinite(number)) return;
        const value = Math.max(id === 'manualSkipTime' ? 1 : 0, Math.floor(number));
        input.value = value;
        autoSaveSettings(id, value);
    });
});
setupKeyRecorder('keyForward', key => { tempKeyForward = key; autoSaveSettings('keyForward', key); });
setupKeyRecorder('keyRewind', key => { tempKeyRewind = key; autoSaveSettings('keyRewind', key); });
['autoSkipEnable', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext'].forEach(id => {
    document.getElementById(id).addEventListener('change', event => {
        if (id === 'autoSkipEnable') updateStatusText(event.target.checked);
        autoSaveSettings(id, event.target.checked);
    });
});

function updateStatusText(isEnabled) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv.dataset.tempMessage) {
        statusDiv.textContent = isEnabled ? '状态: 运行中 🟢' : '状态: 已停用 ⚫';
        statusDiv.style.color = isEnabled ? 'green' : '#666';
    }
}

function showTempMessage(msg, color = '#00aeec') {
    const statusDiv = document.getElementById('status');
    statusDiv.dataset.tempMessage = 'true';
    statusDiv.textContent = msg;
    statusDiv.style.color = color;
    setTimeout(() => {
        delete statusDiv.dataset.tempMessage;
        const isEnabled = document.getElementById('autoSkipEnable').checked;
        updateStatusText(isEnabled);
    }, 1500);
}

function setupTagSettings(savedRules) {
    let rules = savedRules || [];
    const modal = document.getElementById('tagSettingsModal');
    if (!modal) return;

    const listDiv = document.getElementById('tagRuleList');
    const matchInput = document.getElementById('tagMatchInput');
    const nameInput = document.getElementById('tagNameInput');
    const btnOpen = document.getElementById('btnOpenTagModal');
    const btnClose = document.getElementById('btnCloseTagModal');
    const btnAdd = document.getElementById('btnAddTagRule');

    if (!btnOpen || !btnClose || !btnAdd) return;

    btnOpen.addEventListener('click', () => {
        renderRules();
        modal.style.display = 'flex';
    });

    btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    btnAdd.addEventListener('click', () => {
        const match = matchInput.value.trim();
        const name = nameInput.value.trim();
        if (!match || !name) return alert("请填写完整关键词和标签名");

        rules.push({ match: match, name: name });
        saveRules();
        renderRules();
        matchInput.value = '';
        nameInput.value = '';
    });

    function renderRules() {
        listDiv.innerHTML = '';
        if (rules.length === 0) {
            listDiv.innerHTML = '<div style="padding:10px; text-align:center; color:#ccc; font-size:11px;">暂无自定义规则</div>';
            return;
        }
        rules.forEach((rule, index) => {
            const div = document.createElement('div');
            div.className = 'row';
            div.style.padding = '4px 6px';
            div.style.borderBottom = '1px solid #eee';
            div.innerHTML = `
                <span style="font-size:11px; color:#333;">
                    <span style="color:#00aeec;">[${SkipperCore.escapeHtml(rule.match)}]</span> ➔ <b>${SkipperCore.escapeHtml(rule.name)}</b>
                </span>
                <button class="btn-del-rule" data-idx="${index}" style="border:none; background:none; color:red; cursor:pointer;">×</button>
            `;
            listDiv.appendChild(div);
        });

    document.querySelectorAll('.btn-del-rule').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.target.dataset.idx;
            rules.splice(idx, 1);
            saveRules();
            renderRules();
        });
    });
}

function saveRules() {
    chrome.storage.local.set({ customTagRules: rules });
}
}

function localizeHtml() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });

    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.placeholder = msg;
    });
}

localizeHtml();
