// popup.js

const defaultKeys = {
    forward: { code: 'ArrowRight', shift: true, ctrl: false, alt: false, keyName: 'Shift + ArrowRight' },
    rewind: { code: 'ArrowLeft', shift: true, ctrl: false, alt: false, keyName: 'Shift + ArrowLeft' }
};

let tempKeyForward = null;
let tempKeyRewind = null;

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        enableIntro: true,
        enableOutro: true,
        autoRestart: false, // 新增：完播重置开关
        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false,
        keyForward: defaultKeys.forward,
        keyRewind: defaultKeys.rewind
    }, (items) => {
        document.getElementById('autoSkipEnable').checked = items.autoSkipEnable;
        document.getElementById('enableIntro').checked = items.enableIntro;
        document.getElementById('enableOutro').checked = items.enableOutro;
        document.getElementById('autoRestart').checked = items.autoRestart; // 回显
        document.getElementById('autoPlayNext').checked = items.autoPlayNext;

        document.getElementById('introTime').value = items.introTime;
        document.getElementById('outroTime').value = items.outroTime;
        document.getElementById('manualSkipTime').value = items.manualSkipTime;
        document.getElementById('minDuration').value = items.minDuration;
        
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
        input.value = keys.join(' + ');
        saveCallback({ code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, keyName: input.value });
    });
}

document.getElementById('autoSkipEnable').addEventListener('change', (e) => saveSwitch('autoSkipEnable', e.target.checked));
document.getElementById('enableIntro').addEventListener('change', (e) => saveSwitch('enableIntro', e.target.checked));
document.getElementById('enableOutro').addEventListener('change', (e) => saveSwitch('enableOutro', e.target.checked));
// 监听新开关 (即时生效)
document.getElementById('autoRestart').addEventListener('change', (e) => saveSwitch('autoRestart', e.target.checked));

function saveSwitch(key, value) {
    let data = {};
    data[key] = value;
    chrome.storage.local.set(data, () => {
        if(key === 'autoSkipEnable') updateStatusText(value);
        showTempMessage('设置已更新');
    });
}

document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
        autoSkipEnable: document.getElementById('autoSkipEnable').checked,
        enableIntro: document.getElementById('enableIntro').checked,
        enableOutro: document.getElementById('enableOutro').checked,
        autoRestart: document.getElementById('autoRestart').checked, // 保存
        
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