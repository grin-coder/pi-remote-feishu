# pi-remote-feishu

[English](./README.en.md) | 中文文档

通过 **飞书（Feishu / Lark）** 远程操控 **Pi Agent**。一个 WebSocket 桥接器，把飞书聊天变成完整的 Pi 交互界面——支持交互卡片、附件处理和文件回传。

这是一个独立的 Pi 扩展项目，不修改 Pi 核心。

## 功能特性

- 💬 **飞书 WebSocket 传输** — 长连接，无需公网服务器
- 🔒 **会话隔离** — 私聊按用户隔离；群聊可整群共享或按用户隔离（可配置）
- 🧠 **每个会话一个 Pi 运行时** — 会话文件持久化，重启后自动恢复
- 🃏 **交互卡片** — 模型选择、会话管理、停止/状态、权限确认
- 📎 **附件处理** — 图片（base64）、小文本（内联）、其他文件（下载落盘）
- 📤 **`send_file_to_chat` 文件回传** — 模型把生成的本地文件直接发回当前聊天
- 🧩 **可选 Lark CLI 技能** — 安装 `lark-cli` 后启用 `lark-doc-cli`、`lark-im-readonly`
- 🛡️ **安全护栏** — 拦截 `lark-cli im` 的发送/回复/接收命令

## 快速开始

有两种方式：**直接使用 npm 已发布包**（推荐，装完即可用），或**从源码构建**（适合二次开发）。

### 方式一：使用 npm 已发布包（推荐）

```bash
# 1. 安装已发布的包（作为 Pi 包安装，自动注册扩展，并提供 pi-remote-feishu 命令）
pi install npm:pi-remote-feishu

# 2. 生成配置模板（把 <你的Pi项目路径> 换成你的 Pi 工作目录）
pi-remote-feishu init --cwd <你的Pi项目路径>

# 3. 编辑生成的配置：.pi/feishu.json
#    - 填入你的飞书 appId / appSecret
#    - 按需调整 policy / sessions / rendering 等选项

# 4. 启动桥接
pi-remote-feishu serve --cwd <你的Pi项目路径>
```

如果只想用命令行工具、不注册 Pi 扩展，也可以全局安装 npm 包：

```bash
npm install -g pi-remote-feishu
```

### 方式二：从源码构建（开发/贡献）

```bash
# 1. 安装并构建
npm install --ignore-scripts
npm run build

# 2. 生成配置模板
node dist/bin/pi-remote-feishu.js init --cwd <你的Pi项目路径>

# 3. 编辑生成的配置：.pi/feishu.json
#    - 填入你的飞书 appId / appSecret
#    - 按需调整 policy / sessions / rendering 等选项

# 4. 启动桥接
node dist/bin/pi-remote-feishu.js serve --cwd <你的Pi项目路径>
```

### 环境变量方式

两种方式都可以直接用环境变量传入凭据：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
pi-remote-feishu serve --cwd <你的Pi项目路径>
```

## CLI 命令

```bash
pi-remote-feishu serve                    # 启动飞书桥接（默认命令）
pi-remote-feishu init                     # 生成 .pi/feishu.json 配置模板
pi-remote-feishu doctor                   # 检查配置与 WebSocket 连通性
pi-remote-feishu send-test --chat-id <id> --text "hello"   # 发送测试消息
pi-remote-feishu help                     # 查看帮助
```

加 `--debug-events` 参数（或配置 `debug.logIncomingEvents: true`）可打印收到的消息/卡片摘要。

## 飞书聊天命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/sessions` | 管理会话（查看/切换/删除） |
| `/models` | 选择模型和思考等级 |
| `/new` | 新建 Pi 会话 |
| `/stop` | 停止当前生成 |
| `/reset` | 重置当前会话映射 |
| `/status` | 查看连接/队列/模型状态 |

群聊默认需要 @机器人 才会响应。

## 文件与技能

- 模型可通过 `send_file_to_chat` 工具把生成的文件发回聊天（受目录白名单和大小上限限制）。
- 安装了 `lark-cli` 时，会暴露两个可选技能：`lark-doc-cli`（飞书文档）和 `lark-im-readonly`（只读 IM 查询）。
- 扩展会拦截通过 bash 执行的 `lark-cli im +messages-send / +messages-reply / +messages-receive`，保证回复始终走 pi-remote-feishu 自己的传输通道。

## 文档

- [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md) — 设计文档（中文）
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 设计文档（English）
- [`docs/`](./docs/00-README.md) — 源码精读文档
- [📖 在线教程](https://grin-coder.github.io/pi-remote-feishu/) — HTML 教程站（24 章）
