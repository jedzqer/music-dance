# MusicDance 可视化预设编写指南

本文档指导你（人类或 AI）如何为 MusicDance 编写可视化预设（Preset）。预设本质上是运行在沙箱 iframe 中的一份标准网页，通过宿主注入的 `window.$musicDance` SDK 获取音频数据并实时渲染。

---

## 目录结构

```
src/presets/
├── README.md            ← 本指南
├── AGENTS.md            ← 面向 AI 助手的目录级指导
├── radial.js            ← 径向频谱（核心内置效果的独立参考实现，主程序锁定使用）
├── wave/                ← 波浪线条（外置模板，可删除/修改）
│   ├── index.html
│   └── manifest.json
└── boilerplate/         ← 极简开发示例模板（推荐以此为起点）
    ├── index.html
    └── manifest.json
```

| 预设 | 类型 | 可否删除 |
|------|------|----------|
| 径向频谱 | 内置（锁定） | 否 |
| 波浪线条 | 外置（首次启动释放到用户目录） | 是 |
| 极简示例模板 | 外置 | 是 |

---

## 预设文件规范

一个预设可以是：

### 1. 单 HTML 文件（最简单）
单个 `.html` 文件，所有样式与脚本内联。上传后以文件名作为预设 ID。

### 2. 文件夹 / ZIP 扩展包（推荐，支持资源文件）
```
my-visualizer/
├── index.html          ← 必须，入口文件
├── manifest.json       ← 可选，元数据
├── preview.png         ← 可选，缩略图
└── assets/             ← 可选，字体/图片/着色器等相对路径资源
```

**manifest.json 字段：**

```json
{
  "name": "赛博霓虹",
  "version": "1.0.0",
  "author": "YourName",
  "description": "发光粒子与全屏歌词可视化",
  "icon": "✨"
}
```

> 注意：`id` 由文件夹名决定，无需在 manifest 中声明。`name`/`description`/`author`/`icon` 会显示在软件"可视化风格与管理"面板中。若省略 manifest，面板将使用文件夹名与默认图标。

---

## 运行环境与约束

预设运行在 `<iframe sandbox="allow-scripts allow-same-origin">` 中：

- ✅ 可以使用任意前端技术：Canvas 2D、WebGL、SVG、DOM/CSS 动画。
- ✅ 可以加载相对路径资源（图片、字体、着色器文件）。
- ❌ **不能**访问父页面 DOM、`electronAPI` 或宿主内部模块（如 `renderer.js`）。
- ❌ 不要依赖 `localStorage` 跨会话共享数据（沙箱中不可靠）。
- ⚠️ 渲染循环由你自行驱动：推荐使用 `requestAnimationFrame`，并在 `onFrame` 回调中读取数据绘制。

---

## SDK 完整参考（`window.$musicDance`）

宿主在 iframe 加载完成后注入该全局对象。**建议在脚本开头判断其存在**：

```js
if (window.$musicDance) {
  // ...
}
```

### 一、事件订阅

#### `onFrame(callback)` —— 每帧音频数据（约 60fps）
每帧调用一次，参数为帧对象：

```js
window.$musicDance.onFrame((frame) => {
  const {
    frequencyData,   // Uint8Array (0-255) 频域数据，长度 = fftSize/2（256/512/1024）
    timeDomainData,  // Uint8Array (0-255) 时域波形
    timestamp,       // number，秒
    playback,        // { currentTime, duration, isPlaying, volume(0-1) }
    dimensions       // { width, height, cx, cy, dpr }
  } = frame;
});
```

#### `onTrackChange(callback)` —— 曲目切换
```js
window.$musicDance.onTrackChange((track) => {
  track.title;          // 曲名
  track.artist;         // 艺术家（当前可能为空字符串）
  track.album;          // 专辑（当前可能为空字符串）
  track.coverUrl;       // 封面图 URL（data: 或 blob:，可能为 null）
  track.coverPalette;   // 封面色板 { colors: [主色, 次色?] }，可能为 null
});
```

#### `onLyricsUpdate(callback)` —— 歌词同步高亮
```js
window.$musicDance.onLyricsUpdate((lyrics) => {
  lyrics.currentLine;   // 当前句文本
  lyrics.currentIndex;  // 当前句索引（-1 表示无）
  lyrics.lines;         // 全部歌词 [{ time: 秒, text: string }]
});
```

#### `onStateChange(callback)` —— 播放状态变化
```js
window.$musicDance.onStateChange((state) => {
  state.isPlaying;   // boolean
  state.volume;      // 0-1
});
```

### 二、反向控制（制作自定义播放控件）

```js
window.$musicDance.controls.play();               // 播放（若已播放则无操作）
window.$musicDance.controls.pause();              // 暂停（若已暂停则无操作）
window.$musicDance.controls.togglePlay();         // 播放/暂停切换
window.$musicDance.controls.next();               // 下一首
window.$musicDance.controls.prev();               // 上一首
window.$musicDance.controls.seek(120);            // 跳转到 120 秒
window.$musicDance.controls.setVolume(0.8);       // 音量 0-1
```

### 三、原生 UI 接管

**原生 UI 默认全部显示**。若你的预设需要全屏沉浸接管，调用：

```js
window.$musicDance.ui.setNativeUI({
  controls: false,     // 隐藏底部控制栏
  lyrics: false,       // 隐藏歌词面板
  progressBar: false,  // 隐藏进度条
  coverArt: false      // 隐藏悬浮封面
});
```

- 未列出的项保持默认可见（`true`）。
- 切换预设或返回主页时，原生 UI 自动恢复全部显示。
- 无论隐藏多少 UI，用户按 `Esc` 始终能返回主页，不会被困在界面中。

---

## 编写要点与性能建议

1. **以 `boilerplate/index.html` 为起点**，它包含柱状频谱 + 歌词 + 封面色板的最小完整示例。
2. **60fps 是硬指标**：`onFrame` 内的计算与绘制应轻量；避免每帧创建大对象、字符串拼接、频繁 DOM 操作。粒子数建议上限 200-300。
3. **善用 `dimensions`**：窗口大小变化由你自行监听 `window.resize`，读取 `frame.dimensions` 或直接使用 `window.innerWidth/Height`。
4. **颜色推荐取自 `track.coverPalette.colors`**，可让效果与封面主题一致。
5. **频率分布**：`frequencyData` 前段为低频（低音鼓点），后段为高频。低音 bin 通常取前 16 个。
6. **降级处理**：`frequencyData` 可能为空数组（未播放时），`coverPalette`/`coverUrl` 可能为 `null`，请做好空值兜底，保证预设"静置"时依然美观。
7. 若引用了外部 CDN 资源，注意离线环境下无法加载——优先内联或使用相对路径。

---

## 安装与测试

1. **开发中**：直接编辑 `src/presets/<name>/index.html` 后，在软件面板点击"刷新"。
2. **桌面端安装**：
   - 通过软件面板"导入"按钮选择 `.zip` 或 `.html`；或
   - 将文件夹复制到用户数据目录的 `visualizers/` 下（Windows 通常为 `%APPDATA%\MusicDance\visualizers\`，开发模式可能为 `%APPDATA%\music-dance\visualizers\`），再点击"刷新"。
3. **浏览器模式**：面板"导入"仅支持单 `.html` 文件（ZIP 需桌面端）。

## 常见问题

| 问题 | 原因与解决 |
|------|-----------|
| 预设空白无反应 | 未判断 `window.$musicDance` 是否存在，或脚本报错；打开 DevTools 查看 iframe 控制台 |
| 颜色不随封面变化 | 未在 `onTrackChange` 中读取 `coverPalette` |
| 高 CPU/掉帧 | `onFrame` 内计算过重，或未使用 `requestAnimationFrame` 节流 DOM 更新 |
| 原生 UI 不显示 | 上一预设调用了 `setNativeUI` 隐藏；切换预设会自动恢复，或手动调用 `setNativeUI({})` |
