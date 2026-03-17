import OpenAI from "openai";
import type { AppDatabase } from "../../db/database.js";
import type { ApiKeyProviderConfig } from "../providerConfig.js";
import type { ChatMessage, Emitter } from "../chatTypes.js";
import { FPL_TOOL_DEFINITIONS, executeTool, type FplToolName } from "../fplTools.js";
import { SYSTEM_PROMPT } from "../schemaContext.js";

const OPENAI_TOOLS: OpenAI.ChatCompletionTool[] = FPL_TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

export async function streamOpenAI(
  db: AppDatabase,
  config: ApiKeyProviderConfig,
  messages: ChatMessage[],
  emit: Emitter,
): Promise<void> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });

  let openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content }) as OpenAI.ChatCompletionMessageParam),
  ];

  // Agentic loop
  while (true) {
    const stream = await client.chat.completions.create({
      model: config.model,
      tools: OPENAI_TOOLS,
      messages: openaiMessages,
      stream: true,
    });

    // Accumulate the full assistant message while streaming
    let fullContent = "";
    const toolCallAccumulator: Map<
      number,
      { id: string; name: string; argumentsJson: string }
    > = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullContent += delta.content;
        emit({ type: "text_delta", content: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallAccumulator.get(tc.index) ?? {
            id: "",
            name: "",
            argumentsJson: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.argumentsJson += tc.function.arguments;
          toolCallAccumulator.set(tc.index, existing);
        }
      }
    }

    const toolCalls = [...toolCallAccumulator.values()];

    if (toolCalls.length === 0) {
      emit({ type: "done" });
      return;
    }

    // Append assistant message with tool_calls
    const assistantMessage: OpenAI.ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: fullContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      })),
    };
    openaiMessages.push(assistantMessage);

    // Execute each tool
    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.argumentsJson || "{}");
      } catch {
        // ignore parse errors
      }

      emit({ type: "tool_start", id: tc.id, name: tc.name, input });

      const result = executeTool(db, tc.name as FplToolName, input);

      emit({ type: "tool_result", id: tc.id, content: result });

      openaiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }
}
