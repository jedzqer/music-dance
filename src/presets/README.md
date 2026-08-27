# MusicDance 可视化预设开发指南

本文档指导开发者与 **AI AGENT** 如何为 MusicDance 制作独具特色的可视化预设（Preset）。预设本质上是运行在沙箱 iframe 中的标准 Web 页面，通过宿主注入的 `window.$musicDance` SDK 获取高质量音频特征并实时渲染。

> 📖 **快速导航**：
> - [详细接口清单与全景文档 (API.md)](./API.md) — 逐项查看 SDK 暴露的全部属性、每帧细分指标、事件与反向控制方法。
> - [AI 助手协作指南 (AGENTS.md)](./AGENTS.md) — 了解预设目录职责、约束与最佳实践。
> - [极简全面示例模板 (boilerplate/)](./boilerplate/) — 包含几乎所有 SDK 功能演示的脚手架代码。

---

## 目录结构

```
src/presets/
├── README.md            ← 本指南（架构、规范与开发指引）
├── API.md               ← 宿主暴露的所有接口逐项详细文档
├── AGENTS.md            ← 面向 AI 助手的目录级指导
├── radial.js            ← 径向频谱（核心内置效果的独立参考实现，主程序锁定使用）
├── wave/                ← 波浪线条（外置模板示例，可删除/修改）
│   ├── index.html
│   └── manifest.json
└── boilerplate/         ← 完整功能示例模板（推荐以此为起点）
    ├── index.html
    └── manifest.json
```

| 预设 | 类型 | 可否删除 | 说明 |
|------|------|----------|------|
| 径向频谱 | 内置（锁定） | 否 | 核心内置视觉实现参考 |
| 波浪线条 | 外置模板 | 是 | 动态波浪与节拍粒子效果示例 |
| 示例模板 (boilerplate) | 外置模板 | 是 | 覆盖全部 SDK 接口特性的全面示例 |

---

## 预设文件规范

预设支持以下两种形式分发与运行：

### 1. 单 HTML 文件（快速轻量）
单个 `.html` 文件，所有样式与脚本内联。在播放器中点击“导入”即可加载。

### 2. 文件夹 / ZIP 扩展包（推荐，支持多资源）
```
my-visualizer/
├── index.html          ← 必须，入口页面
├── manifest.json       ← 可选，元数据描述文件
├── preview.png         ← 可选，效果预览缩略图
└── assets/             ← 可选，字体/图片/着色器等相对路径静态资源
```

**manifest.json 规范：**

```json
{
  "name": "赛博霓虹",
  "version": "1.0.0",
  "author": "YourName",
  "description": "发光粒子与全屏歌词可视化",
  "icon": "✨"
}
```

> 💡 **提示**：预设 `id` 由文件夹名决定。`manifest.json` 中的字段会展示在播放器“可视化风格与管理”面板中。如果未提供 manifest，面板会自动采用文件夹名称和默认图标。

---

## 运行环境与安全约束

预设运行在 `<iframe sandbox="allow-scripts allow-same-origin">` 安全沙箱中：

- ✅ **支持任意现代 Web 前端技术**：Canvas 2D、WebGL、Three.js、PixiJS、SVG、CSS3 3D、Web Audio API 等。
- ✅ **支持相对路径资源加载**：可引用同目录下的图片、3D 模型、音频或着色器文件。
- ❌ **隔离约束**：预设无法直接访问父页面 DOM、`electronAPI` 或宿主内部私有模块，只能通过 `window.$musicDance` 与宿主进行安全的单向/双向交互。
- ⚠️ **初始化标准写法**：

```javascript
function init() {
  if (!window.$musicDance || window.__presetStarted) return;
  window.__presetStarted = true;
  
  // 注册音频帧监听，由宿主渲染管线驱动
  window.$musicDance.onFrame(frame => {
    // 绘图逻辑...
  });
}

if (window.$musicDance) {
  init();
} else {
  window.addEventListener('musicdance-ready', init, { once: true });
}
```

---

## SDK 核心功能速查

详细的数据结构定义、字段范围与子对象请查阅 [**API.md 接口参考文档**](./API.md)。

### 1. 核心事件订阅

```javascript
// 每帧高频音频数据（约 60 ~ 144fps）
const unsubscribeFrame = window.$musicDance.onFrame((frame) => {
  const { frequencyData, timeDomainData, frequency, bands, beat, playback, dimensions } = frame;
  // bands: { bass, lowMid, mid, highMid, treble, energy }
  // beat: { hit, pulse, energy }
});

// 曲目切换与封面色调
window.$musicDance.onTrackChange((track) => {
  const { title, artist, album, coverUrl, coverPalette } = track;
});

// 实时歌词高亮更新
window.$musicDance.onLyricsUpdate((lyrics) => {
  const { currentLine, currentIndex, lines } = lyrics;
});

// 播放器状态（播放/暂停/音量）
window.$musicDance.onStateChange((state) => {
  const { isPlaying, volume } = state;
});
```

### 2. 反向播放控制 (`controls`)

预设可内置沉浸式交互手势或自定义控制器：

```javascript
window.$musicDance.controls.play();         // 开始播放
window.$musicDance.controls.pause();        // 暂停播放
window.$musicDance.controls.togglePlay();   // 播放/暂停切换
window.$musicDance.controls.next();         // 下一曲
window.$musicDance.controls.prev();         // 上一曲
window.$musicDance.controls.seek(60);       // 跳转到指定秒数
window.$musicDance.controls.setVolume(0.8); // 调节音量 (0~1)
```

### 3. 原生 UI 接管 (`ui.setNativeUI`)

如果想实现纯净无干扰的全屏体验，可调用原生 UI 控制接口隐藏宿主默认部件（切换预设或按 `Esc` 会自动恢复）：

```javascript
window.$musicDance.ui.setNativeUI({
  controls: false,     // 隐藏底部控制栏
  lyrics: false,       // 隐藏右侧歌词面板
  progressBar: false,  // 隐藏底部进度条
  coverArt: false      // 隐藏左上角专辑封面部件
});
```

---

## 开发建议与性能优化

1. **起点推荐**：建议从 [`boilerplate/index.html`](./boilerplate/index.html) 起步，它集成了频谱条、波形图、五频段能量球、歌词、节拍粒子、封面色彩和反向控制等全量功能。
2. **60 FPS 流畅保障**：
   - 避免在 `onFrame` 内执行 DOM 操作（`innerHTML` 等）、频繁创建大对象或字符串拼接。
   - 粒子数量建议控制在 200 ~ 500 以内；大数量渲染建议使用 WebGL / Instanced Mesh。
3. **自适应视口**：
   - 预设应监听 `window.addEventListener('resize', ...)` 并根据 `frame.dimensions` 调整 Canvas 分辨率与高分屏 DPR。
4. **容错与空值兜底**：
   - 音乐暂停或静音时，`frequencyData` 数组可能全为 0。
   - 当无封面时，`coverPalette` 为 `null`。请确保有优雅的默认底色与待机动画。

---

## 安装、调试与测试

1. **开发中调试**：直接编辑 `src/presets/<name>/index.html`，在播放器右上角点击“可视化”并在管理面板点击“刷新”即可热重载。按 `F12` 打开 DevTools 可定位 iframe 控制台日志。
2. **桌面端安装到用户目录**：
   - 将预设文件夹复制到用户数据目录下的 `visualizers/` 目录（Windows: `%APPDATA%\MusicDance\visualizers\`）；或
   - 在播放器管理面板点击“导入”选择 `.zip` 或 `.html` 文件。
3. **构建验证**：运行 `npm run build` 确保宿主构建正常。
