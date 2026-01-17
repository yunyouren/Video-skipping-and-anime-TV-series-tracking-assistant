document.addEventListener('DOMContentLoaded', () => {
    // 初始化路由
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    // 加载数据
    loadRules();
    loadSeriesRules();
    loadSettings();
    loadFavorites();

    // 绑定事件
    document.getElementById('btnAddRule').addEventListener('click', addRule);
    document.getElementById('btnAddSeriesRule').addEventListener('click', addSeriesRule);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
    
    // 收藏管理事件
    document.getElementById('favSearchInput').addEventListener('input', filterFavorites);
    document.getElementById('folderFilter').addEventListener('change', filterFavorites);
    document.getElementById('btnClearAllFavs').addEventListener('click', clearAllFavorites);
    document.getElementById('btnExportFavs').addEventListener('click', exportFavorites);
    document.getElementById('btnImportFavs').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importFavorites);

    // 弹窗事件
    document.getElementById('btnCancelMove').addEventListener('click', closeMoveModal);
    document.getElementById('btnConfirmMove').addEventListener('click', confirmMove);

    localizeHtml();
});

// --- 路由逻辑 ---
function handleHashChange() {
    let hash = window.location.hash.substring(1) || 'rules'; // 默认路由
    
    // 简单的路由映射
    const pages = ['rules', 'series', 'favorites', 'settings', 'about'];
    if (!pages.includes(hash)) hash = 'rules';

    // 更新侧边栏状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.target === hash);
    });

    // 更新页面显示
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`page-${hash}`).classList.add('active');
}

// --- 数据逻辑 ---
function loadRules() {
    chrome.storage.local.get({ customTagRules: [] }, (items) => {
        renderList(items.customTagRules);
    });
}

function renderList(rules) {
    const container = document.getElementById('ruleListContainer');
    container.innerHTML = '';

    if (!rules || rules.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无自定义规则，请在上方添加。</div>';
        return;
    }

    rules.forEach((rule, index) => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="tag-match">${escapeHtml(rule.match)}</span>
                <span class="tag-arrow">➔</span>
                <span class="tag-name">${escapeHtml(rule.name)}</span>
            </div>
            <button class="btn-danger btn-del" data-index="${index}">删除</button>
        `;
        container.appendChild(div);
    });

    // 绑定删除事件
    document.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            deleteRule(index);
        });
    });
}

function addRule() {
    const matchInput = document.getElementById('tagMatchInput');
    const nameInput = document.getElementById('tagNameInput');
    
    const match = matchInput.value.trim();
    const name = nameInput.value.trim();

    if (!match || !name) {
        showToast('请填写完整的关键词和标签名', true);
        return;
    }

    chrome.storage.local.get({ customTagRules: [] }, (items) => {
        const rules = items.customTagRules;
        // 简单的去重检查
        if (rules.some(r => r.match === match)) {
            if (!confirm(`关键词 "${match}" 已存在，是否覆盖？`)) return;
            const idx = rules.findIndex(r => r.match === match);
            rules[idx] = { match, name };
        } else {
            rules.push({ match, name });
        }

        chrome.storage.local.set({ customTagRules: rules }, () => {
            matchInput.value = '';
            nameInput.value = '';
            renderList(rules);
            showToast('规则已保存');
        });
    });
}

function deleteRule(index) {
    chrome.storage.local.get({ customTagRules: [] }, (items) => {
        const rules = items.customTagRules;
        if (index >= 0 && index < rules.length) {
            rules.splice(index, 1);
            chrome.storage.local.set({ customTagRules: rules }, () => {
                renderList(rules);
                showToast('规则已删除');
            });
        }
    });
}

// --- 番剧名称规则逻辑 ---
function loadSeriesRules() {
    chrome.storage.local.get({ customSeriesRules: [] }, (items) => {
        renderSeriesList(items.customSeriesRules);
    });
}

function renderSeriesList(rules) {
    const container = document.getElementById('seriesListContainer');
    container.innerHTML = '';

    if (!rules || rules.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无番剧规则，请在上方添加。</div>';
        return;
    }

    rules.forEach((rule, index) => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="tag-match">${escapeHtml(rule.match)}</span>
                <span class="tag-arrow">➔</span>
                <span class="tag-name">${escapeHtml(rule.name)}</span>
            </div>
            <button class="btn-danger btn-del-series" data-index="${index}">删除</button>
        `;
        container.appendChild(div);
    });

    // 绑定删除事件
    document.querySelectorAll('.btn-del-series').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            deleteSeriesRule(index);
        });
    });
}

function addSeriesRule() {
    const matchInput = document.getElementById('seriesMatchInput');
    const nameInput = document.getElementById('seriesNameInput');
    
    const match = matchInput.value.trim();
    const name = nameInput.value.trim();

    if (!match || !name) {
        showToast('请填写完整的关键词和番剧名', true);
        return;
    }

    chrome.storage.local.get({ customSeriesRules: [] }, (items) => {
        const rules = items.customSeriesRules;
        if (rules.some(r => r.match === match)) {
            if (!confirm(`关键词 "${match}" 已存在，是否覆盖？`)) return;
            const idx = rules.findIndex(r => r.match === match);
            rules[idx] = { match, name };
        } else {
            rules.push({ match, name });
        }

        chrome.storage.local.set({ customSeriesRules: rules }, () => {
            matchInput.value = '';
            nameInput.value = '';
            renderSeriesList(rules);
            showToast('番剧规则已保存');
        });
    });
}

function deleteSeriesRule(index) {
    chrome.storage.local.get({ customSeriesRules: [] }, (items) => {
        const rules = items.customSeriesRules;
        if (index >= 0 && index < rules.length) {
            rules.splice(index, 1);
            chrome.storage.local.set({ customSeriesRules: rules }, () => {
                renderSeriesList(rules);
                showToast('规则已删除');
            });
        }
    });
}

// --- 收藏管理逻辑 ---
let cachedFavorites = {};

function loadFavorites() {
    chrome.storage.local.get({ favorites: {} }, (items) => {
        cachedFavorites = items.favorites || {};
        updateFolderFilter(cachedFavorites);
        renderFavoritesList(cachedFavorites);
    });
}

function updateFolderFilter(favoritesObj) {
    const folders = new Set();
    Object.values(favoritesObj).forEach(item => {
        if (item.folder && item.folder.trim() !== "") {
            folders.add(item.folder.trim());
        }
    });
    
    const select = document.getElementById('folderFilter');
    const currentVal = select.value;
    
    // 保留第一个 "所有文件夹"
    select.innerHTML = '<option value="">所有文件夹</option>';
    
    // 添加未分类
    const hasUncategorized = Object.values(favoritesObj).some(item => !item.folder || item.folder.trim() === "");
    if (hasUncategorized) {
         const opt = document.createElement('option');
         opt.value = "__none__";
         opt.innerText = "未分类";
         select.appendChild(opt);
    }

    Array.from(folders).sort().forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.innerText = f;
        select.appendChild(opt);
    });

    select.value = currentVal; // 尝试恢复选中状态
}

function renderFavoritesList(favoritesObj) {
    const container = document.getElementById('favListContainer');
    container.innerHTML = '';
    
    // 获取当前过滤条件
    const searchKeyword = document.getElementById('favSearchInput').value.trim().toLowerCase();
    const folderFilter = document.getElementById('folderFilter').value;

    // 转换为数组
    let list = Object.values(favoritesObj);

    // 过滤逻辑
    list = list.filter(item => {
        // 搜索过滤
        if (searchKeyword && !item.series.toLowerCase().includes(searchKeyword)) {
            return false;
        }
        // 文件夹过滤
        if (folderFilter) {
            if (folderFilter === "__none__") {
                if (item.folder && item.folder.trim() !== "") return false;
            } else {
                if (item.folder !== folderFilter) return false;
            }
        }
        return true;
    });

    // 排序 (按时间倒序)
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (list.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无符合条件的收藏记录。</div>';
        return;
    }

    list.forEach(item => {
        // 格式化时间
        const date = new Date(item.timestamp || Date.now());
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        // 格式化进度
        const progress = formatTime(item.time) + ' / ' + formatTime(item.duration);
        
        // 文件夹显示
        const folderHtml = item.folder ? `<span style="background:#e6f7ff; color:#00aeec; padding:2px 5px; border-radius:3px; margin-right:5px; font-size:12px;">📁 ${escapeHtml(item.folder)}</span>` : '';

        const div = document.createElement('div');
        div.className = 'rule-item';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-bottom:5px;">
                <div style="font-weight:bold; font-size:14px; color:#333; display:flex; align-items:center;">
                    ${folderHtml}
                    ${escapeHtml(item.series)}
                </div>
                <div>
                    <button class="btn-primary btn-move-fav" data-series="${escapeHtml(item.series)}" style="padding: 4px 10px; margin-right: 5px; background-color: #722ed1;">移动</button>
                    <button class="btn-primary btn-edit-fav" data-series="${escapeHtml(item.series)}" style="padding: 4px 10px; margin-right: 5px;">改名</button>
                    <button class="btn-danger btn-del-fav" data-series="${escapeHtml(item.series)}" style="padding: 4px 10px;">删除</button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; font-size:12px; color:#666;">
                <div>
                    <span style="background:#f0f0f0; padding:2px 5px; border-radius:3px; margin-right:5px;">${escapeHtml(item.site || 'Web')}</span>
                    <span style="margin-right:10px;">${escapeHtml(item.episode)}</span>
                    <span>⏱ ${progress}</span>
                </div>
                <div>${dateStr}</div>
            </div>
        `;
        container.appendChild(div);
    });

    // 绑定事件
    document.querySelectorAll('.btn-del-fav').forEach(btn => btn.addEventListener('click', (e) => deleteFavorite(e.target.dataset.series)));
    document.querySelectorAll('.btn-edit-fav').forEach(btn => btn.addEventListener('click', (e) => renameFavorite(e.target.dataset.series)));
    document.querySelectorAll('.btn-move-fav').forEach(btn => btn.addEventListener('click', (e) => moveFavorite(e.target.dataset.series)));
}

function filterFavorites() {
    renderFavoritesList(cachedFavorites);
}

function moveFavorite(seriesName) {
    currentMoveSeries = seriesName; // 保存当前操作的番剧名
    const item = cachedFavorites[seriesName];
    if (!item) return;

    // 1. 填充下拉框
    const select = document.getElementById('moveFolderSelect');
    select.innerHTML = '<option value="">(移出文件夹 / 无)</option>';
    
    // 获取所有现有文件夹
    const folders = new Set();
    Object.values(cachedFavorites).forEach(i => {
        if (i.folder && i.folder.trim() !== "") {
            folders.add(i.folder.trim());
        }
    });
    
    Array.from(folders).sort().forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.innerText = f;
        select.appendChild(opt);
    });

    // 2. 选中当前文件夹
    if (item.folder) {
        select.value = item.folder;
    } else {
        select.value = "";
    }

    // 3. 清空输入框并显示弹窗
    document.getElementById('moveNewFolderInput').value = "";
    document.getElementById('moveModal').style.display = "flex";
}

let currentMoveSeries = null;

function closeMoveModal() {
    document.getElementById('moveModal').style.display = "none";
    currentMoveSeries = null;
}

function confirmMove() {
    if (!currentMoveSeries) return;

    const select = document.getElementById('moveFolderSelect');
    const input = document.getElementById('moveNewFolderInput');
    
    let targetFolder = "";
    
    // 优先使用输入框的新建文件夹名
    if (input.value && input.value.trim() !== "") {
        targetFolder = input.value.trim();
    } else {
        targetFolder = select.value;
    }

    chrome.storage.local.get({ favorites: {} }, (items) => {
        const favs = items.favorites;
        if (favs[currentMoveSeries]) {
            favs[currentMoveSeries].folder = targetFolder;
            chrome.storage.local.set({ favorites: favs }, () => {
                cachedFavorites = favs;
                updateFolderFilter(cachedFavorites);
                renderFavoritesList(cachedFavorites);
                showToast('移动成功');
                closeMoveModal();
            });
        }
    });
}

function deleteFavorite(seriesName) {
    if (!confirm(`确定要删除 "${seriesName}" 的进度记录吗？`)) return;

    chrome.storage.local.get({ favorites: {} }, (items) => {
        const favs = items.favorites;
        if (favs[seriesName]) {
            delete favs[seriesName];
            chrome.storage.local.set({ favorites: favs }, () => {
                cachedFavorites = favs; // 更新缓存
                // 如果正在搜索，重新过滤；否则重新渲染全部
                const keyword = document.getElementById('favSearchInput').value.trim();
                if (keyword) {
                    filterFavorites();
                } else {
                    renderFavoritesList(favs);
                }
                showToast('已删除');
            });
        }
    });
}

function clearAllFavorites() {
    if (!confirm('确定要清空所有收藏记录吗？此操作不可恢复！')) return;

    chrome.storage.local.set({ favorites: {} }, () => {
        cachedFavorites = {};
        renderFavoritesList({});
        showToast('所有记录已清空');
    });
}

function exportFavorites() {
    chrome.storage.local.get({ favorites: {} }, (items) => {
        const data = JSON.stringify(items.favorites, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bilibili-skipper-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

function importFavorites(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (typeof imported !== 'object') throw new Error('格式错误');

            chrome.storage.local.get({ favorites: {} }, (items) => {
                const current = items.favorites;
                // 合并逻辑：如果存在同名 key，保留时间较新的
                let count = 0;
                for (const key in imported) {
                    const newItem = imported[key];
                    if (!current[key] || (newItem.timestamp || 0) > (current[key].timestamp || 0)) {
                        current[key] = newItem;
                        count++;
                    }
                }
                
                chrome.storage.local.set({ favorites: current }, () => {
                    cachedFavorites = current;
                    renderFavoritesList(current);
                    showToast(`成功导入 ${count} 条记录`);
                });
            });
        } catch (err) {
            alert('导入失败：文件格式不正确');
        }
        // 清空 input 允许重复导入同一文件
        event.target.value = '';
    };
    reader.readAsText(file);
}

function renameFavorite(oldName) {
    const newName = prompt("请输入新的番剧名称：", oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;

    const finalName = newName.trim();

    chrome.storage.local.get({ favorites: {} }, (items) => {
        const favs = items.favorites;
        if (!favs[oldName]) return; // 原记录不存在

        const oldData = favs[oldName];
        
        // 检查目标名称是否已存在
        if (favs[finalName]) {
            if (!confirm(`目标名称 "${finalName}" 已存在，是否合并？\n(将保留两者中较新的进度)`)) return;
            
            // 合并逻辑
            const targetData = favs[finalName];
            // 如果旧数据的 timestamp 更大（更新），则覆盖目标
            // 否则保留目标，直接删除旧数据即可
            if ((oldData.timestamp || 0) > (targetData.timestamp || 0)) {
                favs[finalName] = { ...oldData, series: finalName };
            }
        } else {
            // 直接重命名
            favs[finalName] = { ...oldData, series: finalName };
        }

        // 删除旧名称
        delete favs[oldName];

        chrome.storage.local.set({ favorites: favs }, () => {
            cachedFavorites = favs;
            // 如果正在搜索，重新过滤；否则重新渲染全部
            const keyword = document.getElementById('favSearchInput').value.trim();
            if (keyword) {
                filterFavorites();
            } else {
                renderFavoritesList(favs);
            }
            showToast('改名/合并成功');
        });
    });
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    let str = "";
    if (h > 0) str += h + ":";
    str += (m < 10 ? "0" + m : m) + ":";
    str += (s < 10 ? "0" + s : s);
    return str;
}

// --- 高级设置逻辑 ---
function loadSettings() {
    chrome.storage.local.get({ onlySaveMaxEpisode: false }, (items) => {
        document.getElementById('chkOnlySaveMaxEpisode').checked = items.onlySaveMaxEpisode;
    });
}

function saveSettings() {
    const onlySaveMaxEpisode = document.getElementById('chkOnlySaveMaxEpisode').checked;
    chrome.storage.local.set({ onlySaveMaxEpisode }, () => {
        showToast('设置已保存');
    });
}

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.backgroundColor = isError ? '#ff4d4f' : '#333';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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