import Anthropic from "@anthropic-ai/sdk";
import type { AppDatabase } from "../../db/database.js";
import type { ApiKeyProviderConfig } from "../providerConfig.js";
import type { ChatMessage, Emitter } from "../chatTypes.js";
import { FPL_TOOL_DEFINITIONS, executeTool, type FplToolName } from "../fplTools.js";
import { SYSTEM_PROMPT } from "../schemaContext.js";

// Map generic tool definitions to Anthropic's input_schema format
const ANTHROPIC_TOOLS: Anthropic.Tool[] = FPL_TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as unknown as Anthropic.Tool["input_schema"],
}));

export async function streamAnthropic(
  db: AppDatabase,
  config: ApiKeyProviderConfig,
  messages: ChatMessage[],
  emit: Emitter,
): Promise<void> {
  const client = new Anthropic({ apiKey: config.apiKey });

  // Convert messages to Anthropic format (they share role+content shape)
  let anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Agentic loop
  while (true) {
    const stream = await client.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: ANTHROPIC_TOOLS,
      messages: anthropicMessages,
    });

    // Collect content blocks while streaming text
    const contentBlocks: Anthropic.ContentBlock[] = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: "",
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          emit({ type: "text_delta", content: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse.inputJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolUse) {
          contentBlocks.push({
            type: "tool_use",
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: JSON.parse(currentToolUse.inputJson || "{}"),
          } as Anthropic.ToolUseBlock);
          currentToolUse = null;
        }
      } else if (event.type === "message_delta") {
        // Handled via stop_reason below
      }
    }

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason !== "tool_use") {
      // No more tool calls — done
      emit({ type: "done" });
      return;
    }

    // Execute tool calls
    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Append assistant turn
    anthropicMessages.push({ role: "assistant", content: finalMessage.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      emit({
        type: "tool_start",
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input as Record<string, unknown>,
      });

      const result = executeTool(
        db,
        toolUse.name as FplToolName,
        toolUse.input as Record<string, unknown>,
      );

      emit({ type: "tool_result", id: toolUse.id, content: result });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Append tool results as a user turn and loop
    anthropicMessages.push({ role: "user", content: toolResults });
  }
}
