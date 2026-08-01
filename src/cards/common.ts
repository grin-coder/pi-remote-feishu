import type { JsonObject, JsonValue } from "../types.js";

/**
 * ============================================================
 * 飞书卡片构建公共组件
 * ------------------------------------------------------------
 * 提供一组小函数，用于按飞书卡片 JSON 结构组装：
 * 文本块、注释块、按钮、按钮组、下拉菜单、整张卡片。
 * 各 cards/*.ts 都基于这些函数构建具体卡片。
 * ============================================================
 */

/** 卡片模板（决定头部颜色）：蓝 / 绿 / 红 / 黄 / 灰 */
export type CardTemplate = "blue" | "green" | "red" | "yellow" | "grey";

/** 普通文本块（支持 Markdown，tag: lark_md） */
export function textBlock(content: string): JsonObject {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content,
    },
  };
}

/** 灰色注释文本块（通常用于辅助信息） */
export function noteBlock(content: string): JsonObject {
  return textBlock(`<font color="grey">${content}</font>`);
}

/**
 * 按钮：点击后飞书会触发 cardAction 事件，value 字段原样带到事件里。
 * value 里通常放 cmd（命令名）+ 相关参数（sessionKey、dialogId 等）。
 */
export function button(text: string, value: JsonObject, type: "primary" | "default" | "danger" = "default"): JsonObject {
  return {
    tag: "button",
    text: {
      tag: "plain_text",
      content: text,
    },
    type,
    value,
  };
}

/** 按钮组：把多个按钮排成一行 */
export function actions(elements: JsonObject[]): JsonObject {
  return {
    tag: "action",
    actions: elements,
  };
}

/**
 * 静态下拉菜单：value 同样会随 cardAction 事件带回。
 * 第一个选项会设为 initial_option（默认选中）。
 */
export function selectMenu(placeholder: string, value: JsonObject, options: Array<{ text: string; value: string }>): JsonObject {
  const initialOption = options[0]
    ? {
        text: {
          tag: "plain_text",
          content: options[0].text,
        },
        value: options[0].value,
      }
    : undefined;

  return {
    tag: "select_static",
    placeholder: {
      tag: "plain_text",
      content: placeholder,
    },
    ...(initialOption ? { initial_option: initialOption } : {}),
    options: options.map((option) => ({
      text: {
        tag: "plain_text",
        content: option.text,
      },
      value: option.value,
    })),
    value,
  };
}

/** 组装一张完整的飞书卡片：头部（标题+颜色模板）+ 元素列表 */
export function card(title: string, template: CardTemplate, elements: JsonObject[]): JsonObject {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: title,
      },
      template,
    },
    elements: elements as JsonValue[],
  };
}
