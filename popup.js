// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + →' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ←' }
};

const defaultFolders = ["默认收藏", "国漫", "日漫", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const defaultPresets = [
    { name: "B站标准 (自动)", intro: 90, outro: 0, restart: false, next: false, domain: "bilibili" },
    { name: "爱奇艺 (自动)", intro: 120, outro: 30, restart: true, next: true, domain: "iqiyi" },
    { name: "腾讯视频 (自动)", intro: 110, outro: 15, restart: true, next: true, domain: "v.qq.com" }
];

let tempKeyForward = null;
let tempKeyRewind = null;
let currentPresets = [];
let currentFavorites = {};
let currentFolders = [];
let targetMoveSeries = null;
let visibleCount = 20; // 当前显示数量
const PAGE_SIZE = 20;  // 每次加载数量

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        enableIntro: true,
        enableOutro: true,
        autoRestart: false,
        autoUpdateFav: true,
        autoApplyPreset: true,
        
        // 新增：读取最后一次激活的方案名 (由 content.js 写入)
        lastActivePreset: "",

        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind,
        savedPresets: defaultPresets,
        favorites: {},
        favFolders: defaultFolders,
        customTagRules: []
    }, (items) => {
        // 优先初始化标签设置
        try { setupTagSettings(items.customTagRules); } catch(e) { console.error("TagSettings Error:", e); }

        loadConfigToUI(items);
        currentPresets = items.savedPresets;
        currentFavorites = items.favorites;
        currentFolders = items.favFolders;
        
        document.getElementById('autoUpdateFav').checked = items.autoUpdateFav;
        document.getElementById('autoApplyPreset').checked = items.autoApplyPreset;

        // 显示当前匹配的方案名
        const activeNameLabel = document.getElementById('activePresetName');
        if (items.lastActivePreset && items.autoApplyPreset) {
            activeNameLabel.textContent = `已激活: ${items.lastActivePreset}`;
            activeNameLabel.style.display = 'inline-block';
        } else {
            activeNameLabel.style.display = 'none';
        }

        renderFolderSelect();
        
        // 【新增】自动检测当前视频是否已收藏，并选中对应的文件夹
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "getNiceTitle" }, { frameId: 0 }, (titleResponse) => {
                if (titleResponse && titleResponse.series) {
                    const seriesName = titleResponse.series;
                    const favItem = currentFavorites[seriesName];
                    if (favItem && favItem.folder) {
                        const select = document.getElementById('folderSelect');
                        // 确保该文件夹在下拉列表中
                        if (currentFolders.includes(favItem.folder)) {
                            select.value = favItem.folder;
                            // 重新渲染列表以显示该文件夹内容
                            renderFavoritesList();
                        }
                    }
                }
            });
        });
        
        document.getElementById('folderSelect').addEventListener('change', () => {
            visibleCount = PAGE_SIZE; // 切换文件夹时重置
            renderFavoritesList(); 
        });

        document.getElementById('newFolderBtn').addEventListener('click', () => {
            const name = prompt("请输入新收藏夹名称 (例如: 补番中):");
            if (name && !currentFolders.includes(name)) {
                currentFolders.push(name);
                saveFolders();
                renderFolderSelect(name);
            }
        });
        
        document.getElementById('delFolderBtn').addEventListener('click', () => {
             const select = document.getElementById('folderSelect');
             const folder = select.value;
             
             if (folder === "__ALL__") {
                 alert("无法删除“全部展示”视图。\n请切换到具体文件夹后再执行删除操作。");
                 return;
             }

             if (folder === "默认收藏") {
                 alert("无法删除默认收藏夹");
                 return;
             }
             if (confirm(`删除文件夹 "${folder}"？\n其中的番剧将移动到 "默认收藏"。`)) {
                 Object.values(currentFavorites).forEach(item => {
                     if (item.folder === folder) item.folder = "默认收藏";
                 });
                 currentFolders = currentFolders.filter(f => f !== folder);
                 saveDataAndRender();
                 saveFolders();
                 renderFolderSelect("默认收藏");
             }
        });

        renderPresetDropdown();
        renderFavoritesList();
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;
        updateStatusText(items.autoSkipEnable);
    });
    setupKeyRecorder('keyForward', (keyData) => { tempKeyForward = keyData; });
    setupKeyRecorder('keyRewind', (keyData) => { tempKeyRewind = keyData; });

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
            div.innerHTML = `<label><input type="checkbox" class="folder-chk" value="${folder}" checked> ${folder}</label>`;
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

        const exportData = {
            version: "3.1",
            timestamp: Date.now(),
            dateStr: new Date().toLocaleString(),
            folders: selectedFolders,
            favorites: filteredFavorites
        };

        const date = new Date();
        const dateStr = date.getFullYear() +
                        (date.getMonth()+1).toString().padStart(2, '0') +
                        date.getDate().toString().padStart(2, '0');
        
        // 修复：文件名安全处理，防止非法字符导致下载失败
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
        currentFavorites[targetMoveSeries].folder = newFolder;
        
        saveDataAndRender();
        
        moveModal.style.display = 'none';
        targetMoveSeries = null;
        
        showFloatingToast(`✅ 已移动到 [${newFolder}]`);
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.favorites) {
            currentFavorites = changes.favorites.newValue || {};
            renderFavoritesList();
        }
    });
});

function handleImport(data) {
    if (!data.favorites || !data.folders) {
        alert("❌ 文件内容不完整，无法导入");
        return;
    }

    const confirmMsg = `准备导入备份：\n📅 时间: ${data.dateStr || '未知时间'}\n📁 包含 ${Object.keys(data.favorites).length} 个番剧\n\n注意：同名番剧将被覆盖，新番剧将添加。是否继续？`;
    
    if (!confirm(confirmMsg)) return;

    const newFoldersSet = new Set([...currentFolders, ...data.folders]);
    currentFolders = Array.from(newFoldersSet);

    currentFavorites = { ...currentFavorites, ...data.favorites };

    for (let key in currentFavorites) {
        if (!currentFavorites[key].folder) {
            currentFavorites[key].folder = "默认收藏";
        }
    }

    saveFolders();
    saveDataAndRender();
    
    const currentSelect = document.getElementById('folderSelect').value;
    renderFolderSelect(currentSelect);

    showFloatingToast(`✅ 成功导入 ${Object.keys(data.favorites).length} 条记录`);
}

// ... (其他逻辑保持不变，确保完整性) ...

document.getElementById('autoUpdateFav').addEventListener('change', (e) => { chrome.storage.local.set({ autoUpdateFav: e.target.checked }); });
document.getElementById('autoApplyPreset').addEventListener('change', (e) => { chrome.storage.local.set({ autoApplyPreset: e.target.checked }); });

document.getElementById('addFavBtn').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "getNiceTitle" }, { frameId: 0 }, (titleResponse) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getRequestVideoInfo" }, (videoResponse) => {
                if (chrome.runtime.lastError) { }
                if (!videoResponse) { showFloatingToast("❌ 失败：未检测到视频"); return; }
                let finalData = videoResponse;
                if (titleResponse) {
                    if (titleResponse.series && titleResponse.series !== "樱花动漫") {
                        finalData.series = titleResponse.series;
                        if (finalData.episode === "观看中" && titleResponse.episode) finalData.episode = titleResponse.episode;
                    }
                    if (titleResponse.url) finalData.url = titleResponse.url;
                    if (titleResponse.site) finalData.site = titleResponse.site;
                }
                
                const currentFolder = document.getElementById('folderSelect').value;
                let targetFolder = currentFolder;
                
                if (targetFolder === "__ALL__") {
                    targetFolder = "默认收藏";
                }
                
                finalData.folder = targetFolder;
                
                currentFavorites[finalData.series] = finalData;
                chrome.storage.local.set({ favorites: currentFavorites }, () => {
                    renderFavoritesList();
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

function saveFolders() {
    chrome.storage.local.set({ favFolders: currentFolders });
}
function saveDataAndRender() {
    chrome.storage.local.set({ favorites: currentFavorites }, () => {
        renderFavoritesList();
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

    if (!currentFavorites || Object.keys(currentFavorites).length === 0) {
        listDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#999; font-size:12px;">暂无收藏</div>';
        return;
    }
    
    // 使用 DocumentFragment 优化渲染
    const fragment = document.createDocumentFragment();
    
    let sortedItems = Object.values(currentFavorites);

    if (currentFolder !== "__ALL__") {
        sortedItems = sortedItems.filter(item => {
            const itemFolder = item.folder || "默认收藏";
            return itemFolder === currentFolder;
        });
    }

    sortedItems.sort((a, b) => b.timestamp - a.timestamp);

    if (sortedItems.length === 0) {
        const msg = currentFolder === "__ALL__" ? "暂无任何收藏" : `"${currentFolder}" 为空`;
        listDiv.innerHTML = `<div style="padding:15px; text-align:center; color:#999; font-size:12px;">${msg}</div>`;
        return;
    }

    // 分页切片
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
            folderBadge = `<span style="background:#f0f0f0; color:#888; padding:1px 4px; border-radius:3px; margin-right:4px; font-size:10px; border:1px solid #eee;">${item.folder || '默认'}</span>`;
        }

        div.innerHTML = `
            <div class="fav-series">${item.series}</div>
            <div class="fav-episode">
                <span style="display:flex; align-items:center;">
                    ${folderBadge} <span class="fav-tag">${item.site}</span>
                    <span style="max-width: 80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.episode}</span>
                </span>
                <span class="fav-time">${formatTime(item.time)} / ${formatTime(item.duration)}</span>
            </div>
            <div class="fav-actions" style="position: absolute; right: 5px; top: 5px; display: none;">
                <button class="btn-move" title="移动文件夹" style="border:1px solid #ddd; background:#fff; cursor:pointer; font-size:10px; margin-right:2px;">📂</button>
                <button class="btn-del" title="删除" style="border:1px solid #ffcccc; background:#fff; color:red; cursor:pointer; font-size:10px;">×</button>
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
            chrome.tabs.create({ url: item.url });
        });

        div.querySelector('.btn-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`删除 "${item.series}"?`)) {
                delete currentFavorites[item.series];
                saveDataAndRender();
            }
        });

        div.querySelector('.btn-move').addEventListener('click', (e) => {
            e.stopPropagation();
            
            targetMoveSeries = item.series;
            const moveSelect = document.getElementById('moveTargetSelect');
            moveSelect.innerHTML = '';
            
            currentFolders.forEach(folder => {
                const opt = document.createElement('option');
                opt.value = folder;
                opt.innerText = folder;
                
                if (folder === (item.folder || "默认收藏")) {
                    opt.innerText += " (当前)";
                    opt.selected = true; 
                }
                moveSelect.appendChild(opt);
            });
            
            const newOpt = document.createElement('option');
            newOpt.value = "__NEW__";
            newOpt.innerText = "➕ 新建文件夹...";
            newOpt.style.color = "#00aeec";
            moveSelect.appendChild(newOpt);

            moveSelect.onchange = function() {
                if (this.value === "__NEW__") {
                    const newName = prompt("请输入新文件夹名称:");
                    if (newName && !currentFolders.includes(newName)) {
                        currentFolders.push(newName);
                        saveFolders();
                        renderFolderSelect(); 
                        
                        const tempOpt = document.createElement('option');
                        tempOpt.value = newName;
                        tempOpt.innerText = newName;
                        tempOpt.selected = true;
                        moveSelect.insertBefore(tempOpt, newOpt);
                        moveSelect.value = newName;
                    } else {
                        moveSelect.value = item.folder || "默认收藏";
                    }
                }
            };

            const moveModal = document.getElementById('moveModal');
            moveModal.style.display = 'flex';
        });

        fragment.appendChild(div);
    });

    // 加载更多按钮
    if (visibleCount < totalItems) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.style.textAlign = 'center';
        loadMoreDiv.style.padding = '10px';
        loadMoreDiv.innerHTML = `<button id="btnLoadMore" style="padding:5px 15px; cursor:pointer; background:#f0f0f0; border:1px solid #ddd; border-radius:4px;">加载更多 (${totalItems - visibleCount})</button>`;
        fragment.appendChild(loadMoreDiv);
        
        // 使用 setTimeout 确保插入 DOM 后绑定事件
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

function renderPresetDropdown() {
    const select = document.getElementById('presetSelect');
    const selectedValue = select.value;
    select.innerHTML = '<option value="">-- 预设方案 --</option>';
    currentPresets.forEach((preset, index) => {
        const option = document.createElement('option');
        option.value = index;
        const domainText = preset.domain ? ` [🔗${preset.domain}]` : '';
        option.textContent = `${preset.name}${domainText}`;
        select.appendChild(option);
    });
    if(selectedValue && currentPresets[selectedValue]) select.value = selectedValue;
}
document.getElementById('presetSelect').addEventListener('change', (e) => {
    const index = e.target.value;
    const domainInput = document.getElementById('domainMatch');
    if (index !== "") domainInput.value = currentPresets[index].domain || "";
    else domainInput.value = "";
});
document.getElementById('applyPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    if (index === "") return showTempMessage("请先选择预设", "red");
    const p = currentPresets[index];
    loadPresetToUI(p);
    document.getElementById('saveBtn').click();
    showTempMessage(`已加载: ${p.name}`);
});
document.getElementById('addPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    const domain = document.getElementById('domainMatch').value.trim();
    if (index === "") {
        const name = prompt("新预设名称:");
        if (!name) return;
        currentPresets.push(createPresetFromUI(name, domain));
    } else {
        const p = currentPresets[index];
        if (confirm(`更新 "${p.name}"?`)) currentPresets[index] = createPresetFromUI(p.name, domain);
        else return;
    }
    savePresetsToStorage();
    renderPresetDropdown();
    showTempMessage("已保存 ✅");
});
document.getElementById('delPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    if (index === "") return;
    if (confirm("确定删除?")) {
        currentPresets.splice(index, 1);
        savePresetsToStorage();
        renderPresetDropdown();
        document.getElementById('domainMatch').value = "";
    }
});

function createPresetFromUI(name, domain) {
    return {
        name: name, domain: domain,
        intro: parseInt(document.getElementById('introTime').value) || 0,
        outro: parseInt(document.getElementById('outroTime').value) || 0,
        restart: document.getElementById('autoRestart').checked,
        next: document.getElementById('autoPlayNext').checked,
    };
}
function loadPresetToUI(p) {
    document.getElementById('introTime').value = p.intro;
    document.getElementById('outroTime').value = p.outro;
    document.getElementById('autoRestart').checked = p.restart;
    document.getElementById('autoPlayNext').checked = p.next;
    document.getElementById('enableIntro').checked = (p.intro > 0);
    document.getElementById('enableOutro').checked = (p.outro > 0);
    document.getElementById('domainMatch').value = p.domain || "";
}
function savePresetsToStorage() { chrome.storage.local.set({ savedPresets: currentPresets }); }
function loadConfigToUI(items) {
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
        if(e.code === 'ArrowRight') cleanKey = '→';
        if(e.code === 'ArrowLeft') cleanKey = '←';
        keys.push(cleanKey);
        input.value = keys.join(' + ');
        saveCallback({ code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, keyName: input.value });
    });
}
document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
        autoSkipEnable: document.getElementById('autoSkipEnable').checked,
        enableIntro: document.getElementById('enableIntro').checked,
        enableOutro: document.getElementById('enableOutro').checked,
        autoRestart: document.getElementById('autoRestart').checked,
        autoPlayNext: document.getElementById('autoPlayNext').checked,
        introTime: parseInt(document.getElementById('introTime').value) || 0,
        outroTime: parseInt(document.getElementById('outroTime').value) || 0,
        manualSkipTime: parseInt(document.getElementById('manualSkipTime').value) || 90,
        minDuration: parseInt(document.getElementById('minDuration').value) || 0,
        keyForward: tempKeyForward || defaultKeys.forward,
        keyRewind: tempKeyRewind || defaultKeys.rewind,
        autoUpdateFav: document.getElementById('autoUpdateFav').checked,
        
        autoApplyPreset: document.getElementById('autoApplyPreset').checked, // 保存开关

        savedPresets: currentPresets,
        favorites: currentFavorites,
        favFolders: currentFolders
    };
    chrome.storage.local.set(config, () => { showTempMessage('✅ 配置已保存'); });
});
const switches = ['autoSkipEnable', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext'];
switches.forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
        let data = {}; data[id] = e.target.checked;
        chrome.storage.local.set(data, () => { if(id === 'autoSkipEnable') updateStatusText(e.target.checked); });
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

// 【新增】处理标签设置 UI
function setupTagSettings(savedRules) {
    let rules = savedRules || [];
    const modal = document.getElementById('tagSettingsModal');
    if (!modal) return; // 元素不存在则退出，防止报错

    const listDiv = document.getElementById('tagRuleList');
    const matchInput = document.getElementById('tagMatchInput');
    const nameInput = document.getElementById('tagNameInput');
    const btnOpen = document.getElementById('btnOpenTagModal');
    const btnClose = document.getElementById('btnCloseTagModal');
    const btnAdd = document.getElementById('btnAddTagRule');

    if (!btnOpen || !btnClose || !btnAdd) return;

    // 打开模态框
    btnOpen.addEventListener('click', () => {
        renderRules();
        modal.style.display = 'flex';
    });

    // 关闭模态框
    btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // 添加规则
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

    // 渲染列表
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
                    <span style="color:#00aeec;">[${rule.match}]</span> ➔ <b>${rule.name}</b>
                </span>
                <button class="btn-del-rule" data-idx="${index}" style="border:none; background:none; color:red; cursor:pointer;">×</button>
            `;
            listDiv.appendChild(div);
        });

        // 绑定删除事件
    document.querySelectorAll('.btn-del-rule').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.target.dataset.idx;
            rules.splice(idx, 1);
            saveRules();
            renderRules();
        });
    });
}

// 保存到 Storage
function saveRules() {
    chrome.storage.local.set({ customTagRules: rules });
}
}

// --- 国际化 ---
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