# AGENTS.md（可视化预设目录）

本文件为本目录（`src/presets/`）的 AI 辅助指导，配合仓库根目录的 `AGENTS.md` 阅读。当你被要求编写、修改或审查 MusicDance 可视化预设时，请遵守以下约定。

## 本目录职责

`src/presets/` 存放 MusicDance 的全部可视化预设（Preset）：

- `radial.js` — 径向频谱的独立参考实现（内置锁定，主程序实际渲染走 `src/renderer.js`，此文件仅作参考）。**不要删除或将其改为外置可删模板。**
- `wave/` — 波浪线条外置模板（`index.html` + `manifest.json`）。
- `boilerplate/` — 极简开发示例模板，是新预设的推荐起点。

## 核心契约（必须遵守）

1. **预设是独立网页**：每个预设是运行在沙箱 iframe（`sandbox="allow-scripts allow-same-origin"`）中的自包含 HTML 文件。不得 import/引用宿主源码模块（`renderer.js`、`beatdetector.js`、`controls.js` 等），不得访问父页 DOM 或 `window.electronAPI`。
2. **数据唯一入口是 `window.$musicDance` SDK**，宿主在 iframe 加载后注入。SDK 完整参考见同目录 `README.md`。脚本开头应判断 `if (window.$musicDance)`。
3. **渲染循环自驱**：使用 `requestAnimationFrame` 驱动，`onFrame` 回调中读取数据。不要在 `onFrame` 之外另起高频定时器重复读取。
4. **原生 UI 默认可见**：如需全屏接管才调用 `ui.setNativeUI({...})`；未列出的项保持可见。预设不应假定 UI 已被隐藏。
5. **空值兜底**：`frequencyData` 可能为空、`coverPalette`/`coverUrl` 可能为 `null`、歌词可能不存在。预设必须在无音乐时也能优雅显示（如静止的默认画面），不得抛错。

## 文件规范

- 每个预设至少包含 `index.html`（入口）；`manifest.json` 可选（`name`/`version`/`author`/`description`/`icon`），`id` 由目录名决定。
- 资源文件（图片/字体/着色器）使用相对路径引用，随目录一起发布。
- 用户可见文案使用简体中文。
- 保持 vanilla JS 风格（无框架），与仓库其余代码一致。

## 性能要求

- `onFrame` 回调内每帧执行；保持 60fps，避免：每帧大对象分配、`JSON.stringify`、DOM 写入、无上限数组增长。
- 粒子/元素数量设置合理上限（参考：粒子 ≤ 250，线条 ≤ 128 段）。
- 优先使用 `ctx` 缓冲绘制（渐变、阴影重绘开销大，注意缓存）。

## 修改既有预设

- 修改 `wave/` 或 `boilerplate/` 时保持其"教学/参考"性质：示例代码应注释清晰、按步骤组织。
- 修改 SDK 或宿主侧行为（`src/visualizerManager.js`、`src/app.js` 的帧数据结构）时，必须同步更新 `README.md` 中的 SDK 参考，保证文档与实现一致。
- 若新增内置预设目录，需同步在仓库根 `AGENTS.md`（如涉及）及本目录 README 的目录树中登记。

## 测试方式

- 浏览器：`npm run dev`（端口 5173），打开面板导入单 HTML 预设。
- 桌面：`npm run electron:dev`，或用面板"导入"/"打开效果文件夹"安装到 `visualizers/`。
- 修改预设后无需重建，面板中点击"刷新"即可重新加载列表。
- 构建验证：`npm run build`（保证宿主改动未破坏打包）。
