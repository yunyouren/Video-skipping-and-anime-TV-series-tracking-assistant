// popup.js

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        autoSkipEnable: false,
        introTime: 90,
        outroTime: 0,
        manualSkipTime: 90,
        minDuration: 300,
        autoPlayNext: false // 新增字段
    }, (items) => {
        document.getElementById('autoSkipEnable').checked = items.autoSkipEnable;
        document.getElementById('introTime').value = items.introTime;
        document.getElementById('outroTime').value = items.outroTime;
        document.getElementById('manualSkipTime').value = items.manualSkipTime;
        document.getElementById('minDuration').value = items.minDuration;
        document.getElementById('autoPlayNext').checked = items.autoPlayNext; // 回显
        
        updateStatusText(items.autoSkipEnable);
    });
});

// 监听主开关
document.getElementById('autoSkipEnable').addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ autoSkipEnable: isEnabled }, () => {
        updateStatusText(isEnabled);
        showTempMessage(isEnabled ? '✅ 已开启自动跳过' : '🛑 已关闭自动跳过');
    });
});

// 保存所有设置
document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
        autoSkipEnable: document.getElementById('autoSkipEnable').checked, 
        introTime: parseInt(document.getElementById('introTime').value) || 0,
        outroTime: parseInt(document.getElementById('outroTime').value) || 0,
        manualSkipTime: parseInt(document.getElementById('manualSkipTime').value) || 90,
        minDuration: parseInt(document.getElementById('minDuration').value) || 0,
        autoPlayNext: document.getElementById('autoPlayNext').checked // 保存切集开关
    };

    chrome.storage.local.set(config, () => {
        showTempMessage('✅ 所有设置已保存');
    });
});

function updateStatusText(isEnabled) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv.dataset.tempMessage) {
        statusDiv.textContent = isEnabled ? '当前状态: 运行中 🟢' : '当前状态: 已停用 ⚫';
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