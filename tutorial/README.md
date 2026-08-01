# pi-feishu 源码教程 📚

从零读懂 **Pi Agent × 飞书** 扩展包 `pi-feishu` 的完整实现。

> 💡 **本教程用纯原生 HTML 构建**，没有框架、没有构建步骤、不需要网络。
> 直接点击 [index.html](./index.html) 就能在 GitHub 上预览完整教程。

## 教程结构（共 3 部分 · 24 章）

### 第一部分 · 架构设计 `architecture/`

| # | 章节 | 文件 |
|---|---|---|
| 00 | 教程导读 | `architecture/00-guide.html` |
| 01 | 项目概览 | `architecture/01-overview.html` |
| 02 | 总体架构 | `architecture/02-architecture.html` |
| 03 | 核心概念 | `architecture/03-core-concepts.html` |
| 04 | 消息处理全链路 | `architecture/04-message-flow.html` |
| 05 | 关键设计决策 | `architecture/05-design-decisions.html` |

### 第二部分 · 源码解读 `source/`

| # | 章节 | 文件 |
|---|---|---|
| 01 | 源码地图 | `source/01-source-map.html` |
| 02 | 配置系统 | `source/02-config.html` |
| 03 | 通道层 feishu/ | `source/03-feishu-channel.html` |
| 04 | 路由与归一化 | `source/04-router-normalizer.html` |
| 05 | 会话管理 | `source/05-session-host-manager.html` |
| 06 | 运行时封装 | `source/06-runtime-host.html` |
| 07 | 流式渲染 | `source/07-stream-renderer.html` |
| 08 | UI 桥接与权限确认 | `source/08-ui-context.html` |
| 09 | 卡片系统 | `source/09-cards.html` |
| 10 | 附件处理 | `source/10-attachments.html` |
| 11 | 文件回传工具 | `source/11-send-file-tool.html` |
| 12 | 存储 | `source/12-store.html` |
| 13 | 入口与扩展 | `source/13-bin-extensions.html` |
| 14 | 测试与二次开发 | `source/14-testing-extending.html` |

### 第三部分 · 面试准备 `interview/`

| # | 章节 | 文件 |
|---|---|---|
| 01 | 面试主线问答 | `interview/01-qa.html` |
| 02 | 架构亮点与设计模式 | `interview/02-patterns.html` |
| 03 | 面试可演示改造题 | `interview/03-labs.html` |
| 04 | 面试速查卡 | `interview/04-cheatsheet.html` |

## 特性

- ✅ **零依赖**：纯 HTML + CSS + JS，无框架、无 CDN
- ✅ **GitHub 直接预览**：点击任意 .html 文件即可阅读
- ✅ **侧边栏导航**：左右部分 + 章节跳转（`assets/main.js` 自动生成）
- ✅ **上一章/下一章**：每页底部自动生成
- ✅ **代码高亮 + 一键复制**：TS/JSON 简单高亮，无外部库
- ✅ **阅读进度条** + 回到顶部 + 移动端适配
- ✅ 每章包含：🎯 目标 / 📂 源码对照 / 💡 提示 / ⚠️ 注意 / ✍️ 练习

## 本地预览

```bash
# 方式一：直接用浏览器打开 index.html
# 方式二：起个本地静态服务（推荐）
npx serve tutorial
```

## 相关文档

- 根目录 `ARCHITECTURE.zh-CN.md` / `ARCHITECTURE.md`：设计稿（规划怎么做）
- 根目录 `docs/`：Markdown 版教学文档（本教程的内容源头）
