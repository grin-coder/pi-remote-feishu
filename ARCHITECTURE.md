# Pi Feishu Extension Architecture

## Goal

Design a Feishu integration for Pi Agent as an installable extension-oriented package.

The integration should let users talk to Pi Agent from Feishu while preserving Pi's existing extensibility model: extensions, skills, prompt templates, session runtime, custom tools, UI prompts, and package-managed resources.

This is not intended to be a direct copy of `pi-feishu-cli`. That package is a useful prototype because it proves Feishu messaging, cards, streaming, attachments, and `AgentSessionRuntime` can work together. The target design here separates the transport host from Pi's extension package so the system can be installed, operated, tested, and evolved independently.

The MVP targets one Feishu app serving private chats and group chats. Full multi-tenant operation is not part of the MVP. Tenant fields may be stored for forward compatibility, but routing, permissions, and deployment should initially optimize for a single Feishu app in one workspace.

## Design Principles

1. Keep Pi core stable.
   Feishu is an external transport and should not require large changes to `pi-main`.

2. Make Feishu a first-class transport.
   Feishu should not be treated as a terminal hack. It needs its own message normalization, session mapping, UI bridge, permission handling, and renderer.

3. Separate runtime hosting from extension registration.
   Receiving messages from Feishu requires a long-running process. Registering tools and commands belongs in Pi's extension system. These are related but not the same responsibility.

4. Prefer per-conversation isolation.
   One Feishu chat should not block all other chats. Queues, abort state, and session state should be scoped by a deterministic session key.

5. Treat group chat and private chat differently.
   Private chat should isolate by user. Group chat should default to one shared group session and require mentioning the bot.

6. Avoid premature multi-tenancy.
   Keep `tenantKey` as optional metadata, but do not design the MVP around multiple companies sharing one service.

7. Keep deployment modes open.
   Start with Feishu WebSocket because it is easier to run locally. Design the transport boundary so webhook mode can be added later.

## Package Shape

Recommended package name:

```text
pi-remote-feishu
```

or, if it is published under the project scope:

```text
@earendil-works/pi-remote-feishu
```

Recommended package layout:

```text
pi-remote-feishu/
  package.json
  README.md
  ARCHITECTURE.md
  src/
    bin/
      pi-remote-feishu.ts
    config/
      load-config.ts
      schema.ts
    feishu/
      channel.ts
      webhook.ts
      verifier.ts
      types.ts
    bridge/
      runtime-host.ts
      conversation-router.ts
      session-host-manager.ts
      message-normalizer.ts
      message-handler.ts
      stream-renderer.ts
      ui-context.ts
      card-actions.ts
      prompt-queue.ts
    cards/
      help.ts
      models.ts
      sessions.ts
      stop.ts
      permission.ts
      result.ts
    attachments/
      processor.ts
      mime.ts
      temp-files.ts
    store/
      store.ts
      json-store.ts
      sqlite-store.ts
    tools/
      send-file-to-chat.ts
    extensions/
      index.ts
    test/
      suite/
```

`package.json` should expose both a CLI and Pi package resources:

```json
{
  "name": "pi-remote-feishu",
  "type": "module",
  "bin": {
    "pi-remote-feishu": "./dist/bin/pi-remote-feishu.js"
  },
  "pi": {
    "extensions": [
      "./dist/extensions/index.js"
    ],
    "skills": [
      "./dist/skills"
    ]
  }
}
```

The `pi.extensions` manifest lets Pi's package manager discover the extension automatically. The `bin` entry starts the Feishu transport host.

## High-Level Architecture

```text
Feishu user
  -> Feishu channel or webhook
  -> Event verification
  -> Message normalization
  -> Permission and routing
  -> ConversationRouter
  -> SessionHostManager
  -> SessionHost
  -> per-session PromptQueue
  -> per-session AgentSessionRuntime
  -> StreamRenderer
  -> Feishu card/text/file response

Pi extension system
  -> extensions/index.ts
  -> register send_file_to_chat
  -> register /feishu commands
  -> bridge ExtensionUIContext to Feishu cards
```

The important architectural split:

```text
Transport Host
  Long-running process. Owns Feishu connection and dispatches incoming messages.

Pi Extension
  Loaded by Pi. Registers tools, commands, prompt guidance, and UI integration.
```

## Runtime Modes

### 1. Feishu-only server mode

Command:

```bash
pi-remote-feishu serve
```

Behavior:

- Connects to Feishu.
- Creates or resumes Pi sessions based on Feishu chat identity.
- Sends responses back to Feishu.
- Does not start the terminal TUI.

This should be the default production mode.

### 2. Hybrid local mode

Command:

```bash
pi-remote-feishu tui
```

Behavior:

- Starts the Pi interactive TUI.
- Connects Feishu in the same process.
- Useful for local debugging and demonstrations.

This mode is similar to the reference package, but should remain optional.

### 3. Webhook mode

Command:

```bash
pi-remote-feishu serve --transport webhook --port 8787
```

Behavior:

- Starts an HTTP server.
- Validates Feishu challenge, signature, timestamp, and encrypted payloads.
- Dispatches normalized events into the same bridge layer.

Webhook mode should reuse the same `MessageHandler`, `ConversationRouter`, `SessionHostManager`, `PromptQueue`, and `StreamRenderer` as WebSocket mode.

## Module Responsibilities

### `feishu/channel.ts`

Owns Feishu SDK integration.

Responsibilities:

- Create Feishu WebSocket client.
- Emit normalized raw events.
- Send text, markdown, cards, images, and files.
- Update cards by message id or interaction token.
- Download message resources.
- Hide SDK-specific shapes behind local interfaces.

It should expose an interface similar to:

```ts
export interface FeishuChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: FeishuMessage) => void): void;
  onCardAction(handler: (event: FeishuCardAction) => void): void;
  sendText(chatId: string, text: string, options?: ReplyOptions): Promise<SendResult>;
  sendCard(chatId: string, card: unknown, options?: ReplyOptions): Promise<SendResult>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  updateCardByToken(token: string, card: unknown): Promise<void>;
  sendFile(chatId: string, filePath: string, fileName?: string): Promise<void>;
  downloadResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
}
```

### `feishu/webhook.ts`

Owns webhook transport.

Responsibilities:

- Start HTTP server.
- Handle Feishu URL verification challenge.
- Verify timestamp and signature.
- Decrypt event payloads when encrypt key is configured.
- Convert webhook payloads into the same local event model used by WebSocket mode.

This should not contain Pi-specific logic.

### `bridge/runtime-host.ts`

Owns the lifecycle of one Pi runtime bound to one Feishu conversation.

Responsibilities:

- Create `AgentSessionRuntime`.
- Open the mapped Pi session file for one conversation.
- Bind extensions after session replacement.
- Expose a stable API to prompt, abort, switch model, list sessions, and list models.
- Keep Feishu context and Feishu UI context scoped to the active run.

It should be the only module that directly knows Pi runtime construction details.

### `bridge/conversation-router.ts`

Maps Feishu identity to a conversation key.

Recommended MVP keys:

```text
Private chat:
  dm:{userOpenId}

Group chat, shared session:
  group:{chatId}

Group chat, per-user optional mode:
  group-user:{chatId}:{userOpenId}
```

Supported modes:

```ts
type PrivateChatScope = "per-user";
type GroupChatScope = "shared-chat" | "per-user";
```

Behavior:

- Private chats always default to one session per user.
- Group chats default to one shared session per group.
- Group chats require bot mention by default.
- Group prompt text should include sender display information so Pi can reason about who spoke.
- Full multi-tenant routing is not required for MVP.
- `tenantKey` may be captured as optional metadata for future expansion.
- Session mappings are persisted in `store`.

### `bridge/session-host-manager.ts`

Owns active `SessionHost` instances.

Pi's `AgentSessionRuntime` has one active `runtime.session`. Because Feishu is multi-user, sharing one runtime across all chats would cause session switching, abort, stream, and UI-context cross-talk. The manager should create or reuse one `SessionHost` per conversation key.

Recommended model:

```ts
export interface SessionHost {
  sessionKey: string;
  runtime: AgentSessionRuntime;
  queue: PromptQueue;
  activeRun?: ActiveRun;
  lastUsedAt: Date;
}
```

Lifecycle:

- Create a host on first message for a conversation.
- Reuse it while active.
- Serialize prompts inside that host.
- Evict idle hosts after a configurable TTL.
- Persist the Pi session file mapping before eviction.
- Recreate the host from the persisted session file on the next message.

This gives private chats and group chats isolated runtime state without requiring changes to Pi core.

### `bridge/prompt-queue.ts`

Serializes prompts per session key.

Avoid a global lock. A global lock means one busy group blocks every other chat.

Required behavior:

- Same `sessionKey`: prompts run sequentially.
- Different `sessionKey`: prompts may run concurrently.
- Store active abort controller per `sessionKey`.
- Stop button aborts only the active run for that session key.

### `bridge/message-normalizer.ts`

Converts Feishu messages to Pi prompt input.

Responsibilities:

- Strip bot mention from group messages.
- Ignore unsupported messages.
- Detect slash commands.
- Preserve user display metadata for audit/debug.
- Attach text and images in the shape Pi expects.

Normalized shape:

```ts
export interface NormalizedPiInput {
  sessionKey: string;
  chatId: string;
  messageId: string;
  userId: string;
  tenantKey?: string;
  chatType: "private" | "group";
  senderName?: string;
  text: string;
  images: Array<{ type: "image"; data: string; mimeType: string }>;
  attachmentNotes: string[];
  command?: FeishuCommand;
}
```

### `attachments/processor.ts`

Handles Feishu message resources.

Responsibilities:

- Download images, files, audio, and video metadata.
- Pass supported images directly to Pi when the model supports image input.
- Convert small text files into prompt text.
- Save large or binary files to a controlled temporary directory.
- Add prompt-visible file notes.
- Clean temporary files after the run.

Safety requirements:

- Enforce size limits before sending files back to Feishu.
- Keep temporary files under a known directory.
- Never allow model-provided file paths to escape allowed output roots.

### `bridge/stream-renderer.ts`

Converts Pi session events to Feishu output.

Responsibilities:

- Stream assistant text to Feishu card or markdown.
- Render thinking blocks in a readable style.
- Render tool execution start/update/end.
- Render compaction and retry events as status lines.
- Finalize card after completion.
- Show model errors clearly.

Renderer policy:

- Text deltas should be streamed.
- Thinking deltas can be collapsed, quoted, or hidden depending on config.
- Tool output should be concise by default.
- Large output should be summarized or attached as a file.

### `bridge/ui-context.ts`

Implements `ExtensionUIContext` for Feishu.

This is critical for permission systems and extensions that call:

- `ctx.ui.confirm()`
- `ctx.ui.select()`
- `ctx.ui.notify()`

Feishu implementation:

- `confirm()` sends a card with yes/no buttons.
- `select()` sends a card with one button per option.
- `notify()` sends a text or compact card.
- `input()` can be phase 2 because it requires capturing the user's next message.
- TUI-specific methods are no-op or unavailable.

Avoid deadlocks:

- Feishu card actions must be handled while a prompt is waiting for UI input.
- If the SDK serializes message and card events by chat, disable that queue and use the package's own per-session queue.

### `bridge/card-actions.ts`

Routes Feishu card button actions.

Supported action groups:

- `session`: new, switch, delete.
- `model`: select provider/model/thinking level.
- `stop`: abort active generation.
- `permission`: resolve UI confirm/select.
- `help`: navigate between help cards.

Card action handlers should return quickly. Slow work should be scheduled after Feishu receives an empty success response.

### `cards/*`

Build Feishu interactive cards.

Cards should be deterministic data builders, not business logic.

Recommended cards:

- `help`: available commands and status.
- `sessions`: current session and switch/new/delete actions.
- `models`: provider, model, thinking level selection.
- `stop`: active generation control.
- `permission`: confirm/select prompts.
- `result`: final answer card fallback when streaming is unavailable.

### `tools/send-file-to-chat.ts`

Registers a Pi tool that lets the agent send generated files back to the current Feishu chat.

Important design point:

- The tool should not know global Feishu state.
- It should read the current Feishu context from a scoped context provider set during the active Feishu prompt.

Tool behavior:

- Accept `filePath` and optional `fileName`.
- Validate file existence.
- Validate allowed directory.
- Validate file size.
- Send through `FeishuChannel.sendFile`.
- Return a normal Pi tool result.

### `extensions/index.ts`

The installable Pi extension entry.

Responsibilities:

- Register `send_file_to_chat`.
- Register `/feishu status`.
- Register `/feishu sessions` if useful inside TUI.
- Add prompt guidelines explaining when to call `send_file_to_chat`.
- Optionally register markdown transformers for Feishu-specific output constraints.

This module should not open a Feishu socket by itself. Long-running transport belongs to the host process.

## Configuration

Recommended config resolution order:

1. CLI flags.
2. Project config: `.pi/feishu.json`.
3. User config: `~/.pi/agent/feishu.json`.
4. Environment variables.

Recommended schema:

```ts
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  botName?: string;
  transport: "websocket" | "webhook";
  webhook?: {
    host?: string;
    port: number;
    path: string;
  };
  policy: {
    requireMention: boolean;
    dmEnabled: boolean;
    groupEnabled: boolean;
    allowUsers?: string[];
    allowChats?: string[];
  };
  sessions: {
    privateScope: "per-user";
    groupScope: "shared-chat" | "per-user";
    defaultCwd?: string;
    store: "json" | "sqlite";
    idleTtlMs: number;
  };
  rendering: {
    mode: "stream-card" | "markdown" | "text";
    showThinking: "hide" | "quote" | "plain";
    showToolEvents: boolean;
  };
  files: {
    allowedOutputDirs: string[];
    maxUploadBytes: number;
    tempDir?: string;
  };
}
```

## Command Design

Feishu chat commands:

```text
/help
/sessions
/models
/new
/stop
/reset
/status
```

Recommended behavior:

- `/help`: show help card.
- `/sessions`: show session management card.
- `/models`: show model selection card.
- `/new`: create a new Pi session for the current Feishu session key.
- `/stop`: abort active generation for the current session key.
- `/reset`: clear mapping and start a new session.
- `/status`: show current model, session id, queue state, and transport health.

Pi slash commands from Feishu:

- Phase 1: only Feishu-specific commands are intercepted.
- Phase 2: forward unknown slash commands into Pi if they are safe and supported.

## Conversation Model

Pi's `AgentSessionRuntime` exposes one active `runtime.session`. That is fine for a terminal, but Feishu can deliver messages from many users and groups at the same time. The integration should not multiplex all messages through one shared runtime.

Recommended MVP behavior:

```text
Alice private chat
  -> dm:alice
  -> SessionHost A
  -> Runtime A

Bob private chat
  -> dm:bob
  -> SessionHost B
  -> Runtime B

Engineering group chat
  -> group:chat-123
  -> SessionHost C
  -> Runtime C
```

Concurrency rule:

- Same conversation key: serial execution.
- Different conversation keys: independent execution.
- Stop, permission cards, stream updates, temporary files, and Feishu context are bound to the active run inside one `SessionHost`.

Group chat prompt format should preserve speaker identity:

```text
[Feishu group message]
Sender: Alice
Message:
Please check this error.
```

Multi-tenant note:

- MVP does not need a tenant router.
- Store optional `tenantKey` if Feishu provides it.
- Future multi-tenant mode can prefix keys with `tenantKey`, for example `tenant:{tenantKey}:group:{chatId}`.

## Data Flow

### Normal Message

```text
Feishu text/image/file
  -> channel.onMessage
  -> verify policy
  -> normalize message
  -> resolve session key
  -> process attachments
  -> acquire per-session queue
  -> set Feishu context
  -> set Feishu UI context
  -> stream renderer starts
  -> runtime.session.prompt()
  -> renderer updates Feishu
  -> cleanup context/temp files
  -> release queue
```

### Permission Prompt

```text
Pi tool call requires confirmation
  -> extension calls ctx.ui.confirm()
  -> Feishu UI context sends permission card
  -> user clicks button
  -> card action resolves pending dialog
  -> tool call continues or is blocked
```

### Stop Generation

```text
User clicks stop or sends /stop
  -> card action or command resolves sessionKey
  -> PromptQueue finds active run
  -> runtime.session.abort()
  -> stop card updates to cancelled
```

### File Return

```text
Pi creates local file
  -> model calls send_file_to_chat
  -> tool validates file
  -> reads current Feishu context
  -> FeishuChannel.sendFile()
  -> tool returns success/failure to Pi
```

## Store Design

Start with JSON, keep an interface that can support SQLite later.

```ts
export interface FeishuStore {
  getSessionMapping(sessionKey: string): Promise<SessionMapping | undefined>;
  setSessionMapping(mapping: SessionMapping): Promise<void>;
  deleteSessionMapping(sessionKey: string): Promise<void>;
  listSessionMappings(filter?: SessionFilter): Promise<SessionMapping[]>;
}
```

Mapping shape:

```ts
export interface SessionMapping {
  sessionKey: string;
  appId: string;
  tenantKey?: string;
  chatType: "private" | "group";
  chatId: string;
  userId?: string;
  cwd: string;
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
}
```

JSON is enough for MVP. SQLite is better when:

- Many chats are active.
- Audit metadata is needed.
- Multiple worker processes are introduced.

## Security and Permission Model

Minimum policy:

- Ignore group messages unless the bot is mentioned.
- Support allowlisted users and chats.
- Never expose raw app secret in logs.
- Verify webhook signatures when webhook mode is enabled.
- Store credentials in user config, not project config, unless explicitly intended.
- Restrict file sending to allowed directories.
- Treat Feishu attachment content as untrusted user input.

Recommended production policy:

- Private chats enabled by default.
- Group chats disabled unless configured.
- Project-local cwd requires explicit config.
- Dangerous tools still rely on Pi's permission extension or existing tool approval flow.

## Error Handling

Expected errors:

- Feishu connection failure.
- Feishu token/auth failure.
- Unsupported message type.
- Attachment download failure.
- Pi model unavailable.
- Session file missing.
- Tool permission rejected.
- Card update token expired.

Response policy:

- User-facing failures should be sent back to Feishu as concise messages.
- Operational failures should be logged with structured metadata.
- Card update failures should not crash active generation.
- Attachment failures should become prompt-visible notes when possible.

## Testing Strategy

Unit tests:

- Config loading priority.
- Message normalization.
- Session key generation.
- Prompt queue serialization.
- Card action routing.
- Attachment handling.
- File sending tool validation.

Integration tests with fakes:

- Fake Feishu channel.
- Faux Pi provider.
- Runtime prompt -> stream renderer -> sent Feishu updates.
- Permission card resolution.
- Stop generation abort.

Do not use real Feishu or paid provider APIs in normal tests.

## MVP Plan

### Phase 1: Local working bot

- Implement WebSocket channel.
- Implement config loading.
- Implement conversation routing for private chats and group chats.
- Implement session host manager.
- Use one runtime per active conversation.
- Implement message normalization.
- Implement per-session queue.
- Support text messages.
- Send plain markdown responses.

### Phase 2: Pi-native extension package

- Add `extensions/index.ts`.
- Register `send_file_to_chat`.
- Add prompt guidelines for file delivery.
- Add package manifest under `package.json.pi`.
- Verify Pi package manager can discover the extension.

### Phase 3: Rich Feishu experience

- Add streaming cards.
- Add `/help`, `/sessions`, `/models`.
- Add stop card.
- Add model and thinking level card actions.
- Add Feishu `ExtensionUIContext` bridge for confirm/select.

### Phase 4: Attachments and files

- Support image input.
- Support small text file extraction.
- Save large files to temp directory.
- Support generated file upload through tool.
- Add cleanup and size limits.

### Phase 5: Production deployment

- Add webhook transport.
- Add signature/encryption verification.
- Add SQLite store.
- Add structured logging.
- Add allowlist policy.
- Add deployment docs.
- Keep full multi-tenant routing as a later phase unless there is a concrete product need.

## Key Interview Talking Points

1. The main architectural decision is separating transport host from Pi extension registration.
2. Feishu is modeled as a transport, not as a special case inside Pi core.
3. Pi has one active session per runtime, so Feishu needs a `SessionHostManager` instead of one shared runtime.
4. Private chat and group chat use different identity policies: private per user, group shared by default.
5. Per-session queues avoid global blocking and make abort semantics precise.
6. Stop, streaming, permission cards, and Feishu context are bound to one active run, avoiding cross-talk.
7. `ExtensionUIContext` is the bridge that lets existing Pi permission and interaction flows work remotely.
8. File delivery is implemented as a Pi tool, which keeps it model-callable and consistent with the extension system.
9. Multi-tenancy is deliberately deferred: the MVP stores optional tenant metadata but does not pay the complexity cost early.
10. The design starts simple with JSON storage and evolves to SQLite only when concurrency and audit requirements justify it.

## Open Questions

1. Should group chats always share one Pi session by default, or should some groups opt into per-user sessions?
2. Should unknown Feishu slash commands be forwarded into Pi slash commands?
3. Should generated files be uploaded automatically or only when the model calls `send_file_to_chat`?
4. Should Feishu messages be allowed to use project cwd by default, or require explicit binding?
5. Should there be a multi-worker deployment model, or is one process enough for the first public version?
