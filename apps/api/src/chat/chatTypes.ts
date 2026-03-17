export type ChatEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = { messages: ChatMessage[]; providerId: string };

export type Emitter = (event: ChatEvent) => void;

export type ProviderType = "anthropic" | "openai" | "google";

export type ProviderInfo = {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  authType: "apiKey" | "oauth";
  oauthConnected: boolean;
};
