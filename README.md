# MusicDance

一款带有实时音频可视化的桌面音乐播放器。支持 Electron 桌面应用和浏览器两种运行模式。

> 💡 **高度可定制的可视化效果**：MusicDance 提供了开放的自定义可视化插件系统！你可以随时让 **AI AGENT** 进入 `.\src\presets` 目录，阅读开发指南与接口文档，为你量身定制独属于自己的音频可视化效果与全屏沉浸动效。

## 功能特性

### 音频播放

- 支持 MP3、WAV、OGG、FLAC、AAC、M4A、WMA、WebM、Opus 等主流音频格式
- 单文件选择、文件夹批量导入、拖放导入三种加载方式
- 上一首 / 下一首 / 播放 / 暂停
- 音量调节（跨会话记忆）
- 播放速度调节：0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x
- 进度条拖拽跳转，悬停显示时间提示

### 播放模式

- **循环模式**：不循环 / 列表循环 / 单曲循环
- **随机播放**：支持历史栈，随机模式下也能正确"上一首"
- **交叉淡入淡出**：曲目切换时 0 / 2 / 3 / 5 秒平滑过渡
- **曲目间自动暂停**：可设置 0 / 3 / 5 / 10 秒间隔（与交叉淡入淡出互斥）
- **自动下一曲**：当前曲目播放结束自动播放下一首

### 歌词系统

- 自动提取内嵌歌词（ID3 USLT / FLAC VORBIS_COMMENT / WAV ID3）
- 自动加载同名 `.lrc` 外部歌词文件
- 支持手动加载 LRC 歌词文件
- 标准 LRC 时间戳解析，当前行高亮滚动

### 音乐库

- 首页音乐库展示，显示封面缩略图、曲目序号、文件名、文件大小
- 实时搜索过滤（按歌名模糊匹配）
- 启动时自动恢复上次打开的文件夹

### 可视化引擎

实时音频可视化是核心特色，采用径向 / 球形设计，包含以下视觉层：

| 层级 | 效果 |
|------|------|
| 背景 | 深色底色，色调随音乐强度从蓝向红渐变 |
| 环境光晕 | 基于封面主色调的漂移径向光晕 |
| 核心光球 | 中央渐变圆，随低频脉冲缩放，颜色随强度变化 |
| 有机膜 | 132 个采样点构成的有机变形轮廓，响应中高频和节拍 |
| 冲击波 | 节拍触发的扩散光环 |
| 装饰环 | 三条虚线同心圆，以不同速度旋转 |
| 径向频谱 | 60 条从中心辐射的频率线，带镜像反射和外轮廓 |
| 粒子系统 | 节拍触发，最大 250 个粒子，带速度、生命衰减和色彩 |
| 节拍闪光 | 高强度节拍时的全屏白色闪烁 |
| 暗角 | 屏幕边缘径向暗化 |

### WebGL 辉光层

- 独立 WebGL 画布叠加，自定义 GLSL 高斯双源辉光着色器
- 两个辉光源独立漂移，使用封面提取的主色调

### 节拍检测

- 基于最低 16 个频率 bin 的低频均值算法
- 输出：低频脉冲、节拍能量、冲击波触发、闪光强度

### 封面与色彩

- 自动提取专辑封面（ID3 APIC / FLAC Picture / WAV ID3）
- 仅读取文件前 2MB，性能友好
- 从封面提取主色调，自动应用于可视化配色

### 设置面板

所有设置跨会话持久化保存：

| 设置项 | 选项 |
|--------|------|
| 循环模式 | 不循环 / 列表循环 / 单曲循环 |
| 随机播放 | 开 / 关 |
| 可视化质量（FFT 大小） | 低 (512) / 中 (1024) / 高 (2048) |
| 自动加载外部歌词 | 开 / 关 |
| 播放速度 | 0.5x ~ 2x |
| 交叉淡入淡出 | 关 / 2s / 3s / 5s |
| 曲目间自动暂停 | 关 / 3s / 5s / 10s |

### 自定义可视化预设

播放器支持在沙箱 iframe 中运行自定义 HTML 预设。播放界面右上角的可视化按钮可切换内置效果、导入的单 HTML 文件或 ZIP 扩展包。桌面版会把默认模板释放到用户数据目录的 `visualizers/` 文件夹；预设资源使用相对路径即可随包分发。

预设开发文档与模板位于 [`src/presets/README.md`](src/presets/README.md)、[`src/presets/boilerplate/`](src/presets/boilerplate/) 和 [`src/presets/wave/`](src/presets/wave/)。预设不应访问宿主 DOM、Electron API 或宿主源码，只通过 `window.$musicDance` SDK 通信。

SDK 当前为 `1.0.0`（帧数据 `schemaVersion: 1`）。事件订阅函数返回取消订阅函数，SDK 提供 `version`、`apiVersion` 和 `capabilities`，帧数据除保留 `frequencyData`/`timeDomainData` 外，还提供归一化频谱、采样率与 bin 频率、RMS/峰值、五段频带能量和节拍信息。字段采用只增不改策略；破坏性协议变更会提升主版本并同步更新模板与文档。

### 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `Escape` | 返回首页 |
| `F11` | 全屏切换（Electron） |

## 运行方式

### 环境要求

- Node.js >= 18

### 浏览器模式（开发）

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`

### Electron 桌面模式（开发）

```bash
npm install
npm run electron:dev
```

### 生产构建

```bash
npm run build          # 仅 Vite 构建
npm run electron:build # 构建 Electron 安装包
```

构建产物：

- Windows：NSIS 安装包
- macOS：DMG
- Linux：AppImage

## 项目结构

```
MusicDance/
├── index.html              # 页面结构
├── main.cjs                # Electron 主进程
├── preload.cjs             # Electron 预加载（IPC 桥接）
├── styles/
│   └── main.css            # 全局样式
├── src/
│   ├── app.js              # 入口，动画循环，窗口控制
│   ├── controls.js         # UI 逻辑、音频加载、播放控制
│   ├── renderer.js         # Canvas 2D 可视化渲染
│   ├── glowlayer.js        # WebGL 辉光层
│   ├── beatdetector.js     # 节拍检测算法
│   ├── particles.js        # 粒子系统
│   ├── lyrics.js           # 歌词提取与解析
│   ├── media.js            # 封面提取与色彩分析
│   ├── playlist.js         # 播放列表数据模型
│   ├── binary-utils.js     # 二进制解析工具（ID3 / FLAC / WAV）
│   └── shims/
│       └── empty.js        # Node.js 模块浏览器端存根
└── package.json
```

## 技术栈

- **前端**：原生 JavaScript + Canvas 2D + WebGL（GLSL）
- **桌面**：Electron 28
- **构建**：Vite 6
- **打包**：electron-builder
- **标签解析**：jsmediatags

## 设计风格

- 深色主题（`#050510`）
- 主色调：蓝 `#4facfe` / 青 `#00f2fe` / 粉 `#fa709a`
- 毛玻璃效果（`backdrop-filter: blur(24px)`）
- 无框架，直接 DOM 操作
- 全中文界面
