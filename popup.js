// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + ArrowRight' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ArrowLeft' }
};

let tempKeyForward = null;
let tempKeyRewind = null;

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false, // 总开关
        enableIntro: true,     // 新增：片头独立开关 (默认开)
        enableOutro: true,     // 新增：片尾独立开关 (默认开)
        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind
    }, (items) => {
        // 回显开关状态
        document.getElementById('autoSkipEnable').checked = items.autoSkipEnable;
        document.getElementById('enableIntro').checked = items.enableIntro;
        document.getElementById('enableOutro').checked = items.enableOutro;
        document.getElementById('autoPlayNext').checked = items.autoPlayNext;

        // 回显数值
        document.getElementById('introTime').value = items.introTime;
        document.getElementById('outroTime').value = items.outroTime;
        document.getElementById('manualSkipTime').value = items.manualSkipTime;
        document.getElementById('minDuration').value = items.minDuration;
        
        // 回显快捷键
        document.getElementById('keyForward').value = items.keyForward.keyName;
        document.getElementById('keyRewind').value = items.keyRewind.keyName;
        
        tempKeyForward = items.keyForward;
        tempKeyRewind = items.keyRewind;

        updateStatusText(items.autoSkipEnable);
    });

    setupKeyRecorder('keyForward', (keyData) => { tempKeyForward = keyData; });
    setupKeyRecorder('keyRewind', (keyData) => { tempKeyRewind = keyData; });
});

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
        const keyName = keys.join(' + ');
        input.value = keyName;
        const keyData = { code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, keyName: keyName };
        saveCallback(keyData);
    });
}

// 监听总开关 (即时生效)
document.getElementById('autoSkipEnable').addEventListener('change', (e) => {
    saveSwitch('autoSkipEnable', e.target.checked);
});

// 监听片头独立开关 (即时生效)
document.getElementById('enableIntro').addEventListener('change', (e) => {
    saveSwitch('enableIntro', e.target.checked);
});

// 监听片尾独立开关 (即时生效)
document.getElementById('enableOutro').addEventListener('change', (e) => {
    saveSwitch('enableOutro', e.target.checked);
});

// 辅助：单独保存开关函数
function saveSwitch(key, value) {
    let data = {};
    data[key] = value;
    chrome.storage.local.set(data, () => {
        if(key === 'autoSkipEnable') updateStatusText(value);
        showTempMessage('设置已更新');
    });
}

// 保存所有设置
document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
        autoSkipEnable: document.getElementById('autoSkipEnable').checked,
        enableIntro: document.getElementById('enableIntro').checked, // 保存片头开关
        enableOutro: document.getElementById('enableOutro').checked, // 保存片尾开关
        
        introTime: parseInt(document.getElementById('introTime').value) || 0,
        outroTime: parseInt(document.getElementById('outroTime').value) || 0,
        manualSkipTime: parseInt(document.getElementById('manualSkipTime').value) || 90,
        minDuration: parseInt(document.getElementById('minDuration').value) || 0,
        autoPlayNext: document.getElementById('autoPlayNext').checked,
        
        keyForward: tempKeyForward || defaultKeys.forward,
        keyRewind: tempKeyRewind || defaultKeys.rewind
    };

    chrome.storage.local.set(config, () => {
        showTempMessage('✅ 所有设置已保存');
    });
});

function updateStatusText(isEnabled) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv.dataset.tempMessage) {
        statusDiv.textContent = isEnabled ? '状态: 运行中 🟢' : '状态: 已停用 ⚫';
        statusDiv.style.color = isEnabled ? 'green' : '#666';
    }
}

function showTempMessage(msg) {
    const statusDiv = document.getElementById('status');
    statusDiv.dataset.tempMessage = 'true';
    statusDiv.textContent = msg;
    statusDiv.style.color = '#00aeec';
    setTimeout(() => {
        delete statusDiv.dataset.tempMessage;
        const isEnabled = document.getElementById('autoSkipEnable').checked;
        updateStatusText(isEnabled);
    }, 1500);
}