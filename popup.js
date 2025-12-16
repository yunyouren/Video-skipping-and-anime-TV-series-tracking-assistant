// 1. 当弹窗打开时，从存储中读取之前保存的时间，填入输入框
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['userSkipTime'], (result) => {
        // 如果之前存过，就用存的值；如果没存过，默认显示 90
        const savedTime = result.userSkipTime || 90;
        document.getElementById('skipTime').value = savedTime;
    });
});

// 2. 监听“保存”按钮的点击事件
document.getElementById('saveBtn').addEventListener('click', () => {
    const timeValue = document.getElementById('skipTime').value;
    
    // 把输入的值存入 Chrome 的本地存储
    chrome.storage.local.set({ userSkipTime: parseInt(timeValue) }, () => {
        // 保存成功后，显示一行小字提示
        const status = document.getElementById('status');
        status.textContent = '✅ 设置已保存！';
        setTimeout(() => {
            status.textContent = '';
        }, 1500);
    });
});