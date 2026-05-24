# 🎵 NEON BEAT // 赛博音浪

赛博朋克风格的网页端音乐播放器，支持搜索、在线播放、歌曲详情和歌词查看。

## ✨ 特性

- 🔍 **音乐搜索** - 支持歌名、歌手、专辑搜索
- 🎶 **在线播放** - 支持本地完整音频、同源音乐库、公开试听源回退
- 📝 **歌词面板** - 点击歌曲即可查看详情、滚动歌词和同步高亮
- 🎨 **赛博朋克 UI** - 霓虹色彩、扫描线、网格背景、音频可视化
- 📋 **播放列表** - 添加、移除、双击播放
- 🔀 **播放模式** - 列表循环 / 单曲循环 / 随机播放
- 🔊 **音量控制** - 滑块调节 + 静音切换
- ⌨️ **键盘快捷键** - 空格播放暂停、方向键控制
- 📱 **响应式** - 适配移动端

## 🎮 快捷键

| 按键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `← / →` | 快退 / 快进 5 秒 |
| `Ctrl + ← / →` | 上一首 / 下一首 |
| `↑ / ↓` | 音量 +/- |

## 🚀 使用

推荐通过静态服务器打开 `index.html`。

```bash
# 本地预览
python3 -m http.server 8080
# 访问 http://localhost:8080
```

## 🎧 调试完整版

项目现在提供两条稳定的“完整版调试”路径，不再依赖不稳定的第三方整首直链：

1. 运行时导入本地音频  
   页面顶部点击 `IMPORT AUDIO` 导入你的本地完整音频文件。  
   点击 `IMPORT LRC` 可导入同名 `.lrc` 歌词文件。

2. 配置同源音乐库  
   把完整音频放到项目静态目录中。  
   参考 [music-library.sample.json](/mnt/d/javaProject/cyberpunk-music-player/music-library.sample.json) 填写 [music-library.json](/mnt/d/javaProject/cyberpunk-music-player/music-library.json)。  
   搜索时会优先返回这些完整音频。

## 📁 项目结构

```
├── index.html    # 页面结构
├── style.css     # 赛博朋克样式
├── app.js        # 应用逻辑
└── README.md     # 说明文档
```

## 🛠️ 技术栈

- 原生 HTML / CSS / JavaScript（零依赖）
- Web Audio API（音频可视化）
- iTunes Search API（音乐搜索与试听）

## ⚙️ 可选 Worker

项目保留了一个可选的 `worker.js`，用于把搜索和试听地址统一代理到 Cloudflare Worker。
如果你已经有自己的完整音源接口，也可以让 Worker 返回完整播放地址和歌词地址。

默认情况下不需要部署 Worker。
只有在你想把请求统一走自己的域名时，才需要：

1. 部署 `worker.js` 到 Cloudflare Workers
2. 把 [app.js](/mnt/d/javaProject/cyberpunk-music-player/app.js) 里的 `WORKER_URL` 改成你的 Worker 地址

## ⚠️ 说明

如果没有导入本地完整音频，也没有配置同源音乐库，项目会自动回退到公开试听源。
这意味着部分远程结果只提供短时试听片段，而不是整首音频。

本项目仅供学习交流，音乐版权归原创者所有。
