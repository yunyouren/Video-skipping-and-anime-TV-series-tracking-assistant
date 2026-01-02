// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + →' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ←' }
};

// 内置的默认预设
const defaultPresets = [
    { name: "B站标准番剧 (90s/0s)", intro: 90, outro: 0, restart: false, next: false },
    { name: "网剧/美剧 (120s/30s)", intro: 120, outro: 30, restart: true, next: true },
    { name: "无片头电影 (仅手动)", intro: 0, outro: 0, restart: true, next: false }
];

let tempKeyForward = null;
let tempKeyRewind = null;
let currentPresets = [];

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        // 现有配置
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
        
        // 新增：预设列表
        savedPresets: defaultPresets
    }, (items) => {
        // 1. 回显常规配置
        loadConfigToUI(items);
        
        // 2. 加载预设列表到下拉框
        currentPresets = items.savedPresets;
        renderPresetDropdown();

        // 3. 临时变量
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;
        updateStatusText(items.autoSkipEnable);
    });

    setupKeyRecorder('keyForward', (keyData) => { tempKeyForward = keyData; });
    setupKeyRecorder('keyRewind', (keyData) => { tempKeyRewind = keyData; });
});

// --- 预设管理核心逻辑 ---

// 渲染下拉框
function renderPresetDropdown() {
    const select = document.getElementById('presetSelect');
    select.innerHTML = '<option value="">-- 选择预设 --</option>';
    currentPresets.forEach((preset, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = preset.name;
        select.appendChild(option);
    });
}

// 按钮：应用选中预设
document.getElementById('applyPresetBtn').addEventListener('click', () => {
    const select = document.getElementById('presetSelect');
    const index = select.value;
    if (index === "") return showTempMessage("请先选择一个预设", "red");

    const p = currentPresets[index];
    
    // 将预设值填入 UI
    document.getElementById('introTime').value = p.intro;
    document.getElementById('outroTime').value = p.outro;
    document.getElementById('autoRestart').checked = p.restart;
    document.getElementById('autoPlayNext').checked = p.next;
    
    // 自动开启相关开关，方便使用
    document.getElementById('enableIntro').checked = (p.intro > 0);
    document.getElementById('enableOutro').checked = (p.outro > 0);
    
    // 立即触发一次保存，让配置生效
    document.getElementById('saveBtn').click();
    showTempMessage(`已应用: ${p.name}`);
});

// 按钮：添加当前为新预设
document.getElementById('addPresetBtn').addEventListener('click', () => {
    const name = prompt("请输入新预设的名称 (例如: 爱奇艺电视剧):");
    if (!name) return;

    const newPreset = {
        name: name,
        intro: parseInt(document.getElementById('introTime').value) || 0,
        outro: parseInt(document.getElementById('outroTime').value) || 0,
        restart: document.getElementById('autoRestart').checked,
        next: document.getElementById('autoPlayNext').checked
    };

    currentPresets.push(newPreset);
    savePresetsToStorage();
    renderPresetDropdown();
    // 自动选中新添加的
    document.getElementById('presetSelect').value = currentPresets.length - 1;
});

// 按钮：删除选中预设
document.getElementById('delPresetBtn').addEventListener('click', () => {
    const select = document.getElementById('presetSelect');
    const index = select.value;
    if (index === "") return;

    if (confirm(`确定要删除预设 "${currentPresets[index].name}" 吗?`)) {
        currentPresets.splice(index, 1);
        savePresetsToStorage();
        renderPresetDropdown();
    }
});

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

// 独立开关即时保存
const switches = ['autoSkipEnable', 'enableIntro', 'enableOutro', 'autoRestart', 'autoPlayNext'];
switches.forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
        let data = {};
        data[id] = e.target.checked;
        chrome.storage.local.set(data, () => {
             if(id === 'autoSkipEnable') updateStatusText(e.target.checked);
        });
    });
});

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
        
        // 同时也保存一下预设列表，防止丢失
        savedPresets: currentPresets
    };

    chrome.storage.local.set(config, () => {
        showTempMessage('✅ 配置已生效');
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