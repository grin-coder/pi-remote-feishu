import type { JsonObject } from "../types.js";
import { actions, button, card, noteBlock, textBlock } from "./common.js";

/** 模型卡片的单条模型信息（展示 + 切换用） */
export interface ModelCardEntry {
  provider: string;
  id: string;
  name?: string;
  /** 是否支持 thinking */
  thinking?: boolean;
}

/**
 * 模型选择卡片（/models 命令触发）：
 * 展示当前模型，并列出可用模型，每个模型配"使用"（普通）和"高思考"（high thinking）两个按钮。
 * 按钮点击后由 card-actions 的 cmd: "model" 分支处理。
 */
export function buildModelsCard(options: {
  sessionKey: string;
  current?: { provider: string; id: string; thinkingLevel?: string };
  models: ModelCardEntry[];
  sessionMode: string;
}): JsonObject {
  const current = options.current
    ? `${options.current.provider}/${options.current.id} (${options.current.thinkingLevel ?? "default"})`
    : "未选择";
  const elements: JsonObject[] = [
    textBlock([`**当前模型**`, `\`${current}\``, `会话：\`${options.sessionKey}\``, `模式：${options.sessionMode}`].join("\n")),
  ];

  // 没有可用模型时的提示
  if (options.models.length === 0) {
    elements.push(noteBlock("当前没有可用模型。请先检查 Pi 的模型配置。"));
  }

  // 最多展示 20 个模型
  for (const model of options.models.slice(0, 20)) {
    const label = model.name ?? model.id;
    elements.push(textBlock([`**${label}**`, `\`${model.provider}/${model.id}\``, model.thinking ? "支持 thinking" : ""].filter(Boolean).join("\n")));
    elements.push(
      actions([
        button(
          "使用",
          {
            cmd: "model",
            action: "select",
            sessionKey: options.sessionKey,
            provider: model.provider,
            modelId: model.id,
            thinkingLevel: "off",
          },
          "primary",
        ),
        button(
          "高思考",
          {
            cmd: "model",
            action: "select",
            sessionKey: options.sessionKey,
            provider: model.provider,
            modelId: model.id,
            thinkingLevel: "high",
          },
        ),
      ]),
    );
  }

  if (options.models.length > 20) {
    elements.push(noteBlock(`只展示前 20 个模型，共 ${options.models.length} 个。`));
  }

  return card("Pi 模型选择", "blue", elements);
}
