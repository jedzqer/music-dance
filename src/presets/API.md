# MusicDance SDK 接口完整参考 (API Reference)

本文档面向开发者及 **AI AGENT**，逐项详细描述 MusicDance 宿主环境向自定义可视化预设（Preset）暴露的所有接口、事件、数据结构以及反向控制方法。

---

## 1. 概览与运行机制

预设运行在带有沙箱保护的 `<iframe>` 中（`sandbox="allow-scripts allow-same-origin"`）。
宿主在预设加载完成后自动注入全局对象：

```javascript
window.$musicDance
```

### 初始化与生命周期

在页面加载时，可以通过检查 `window.$musicDance` 或监听 `musicdance-ready` 事件完成注册：

```javascript
function initVisualizer() {
    if (!window.$musicDance || window.__presetStarted) return;
    window.__presetStarted = true;

    // 订阅音频帧、曲目信息、歌词与状态
    window.$musicDance.onFrame((frame) => { /* 渲染逻辑 */ });
    window.$musicDance.onTrackChange((track) => { /* 曲目元数据 */ });
    window.$musicDance.onLyricsUpdate((lyrics) => { /* 歌词同步 */ });
    window.$musicDance.onStateChange((state) => { /* 播放状态 */ });
}

if (window.$musicDance) {
    initVisualizer();
} else {
    window.addEventListener('musicdance-ready', initVisualizer, { once: true });
}
```

---

## 2. 全局对象属性 (`window.$musicDance`)

| 属性名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `version` | `string` | SDK 当前版本号（当前固定为 `"2.0.0"`） |
| `apiVersion` | `number` | API 架构版本（当前为 `2`） |
| `capabilities` | `Object` | 宿主支持的能力特性标识集合（只读冻结对象） |
| `controls` | `Object` | 反向播放控制接口集合（见后文第 4 节） |
| `ui` | `Object` | 宿主原生 UI 显示/接管控制（见后文第 5 节） |
| `onFrame` | `Function` | 订阅音频帧数据事件 |
| `onTrackChange` | `Function` | 订阅曲目切换及封面色彩事件 |
| `onLyricsUpdate` | `Function` | 订阅实时歌词同步事件 |
| `onStateChange` | `Function` | 订阅播放状态（播放/暂停/音量）变更事件 |

### `capabilities` 结构

```javascript
{
    frame: true,         // 是否支持每帧音频数据通知
    trackChange: true,   // 是否支持曲目切换通知
    lyricsUpdate: true,  // 是否支持歌词更新通知
    stateChange: true,   // 是否支持播放状态通知
    controls: true,      // 是否支持反向控制（播放/暂停/切歌/跳转/调音量）
    nativeUI: true,      // 是否支持接管隐藏原生 UI 组件
    settingsButton: true,// 是否支持注册自定义设置按钮
    frameSchema: 1       // 音频帧 Schema 版本号
}
```

---

## 3. 事件订阅接口

所有订阅方法均支持传入一个回调函数，并**返回一个用于取消订阅的函数**（`() => void`）。

### 3.1 `onFrame(callback)` —— 逐帧音频数据

每帧由宿主渲染循环驱动（通常为 60fps ~ 144fps），回调接收一个 `frame` 对象。

> ⚠️ **注意**：`frequencyData`、`timeDomainData` 及 `frequency.normalized` 为底层复用的 TypedArray。请在回调同步执行周期内读取，切勿异步持有或跨帧修改。

```javascript
const unsubscribeFrame = window.$musicDance.onFrame((frame) => {
    // 渲染绘制逻辑
});
```

#### `frame` 参数完整字段定义：

| 字段名 | 类型 | 说明与范围 |
| :--- | :--- | :--- |
| `schemaVersion` | `number` | 帧数据协议版本，当前为 `1` |
| `timestamp` | `number` | 当前时间戳（高精度秒数，源自 `performance.now() * 0.001`） |
| `audioTime` | `number` | 当前音频播放的时间点（秒数，`currentTime`） |
| `frequencyData` | `Uint8Array` | 原始频谱字节数组，数值范围 `0 ~ 255`。未播放或静音时可能全为 0 |
| `timeDomainData` | `Uint8Array` | 原始时域波形数据，数值范围 `0 ~ 255`，中心基准线为 `128` |
| `frequency` | `Object` | 细分频谱分析对象（见下表） |
| `timeDomain` | `Object` | 时域特征指标对象（见下表） |
| `bands` | `Object` | 预计算好的五频段能量及全频总能量（见下表） |
| `beat` | `Object` | 实时节拍与节奏脉冲检测结果（见下表） |
| `playback` | `Object` | 当前播放状态快照（见下表） |
| `dimensions` | `Object` | 宿主视口尺寸与像素比（见下表） |

---

#### 详细子对象定义：

#### ① `frame.frequency`
- `values` (`Uint8Array`): 等同于 `frequencyData`。
- `normalized` (`Float32Array`): 归一化频谱数组，数值区间 `0.0 ~ 1.0`（即 `value / 255`）。
- `fftSize` (`number`): 当前 AnalyserNode 的 FFT 采样点大小（例如 512, 1024, 2048）。
- `binCount` (`number`): 频点总数（即 `fftSize / 2`）。
- `sampleRate` (`number`): Web Audio 上下文采样率（常见为 44100 或 48000 Hz）。
- `binHz` (`number`): 单个频点代表的频率宽度（Hz），计算公式为 `sampleRate / fftSize`。

#### ② `frame.timeDomain`
- `values` (`Uint8Array`): 等同于 `timeDomainData`。
- `rms` (`number`): 时域均方根能量（Root Mean Square），范围 `0.0 ~ 1.0`，代表声音真实响度。
- `peak` (`number`): 时域瞬时峰值偏移量，范围 `0.0 ~ 1.0`。

#### ③ `frame.bands`
宿主为方便可视化编写，预先划分并加权计算了 5 个核心频段（数值区间均为 `0.0 ~ 1.0`）：
- `bass` (`number`): 低频（重低音/鼓点，约前 8% 频谱区间）。
- `lowMid` (`number`): 中低频（8% ~ 20% 频谱区间）。
- `mid` (`number`): 中频（人声/主要乐器，20% ~ 50% 频谱区间）。
- `highMid` (`number`): 中高频（50% ~ 75% 频谱区间）。
- `treble` (`number`): 高频（镲片/空气感/泛音，75% ~ 100% 频谱区间）。
- `energy` (`number`): 全频段平均总能量（0% ~ 100%）。

#### ④ `frame.beat`
宿主节拍检测器输出的实时律动数据：
- `hit` (`boolean`): 本帧是否触发了有效重低音节拍点（瞬间为 `true`）。
- `energy` (`number`): 节拍能量累积强度（`0.0 ~ 1.0`）。
- `pulse` (`number`): 低音平滑脉冲衰减值（`0.0 ~ 1.0`，发生节拍时置 1.0，随后指数级衰减）。
- `lastBeatTime` (`number`): 上一次检测到节拍发生的 `timestamp`。

#### ⑤ `frame.playback`
- `currentTime` (`number`): 当前曲目播放进度（秒）。
- `duration` (`number`): 当前曲目总时长（秒，未就绪时为 NaN 或 0）。
- `isPlaying` (`boolean`): 是否正在播放中。
- `volume` (`number`): 当前播放器音量（`0.0 ~ 1.0`）。

#### ⑥ `frame.dimensions`
- `width` (`number`): 视口实际宽度（像素，`window.innerWidth`）。
- `height` (`number`): 视口实际高度（像素，`window.innerHeight`）。
- `cx` (`number`): 水平中心坐标点（`width / 2`）。
- `cy` (`number`): 垂直中心坐标点（`height / 2`）。
- `dpr` (`number`): 屏幕设备像素比（`window.devicePixelRatio || 1`）。

---

### 3.2 `onTrackChange(callback)` —— 曲目与封面切换

当切歌或新曲目加载完成时触发。若预设在加载时已有曲目正在播放，注册该监听会**立即重放一次最新曲目数据**。

```javascript
window.$musicDance.onTrackChange((track) => {
    console.log('当前播放：', track.title, track.artist);
});
```

#### `track` 参数字段定义：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `title` | `string` | 曲目标题（若元数据无标题则降级为文件名） |
| `artist` | `string` | 艺术家 / 歌手名称（可能为空字符串） |
| `album` | `string` | 专辑名称（可能为空字符串） |
| `coverUrl` | `string \| null` | 专辑封面图片 URL（通常为 `data:image/...` 或 `blob:...`，无封面时为 `null`） |
| `coverPalette` | `Object \| null` | 自动从封面提取的色调对象。格式为 `{ colors: [color1, color2] }`，其中颜色为 HEX 字符串（例如 `"#1e3a8a"`）；提取失败或无封面时为 `null` |

---

### 3.3 `onLyricsUpdate(callback)` —— 歌词动态同步

当音频播放推进、歌词滚动到新行或解析到新歌词时触发。

```javascript
window.$musicDance.onLyricsUpdate((lyrics) => {
    console.log('当前歌词：', lyrics.currentLine);
});
```

#### `lyrics` 参数字段定义：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `currentLine` | `string` | 当前正在唱的歌词文本行（无歌词时为空字符串） |
| `currentIndex` | `number` | 当前行在全部歌词数组中的下标（`-1` 表示未匹配到或无歌词） |
| `lines` | `Array<{time: number, text: string}>` | 解析后的整首歌全部歌词行数组。每项包含时间点 `time`（秒）与歌词文本 `text` |

---

### 3.4 `onStateChange(callback)` —— 播放状态变更

当用户在宿主端点击暂停/播放、调节音量等操作时触发。新注册监听会立即收到最近一次状态回放。

```javascript
window.$musicDance.onStateChange((state) => {
    console.log('播放状态：', state.isPlaying ? '播放中' : '已暂停', '当前音量：', state.volume);
});
```

#### `state` 参数字段定义：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `isPlaying` | `boolean` | 是否正在播放 |
| `volume` | `number` | 音量大小，范围 `0.0 ~ 1.0` |

---

## 4. 反向控制接口 (`window.$musicDance.controls`)

预设内可以构建自己的交互控件（如全屏沉浸式的自定义播放条、手势控制等），通过调用此接口控制宿主播放器：

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `play()` | 无 | 开始播放音频（若已在播放则无额外影响） |
| `pause()` | 无 | 暂停播放音频 |
| `togglePlay()` | 无 | 切换 播放/暂停 状态 |
| `next()` | 无 | 切换到下一首曲目 |
| `prev()` | 无 | 切换到上一首曲目 |
| `seek(timeInSeconds)` | `timeInSeconds: number` | 跳转到指定播放进度（单位：秒，例如 `seek(75.5)`） |
| `setVolume(volume)` | `volume: number` | 调节音量大小（范围 `0.0 ~ 1.0`，例如 `setVolume(0.8)`） |

**示例代码：**
```javascript
// 点击画布切换播放/暂停
canvas.addEventListener('click', () => {
    window.$musicDance?.controls?.togglePlay();
});

// 空格键触发播放/暂停
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        window.$musicDance?.controls?.togglePlay();
    }
});
```

---

## 5. 原生 UI 接管接口 (`window.$musicDance.ui`)

MusicDance 允许预设按需隐藏宿主自带的 DOM 控件，以实现极致的全屏沉浸体验。

### `setNativeUI(config)`

```javascript
// 只有已经提供自定义设置按钮时才能隐藏宿主播放栏
window.$musicDance.ui.registerSettingsButton();
window.$musicDance.ui.setNativeUI({
    controls: false,     // 是否显示底部播放控制栏（默认 true，设为 false 隐藏）
    lyrics: false,       // 是否显示右侧/浮动歌词面板（默认 true，设为 false 隐藏）
    progressBar: false,  // 是否显示底部音频进度条（默认 true，设为 false 隐藏）
    coverArt: false      // 是否显示悬浮专辑封面部件（默认 true，设为 false 隐藏）
});
```

### 自定义设置按钮（隐藏播放栏前置条件）

当预设接管播放控制栏并将 `controls` 设为 `false` 时，必须先注册自定义设置按钮：

```javascript
window.$musicDance.ui.registerSettingsButton();
mySettingsButton.addEventListener('click', () => {
    window.$musicDance.ui.openSettings();
});
```

未注册时隐藏播放栏的请求会被拒绝，宿主会继续显示原生播放栏并提示错误。该要求适用于 manifest 中的 `nativeUI.controls: false` 以及运行时调用。

#### 规则与安全保障：
1. **默认全显**：所有未显式传入 `false` 的项均默认为 `true`（保持可见）。
2. **设置按钮要求**：隐藏播放栏前必须注册并实现自定义设置按钮（见上）。
3. **自动恢复**：当用户切换到其他预设、或按 `Esc` 返回播放器首页列表时，宿主会自动重置所有原生 UI 为全显状态。
4. **Esc 保底返回**：即便预设隐藏了全部原生 UI，用户按下键盘 `Esc` 依然由宿主全局监听并返回主页，预设无需担心造成界面死锁。

---

## 6. 开发者与 AI 快速开发准则

1. **防抖与空值保护**：
   - 音乐未播放时，`frequencyData` 可能全为 0 或为空。
   - 无封面图时，`track.coverPalette` 和 `track.coverUrl` 为 `null`。请提供默认配色方案（如优雅的深蓝渐变色）。
2. **性能与渲染循环**：
   - 推荐使用 `onFrame` 回调驱动 Canvas / WebGL 渲染，无需再额外开启 `setInterval` 或独立高频 `requestAnimationFrame`。
   - 避免在 `onFrame` 内创建高频临时大对象（如每帧 new 复杂对象、大数组），以确保稳定 60+ FPS。
3. **响应式自适应**：
   - 监听 `window.addEventListener('resize', ...)` 并结合 `frame.dimensions` 更新画布分辨率及投影矩阵。
