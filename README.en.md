# pi-remote-feishu

[中文文档](./README.md) | English

Remote control **Pi Agent** via **Feishu (飞书) / Lark** chat. A WebSocket bridge that turns your Feishu chat into a full Pi interface — with interactive cards, attachments, and file delivery.

This is an independent Pi extension. It does not modify Pi core.

## Features

- 💬 **Feishu WebSocket transport** — long-lived connection, no public server needed
- 🔒 **Session isolation** — private chat per user, group chat shared or per-user (configurable)
- 🧠 **One Pi runtime per session** — sessions survive restarts via persisted session files
- 🃏 **Interactive cards** — model picking, session management, stop/status, permission confirmations
- 📎 **Attachment processing** — images (base64), small text (inlined), other files (downloaded)
- 📤 **`send_file_to_chat`** — the agent returns generated local files straight to the current chat
- 🧩 **Optional Lark CLI skills** — `lark-doc-cli`, `lark-im-readonly` when `lark-cli` is installed
- 🛡️ **Guardrails** — blocks `lark-cli im` send/reply/receive commands

## Quick Start

```bash
# 1. Install and build
npm install --ignore-scripts
npm run build

# 2. Create a config template (replace <your-pi-project> with your Pi working directory)
node dist/bin/pi-remote-feishu.js init --cwd <your-pi-project>

# 3. Edit the generated config: .pi/feishu.json
#    - put your Feishu appId / appSecret
#    - adjust policy / sessions / rendering options

# 4. Start the bridge
node dist/bin/pi-remote-feishu.js serve --cwd <your-pi-project>
```

You can also pass credentials via environment variables:

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
node dist/bin/pi-remote-feishu.js serve --cwd <your-pi-project>
```

## CLI Commands

```bash
pi-remote-feishu serve                    # start the Feishu bridge (default)
pi-remote-feishu init                     # generate .pi/feishu.json template
pi-remote-feishu doctor                   # check config and WebSocket connectivity
pi-remote-feishu send-test --chat-id <id> --text "hello"   # send a test message
pi-remote-feishu help                     # show usage
```

Log incoming message/card summaries with `--debug-events` (or set `debug.logIncomingEvents: true`).

## Feishu Chat Commands

| Command | Description |
|---|---|
| `/help` | Show help |
| `/sessions` | Manage sessions (list / switch / delete) |
| `/models` | Pick model and thinking level |
| `/new` | Start a fresh Pi session |
| `/stop` | Stop the current generation |
| `/reset` | Reset the current session mapping |
| `/status` | Show connection / queue / model status |

Group chats require mentioning the bot (`@bot`) by default.

## Files And Skills

- The agent can return generated files to the chat via the `send_file_to_chat` tool (path whitelist and size limit enforced).
- When `lark-cli` is installed, two optional skills are exposed: `lark-doc-cli` (Feishu documents) and `lark-im-readonly` (read-only IM inspection).
- The extension blocks `lark-cli im +messages-send / +messages-reply / +messages-receive` through bash, so replies always go through the pi-remote-feishu transport.

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — design document (English)
- [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md) — design document (中文)
- [`docs/`](./docs/00-README.md) — in-depth source code walkthrough
- [`tutorial/`](./tutorial/index.html) — HTML tutorial site (24 chapters)
