document.addEventListener('DOMContentLoaded', () => {
    // 初始化路由
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    // 加载数据
    loadRules();

    // 绑定事件
    document.getElementById('btnAddRule').addEventListener('click', addRule);
});

// --- 路由逻辑 ---
function handleHashChange() {
    let hash = window.location.hash.substring(1) || 'rules'; // 默认路由
    
    // 简单的路由映射
    const pages = ['rules', 'about'];
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