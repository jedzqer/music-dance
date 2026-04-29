# 音乐可视化

一个音乐可视化播放器，支持浏览器端和 Electron 桌面端。选择或拖放本地音频文件播放，根据音频频谱绘制动态 Canvas 视觉效果，并展示播放控制、进度条、音量控制、专辑封面、内嵌歌词和不同播放器布局样式。

## 功能

- 本地音频文件选择与拖放播放
- Canvas 音乐频谱与粒子动效可视化
- 播放 / 暂停、音量调节、进度拖动
- 读取音频内嵌封面并提取主题色
- 读取并展示内嵌歌词，支持 LRC 时间轴高亮
- 两种播放器布局样式切换
- Electron 桌面端：打开本地文件夹、扫描音乐列表、上一首/下一首

## 运行方法

浏览器端（开发）：

```bash
npm install
npm run dev
```

Electron 桌面端（开发）：

```bash
npm install
npm run electron:dev
```

构建 Electron 安装包：

```bash
npm run electron:build
```

构建纯前端版本：

```bash
npm run build
npm run preview
```

## 技术栈

- **构建工具**: Vite
- **桌面端**: Electron
- **音频分析**: Web Audio API
- **可视化**: Canvas 2D + WebGL（光晕层）
- **元数据解析**: jsmediatags (npm)

## 文件结构

```text
.
├── index.html            # 页面入口
├── main.cjs              # Electron 主进程 (CommonJS)
├── preload.cjs           # Electron 预加载脚本 (CommonJS)
├── package.json          # npm 脚本与开发依赖
├── vite.config.js        # Vite 构建配置
├── styles/
│   └── main.css          # 页面样式与布局
├── src/
│   ├── app.js            # 入口：动画循环与 Canvas 尺寸
│   ├── controls.js       # 播放控制、进度条、文件加载、歌词、封面
│   ├── playlist.js       # 播放列表管理
│   ├── renderer.js       # Canvas 可视化渲染
│   ├── glowlayer.js      # WebGL 光晕叠加层
│   ├── beatdetector.js   # 节拍检测与冲击波效果
│   ├── particles.js      # 粒子系统
│   ├── lyrics.js         # 内嵌歌词读取与解析
│   ├── media.js          # 专辑封面读取与主题色提取
│   ├── riff.js           # RIFF/WAV 数据块读取
│   ├── utils.js          # 通用工具函数
│   └── shims/
│       └── empty.js      # Node.js 模块空垫片（供 Vite 构建用）
├── dist/                 # Vite 构建输出目录
└── release/              # Electron 打包输出目录
```
