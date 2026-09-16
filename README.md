# ⚡ 视频跳略与追番追剧助手 (Video Skipper & Tracker)

[![Manifest Version](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/Version-4.4-green?style=flat-square)](manifest.json)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**全能视频跳略与追番助手** 是一款专为 Bilibili 及主流视频网站打造的 Chrome/Edge 浏览器扩展。它不仅能帮你自动跳过繁琐的片头片尾，还能像私人管家一样记录你的追番进度，让你享受无缝丝滑的观影体验。

无论你是追更日漫、补习老剧，还是在各类小众影视站观看视频，本插件都能通过强大的**自定义规则**和**策略匹配**，为你提供一致的沉浸式体验。

---

## 📥 下载安装 (Install)

| 平台 | 商店链接 | 说明 |
| :--- | :--- | :--- |
| **Edge** | [![Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-Get_It-0078D7?style=for-the-badge&logo=microsoft-edge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/%E8%A7%86%E9%A2%91%E8%B7%B3%E7%95%A5%E4%B8%8E%E8%BF%BD%E7%95%AA%E8%BF%BD%E5%89%A7%E5%8A%A9%E6%89%8B/ajnkagecdedklgmfmmglfhohheipglfd) | **推荐**，审核更新最快 |
| **Chrome** | [![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Get_It-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/%E8%A7%86%E9%A2%91%E8%B7%B3%E7%95%A5%E4%B8%8E%E8%BF%BD%E7%95%AA%E8%BF%BD%E5%89%A7%E5%8A%A9%E6%89%8B/pmbggejjcjmeolnopeaoaimphaamhkbi?hl=zh-CN&authuser=0) | 官方商店 |

---

## ✨ 核心功能 (Core Features)

### 🎬 智能观影体验
*   **精准跳过**: 自定义 **片头 (Intro)** 和 **片尾 (Outro)** 的跳过时长（精确到秒）。
*   **智能防误判**: 支持设置**最短视频时长**（如 300秒），避免误伤短视频。
*   **自动连播**: 触发跳过片尾时，自动寻找并点击网页上的“下一集”按钮，释放双手。
*   **断点续播**: 打开未看完的视频，自动恢复到上次播放位置；若已接近看完，则自动重头开始。

### 🔖 追番追剧神器
*   **进度同步**: 实时记录观看进度（集数与时间），本地存储，安全隐私。
*   **一键续看**: 在插件面板直接点击番剧名，跳转至上次观看的精确秒数（支持 B站 `t=xx` 参数）。
*   **文件夹管理**: 创建“日漫”、“美剧”等文件夹分类管理你的收藏。
*   **进度保护**: 支持“仅记录最大集数”模式，防止重温旧集数时覆盖最新进度。
*   **数据备份**: 两个管理入口使用相同的 JSON 备份格式，也可读取旧版备份；同名记录保留较新的进度。

### ⚙️ 高级自定义 (Advanced)
*   **收藏独立设置**: 每部收藏独立保存跳过总开关、片头/片尾开关和时长、短视频阈值、自动下一集和完播重播。默认白名单模式仅对收藏执行自动跳过。
*   **自定义站点规则**: 在**选项页面**配置域名关键词，强制修正站点名称（解决 Iframe 嵌套导致的识别问题）。
*   **自定义番剧规则**: 通过关键词匹配，自动净化或修正番剧标题。

### ⌨️ 快捷控制
*   **网页内快捷键**: 默认 `Shift + →` 快进，`Shift + ←` 快退（步长可调）。
*   **输入保护**: 在输入框或可编辑文字中输入时，不拦截快进/快退快捷键。

---

## 📖 使用手册 (User Guide)

### 1. 基础面板 (Popup)
点击浏览器右上角的插件图标打开控制面板：
*   **开关控制**: 白名单模式下修改当前收藏的开关；关闭白名单后控制全局自动跳过。
*   **时长设置**: 输入 Intro/Outro 秒数。
*   **收藏管理**: 点击 `+ 收藏当前` 将当前视频加入追番列表。v4.7 支持置顶、最近观看/名称排序；弹窗内列表保持稳定，点击“刷新排序”或重新打开后重排。
*   **快捷定位**: “设为片头结束”和“设为片尾开始”读取当前播放位置，片尾自动换算成距结尾秒数；遵循合集默认或当前单集设置范围。
*   **插件内选集**: 收藏上点击“选集”展开已识别目录和每集状态。首次打开合集视频播放后会缓存目录；旧版没有保存的逐集历史无法补回。已看完按播放位置估算（达到95%或剩余不足30秒）。
*   **故障反馈**: 点击“复制故障诊断信息”，可检查并复制版本、站点域名、识别结果和保存状态；不会自动向外发送。
*   **B站合集**: 在视频合集页面收藏一次，后续同合集不同视频更新同一收藏；按标题中的实际集数记录，默认关闭片头片尾跳过。可勾选“仅设置当前这一集”覆盖合集默认参数。自动下一集只匹配当前合集中的下一话，不跳推荐视频。
*   **旧收藏升级**: 重新打开原来收藏的视频后，播放进度保存时会关联识别到的合集；保留旧设置。已有重复收藏不会自动删除，不同合集不会自动合并。
*   **自动保存**: 修改即生效，无需额外保存。先收藏当前视频，再为这部作品设置独立参数。

### 2. 高级设置 (Options Page)
右键点击插件图标 -> `选项 (Options)`，或在扩展管理页点击 `选项` 进入高级设置页：
*   **收藏管理 (Favorites Manager)**: 
    *   查看所有观看记录，支持按文件夹筛选。
    *   支持导出备份、导入恢复、批量清空。
*   **站点标签规则 (Site Tags)**: 
    *   *场景*: 某些小众网站使用 Iframe 播放器，导致插件识别为 "Web"。
    *   *解决*: 添加规则 `域名包含: yhdmp` -> `显示名称: 樱花`，即可强制识别。
*   **番剧名称规则 (Series Rules)**:
    *   *场景*: 网页标题包含大量广告后缀，影响收藏列表美观。
    *   *解决*: 添加规则 `标题包含: 鬼灭之刃` -> `重命名为: 鬼灭`。

---

## 🛠️ 权限与隐私 (Privacy)

本扩展坚持 **Local First** 原则，所有数据均存储在您的浏览器本地 (`chrome.storage.local`)，不上传任何服务器。

*   `storage`: 保存您的设置和追番进度。
*   `tabs`: 检测当前视频状态以执行跳转。
*   `host_permissions (<all_urls>)`: 确保插件能在所有视频网站上运行，不仅仅是 Bilibili。

---

## 📝 开发说明

本项目基于 **Manifest V3** 标准开发，轻量高效。

*   `content.js`: 核心逻辑（DOM 监听、时间控制、Shadow DOM 支持）。
*   `background.js`: 后台消息处理，串行合并收藏操作，避免多个页面互相覆盖。
*   `tracker-core.js`: 收藏身份、备份校验、旧格式兼容及共用设置规则。
*   `options.html`: 高级规则配置页。

验证：`node --test tests/regression.test.cjs`。可选浏览器验证：安装 Playwright 及其 Chromium 后运行 `node tests/browser-smoke.cjs`。

打包：运行 `python pack_extension.py` 或 `./pack_extension.ps1`，二者均读取 manifest 版本并包含语言文件。

兼容性边界：基于 HTML5 媒体元素，下一集依赖网站按钮；真实站点更新、广告及特殊播放器需逐站验证。数据保存在本地，不提供新集更新提醒或跨设备自动同步。

欢迎提交 Issue 反馈 bug 或建议！

---

## 📄 License

[MIT License](LICENSE)
