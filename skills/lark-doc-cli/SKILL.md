---
name: lark-doc-cli
description: Use this skill for Feishu/Lark document work through lark-cli: fetch documents, create docs, append or update document content, and insert local images or files into documents. Do not use this skill to send chat messages.
---

# Lark Doc CLI

Use this skill when the user asks to read, create, update, or enrich a Feishu/Lark document.

## Preconditions

The machine must have `lark-cli` installed and authenticated:

```bash
lark-cli auth login
```

If authentication is missing or expired, ask the user to authenticate before continuing.

## Core Commands

Fetch a document:

```bash
lark-cli docs +fetch --doc "<doc-url-or-token>"
```

Create a document:

```bash
lark-cli docs +create --content "<title>Title</title><p>Content</p>"
```

Append content to a document:

```bash
lark-cli docs +update --doc "<doc-url-or-token>" --command append --content "<p>Content</p>"
```

Insert a local image or file into a document:

```bash
lark-cli docs +media-insert --doc "<doc-url-or-token>" --file "<local-path>"
```

## Workflow

1. Identify the document URL or token from the user request.
2. Fetch before modifying unless the user explicitly asks to create a new document.
3. Preserve document structure when summarizing or updating.
4. For generated images or files that belong inside a document, use document media insertion.
5. For generated files that should be returned to the current Feishu chat, use `send_file_to_chat` instead.

## Safety

Do not use IM send or reply commands from this skill. The Feishu chat response is handled by the pi-remote-feishu transport.
