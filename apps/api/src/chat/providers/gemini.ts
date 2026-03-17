import { GoogleGenAI, type Tool, type Content, type Part } from "@google/genai";
import type { AppDatabase } from "../../db/database.js";
import type { ProviderConfig } from "../providerConfig.js";
import type { ChatMessage, Emitter } from "../chatTypes.js";
import { FPL_TOOL_DEFINITIONS, executeTool, type FplToolName } from "../fplTools.js";
import * as oauthManager from "../oauthManager.js";
import { SYSTEM_PROMPT } from "../schemaContext.js";

const GEMINI_TOOLS: Tool[] = [
  {
    functionDeclarations: FPL_TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    })),
  },
];

async function resolveApiKey(config: ProviderConfig): Promise<string> {
  if ("auth" in config && config.auth === "oauth") {
    return oauthManager.getAccessToken(config, config.id);
  }
  return (config as { apiKey: string }).apiKey;
}

export async function streamGemini(
  db: AppDatabase,
  config: ProviderConfig,
  messages: ChatMessage[],
  emit: Emitter,
): Promise<void> {
  const apiKey = await resolveApiKey(config);
  const genai = new GoogleGenAI({ apiKey });

  // Convert prior messages (all except last) to Gemini history
  const history: Content[] = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  // Create a persistent chat session
  const chat = genai.chats.create({
    model: config.model,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: GEMINI_TOOLS,
    },
    history,
  });

  // First send: the latest user message
  let nextMessage: string | Part[] = lastMessage?.content ?? "";

  // Agentic loop: keep going until no function calls
  while (true) {
    const stream = await chat.sendMessageStream({ message: nextMessage });

    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    for await (const chunk of stream) {
      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            emit({ type: "text_delta", content: part.text });
          }
          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name ?? "",
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
            });
          }
        }
      }
    }

    if (functionCalls.length === 0) {
      emit({ type: "done" });
      return;
    }

    // Execute tools and prepare function response parts for next turn
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      const id = `${fc.name}-${Date.now()}`;
      emit({ type: "tool_start", id, name: fc.name, input: fc.args });

      const result = executeTool(db, fc.name as FplToolName, fc.args);

      emit({ type: "tool_result", id, content: result });

      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: { result },
        },
      });
    }

    // Send the function responses back as the next "user" message
    nextMessage = responseParts;
  }
}
