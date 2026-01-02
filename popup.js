// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + →' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ←' }
};

// 【关键】默认预设增加 domain 字段
const defaultPresets = [
    { name: "B站标准 (自动)", intro: 90, outro: 0, restart: false, next: false, domain: "bilibili" },
    { name: "爱奇艺 (自动)", intro: 120, outro: 30, restart: true, next: true, domain: "iqiyi" },
    { name: "腾讯视频 (自动)", intro: 110, outro: 15, restart: true, next: true, domain: "v.qq.com" },
    { name: "YouTube (手动)", intro: 0, outro: 0, restart: false, next: false, domain: "youtube" }
];

let tempKeyForward = null;
let tempKeyRewind = null;
let currentPresets = [];

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        enableIntro: true,
        enableOutro: true,
        autoRestart: false,
        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind,
        savedPresets: defaultPresets
    }, (items) => {
        loadConfigToUI(items);
        currentPresets = items.savedPresets;
        renderPresetDropdown();
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;
        updateStatusText(items.autoSkipEnable);
    });

    setupKeyRecorder('keyForward', (keyData) => { tempKeyForward = keyData; });
    setupKeyRecorder('keyRewind', (keyData) => { tempKeyRewind = keyData; });
});

// --- 预设管理 ---

function renderPresetDropdown() {
    const select = document.getElementById('presetSelect');
    const selectedValue = select.value; // 记住当前选中的值
    select.innerHTML = '<option value="">-- 选择或新建 --</option>';
    currentPresets.forEach((preset, index) => {
        const option = document.createElement('option');
        option.value = index;
        // 如果有域名，显示在名字后面
        const domainText = preset.domain ? ` [🔗${preset.domain}]` : '';
        option.textContent = `${preset.name}${domainText}`;
        select.appendChild(option);
    });
    // 尝试恢复选中状态
    if(selectedValue && currentPresets[selectedValue]) {
        select.value = selectedValue;
    }
}

// 监听下拉框变化：自动填充域名输入框
document.getElementById('presetSelect').addEventListener('change', (e) => {
    const index = e.target.value;
    const domainInput = document.getElementById('domainMatch');
    if (index !== "") {
        domainInput.value = currentPresets[index].domain || "";
    } else {
        domainInput.value = "";
    }
});

// 按钮：应用选中预设
document.getElementById('applyPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    if (index === "") return showTempMessage("请先选择一个预设", "red");

    const p = currentPresets[index];
    loadPresetToUI(p);
    
    // 立即保存应用
    document.getElementById('saveBtn').click();
    showTempMessage(`已加载: ${p.name}`);
});

// 按钮：保存/更新预设
document.getElementById('addPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    const domain = document.getElementById('domainMatch').value.trim();
    
    // 如果没有选中现有的，就是新建
    if (index === "") {
        const name = prompt("请输入新预设的名称:");
        if (!name) return;
        const newPreset = createPresetFromUI(name, domain);
        currentPresets.push(newPreset);
    } 
    // 如果选中了现有的，就是更新
    else {
        const p = currentPresets[index];
        if (confirm(`要更新 "${p.name}" 的配置吗?`)) {
            // 保留名字，更新数据
            const updatedPreset = createPresetFromUI(p.name, domain);
            currentPresets[index] = updatedPreset;
        } else {
            return;
        }
    }

    savePresetsToStorage();
    renderPresetDropdown();
    // 选中最后一个（如果是新建）或保持当前选中
    if (index === "") {
        document.getElementById('presetSelect').value = currentPresets.length - 1;
    } else {
        document.getElementById('presetSelect').value = index;
    }
    showTempMessage("预设已保存 ✅");
});

document.getElementById('delPresetBtn').addEventListener('click', () => {
    const index = document.getElementById('presetSelect').value;
    if (index === "") return;
    if (confirm(`删除预设 "${currentPresets[index].name}"?`)) {
        currentPresets.splice(index, 1);
        savePresetsToStorage();
        renderPresetDropdown();
        document.getElementById('domainMatch').value = "";
    }
});

function createPresetFromUI(name, domain) {
    return {
        name: name,
        domain: domain, // 保存域名关键词
        intro: parseInt(document.getElementById('introTime').value) || 0,
        outro: parseInt(document.getElementById('outroTime').value) || 0,
        restart: document.getElementById('autoRestart').checked,
        next: document.getElementById('autoPlayNext').checked,
        // 这里为了简化，不保存按键配置到预设里，只保存时间配置。如果你需要也可以加。
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

function savePresetsToStorage() {
    chrome.storage.local.set({ savedPresets: currentPresets });
}

// --- 通用 UI 逻辑 ---
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

// 保存主配置
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
        savedPresets: currentPresets // 同步保存列表
    };
    chrome.storage.local.set(config, () => {
        showTempMessage('✅ 配置已保存并生效');
    });
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