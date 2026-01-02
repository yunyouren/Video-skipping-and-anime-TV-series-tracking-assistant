// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + →' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ←' }
};

const defaultPresets = [
    { name: "B站标准 (自动)", intro: 90, outro: 0, restart: false, next: false, domain: "bilibili" },
    { name: "爱奇艺 (自动)", intro: 120, outro: 30, restart: true, next: true, domain: "iqiyi" },
    { name: "腾讯视频 (自动)", intro: 110, outro: 15, restart: true, next: true, domain: "v.qq.com" }
];

let tempKeyForward = null;
let tempKeyRewind = null;
let currentPresets = [];
let currentFavorites = {};

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        enableIntro: true,
        enableOutro: true,
        autoRestart: false,
        
        // 新增：自动更新收藏开关
        autoUpdateFav: true, 

        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind,
        savedPresets: defaultPresets,
        favorites: {} 
    }, (items) => {
        loadConfigToUI(items);
        currentPresets = items.savedPresets;
        currentFavorites = items.favorites;
        
        // 回显新开关
        document.getElementById('autoUpdateFav').checked = items.autoUpdateFav;

        renderPresetDropdown();
        renderFavoritesList();
        
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;
        updateStatusText(items.autoSkipEnable);
    });

    setupKeyRecorder('keyForward', (keyData) => { tempKeyForward = keyData; });
    setupKeyRecorder('keyRewind', (keyData) => { tempKeyRewind = keyData; });
});

// --- 监听新开关 (即时保存) ---
document.getElementById('autoUpdateFav').addEventListener('change', (e) => {
    chrome.storage.local.set({ autoUpdateFav: e.target.checked });
});


// 按钮：添加当前视频
document.getElementById('addFavBtn').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;

        // 步骤 1: 向主Frame (frameId: 0) 请求正确的标题
        chrome.tabs.sendMessage(tabId, { action: "getNiceTitle" }, { frameId: 0 }, (titleResponse) => {
            
            // 步骤 2: 向所有Frame广播，寻找那个有视频的Frame
            chrome.tabs.sendMessage(tabId, { action: "getRequestVideoInfo" }, (videoResponse) => {
                
                if (chrome.runtime.lastError) {
                    // 忽略这里的错误，因为有些没有视频的frame会报错
                }

                if (!videoResponse) {
                    showTempMessage("未找到播放中的视频", "red");
                    return;
                }

                // --- 核心合并逻辑 ---
                let finalData = videoResponse; // 默认用视频Frame的数据

                // 如果主页面返回了标题，且视频Frame是在iframe里(标题可能是错的)
                // 那么我们就用主页面的标题覆盖它！
                if (titleResponse && titleResponse.series && titleResponse.series !== "樱花动漫") {
                    console.log("使用主页面标题修正:", titleResponse.series);
                    finalData.series = titleResponse.series;
                    // 如果集数没解析出来，也尝试用主页面的url/标题补充
                    if (finalData.episode === "观看中" && titleResponse.episode) {
                        finalData.episode = titleResponse.episode;
                    }
                }

                // 保存
                currentFavorites[finalData.series] = finalData;
                chrome.storage.local.set({ favorites: currentFavorites }, () => {
                    renderFavoritesList();
                    showTempMessage("收藏成功 ✅");
                });
            });
        });
    });
});


function renderFavoritesList() {
    const listDiv = document.getElementById('favList');
    if (!currentFavorites || Object.keys(currentFavorites).length === 0) {
        listDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#999; font-size:12px;">暂无收藏</div>';
        return;
    }
    listDiv.innerHTML = '';
    const sortedItems = Object.values(currentFavorites).sort((a, b) => b.timestamp - a.timestamp);
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };
    sortedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'fav-item';
        div.title = "点击跳转续看";
        div.innerHTML = `
            <div class="fav-series">${item.series}</div>
            <div class="fav-episode">
                <span><span class="fav-tag">${item.site}</span>${item.episode}</span>
                <span class="fav-time">${formatTime(item.time)} / ${formatTime(item.duration)}</span>
            </div>
            <div class="fav-del" title="删除">×</div>
        `;
        div.addEventListener('click', (e) => {
            if (e.target.classList.contains('fav-del')) return;
            chrome.tabs.create({ url: item.url });
        });
        div.querySelector('.fav-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`删除 "${item.series}"?`)) {
                delete currentFavorites[item.series];
                chrome.storage.local.set({ favorites: currentFavorites });
                renderFavoritesList();
            }
        });
        listDiv.appendChild(div);
    });
}

function renderPresetDropdown() {
    const select = document.getElementById('presetSelect');
    const selectedValue = select.value;
    select.innerHTML = '<option value="">-- 选择或新建 --</option>';
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
        
        // 记得保存新开关
        autoUpdateFav: document.getElementById('autoUpdateFav').checked,

        savedPresets: currentPresets,
        favorites: currentFavorites
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