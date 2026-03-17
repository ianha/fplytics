import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { Send, ChevronDown, ChevronRight, MessageSquare, Bot, User, Loader2, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

type ProviderInfo = {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google";
  model: string;
  authType: "apiKey" | "oauth";
  oauthConnected: boolean;
};

type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  expanded: boolean;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
};

type ChatEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ── Storage helpers ───────────────────────────────────────────────────────────

const MESSAGES_KEY = "fpl-chat-messages";
const PROVIDER_KEY = "fpl-chat-provider";

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: Message[]): void {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

function prettifyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ── Tool call block ───────────────────────────────────────────────────────────

function ToolCallBlock({
  toolCall,
  onToggle,
}: {
  toolCall: ToolCall;
  onToggle: (id: string) => void;
}) {
  const [showSql, setShowSql] = useState(false);
  const label = toolCall.name === "query" ? "Queried database" : "Fetched schema";

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 text-xs">
      <button
        type="button"
        onClick={() => onToggle(toolCall.id)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-white/60 hover:text-white/80 transition-colors"
      >
        {toolCall.expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-mono text-accent/80">{label}</span>
        {!toolCall.result && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin shrink-0 text-white/40" />
        )}
      </button>

      {toolCall.expanded && (
        <div className="border-t border-white/10 px-3 py-2 space-y-2">
          {/* Result — shown first */}
          {toolCall.result ? (
            <div>
              <p className="mb-1 text-white/40 uppercase tracking-wider text-[10px]">Result</p>
              <pre className="max-h-48 overflow-y-auto overflow-x-auto rounded bg-black/30 p-2 font-mono text-white/70 text-[10px] whitespace-pre-wrap break-all">
                {prettifyJson(toolCall.result)}
              </pre>
            </div>
          ) : (
            <p className="text-white/30 italic">Waiting for result…</p>
          )}

          {/* Show SQL toggle — only for query tool */}
          {toolCall.name === "query" && !!toolCall.input.sql && (
            <div>
              <button
                type="button"
                onClick={() => setShowSql((v) => !v)}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
              >
                {showSql ? "Hide SQL" : "Show SQL"}
              </button>
              {showSql && (
                <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 font-mono text-accent/90 whitespace-pre-wrap break-all text-[10px]">
                  {String(toolCall.input.sql)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Markdown components (dark theme) ─────────────────────────────────────────

const markdownComponents: Components = {
  p:      ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em:     ({ children }) => <em className="italic text-white/80">{children}</em>,
  code:   ({ children }) => (
    <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[11px] text-accent/90">
      {children}
    </code>
  ),
  pre:    ({ children }) => (
    <pre className="my-1.5 overflow-x-auto rounded-lg bg-black/30 p-2.5 font-mono text-[11px] text-accent/90">
      {children}
    </pre>
  ),
  ul:     ({ children }) => <ul className="mb-1.5 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol:     ({ children }) => <ol className="mb-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li:     ({ children }) => <li>{children}</li>,
  h1:     ({ children }) => <h1 className="mb-2 text-base font-bold text-white">{children}</h1>,
  h2:     ({ children }) => <h2 className="mb-1.5 text-sm font-bold text-white">{children}</h2>,
  h3:     ({ children }) => <h3 className="mb-1 text-sm font-semibold text-white/90">{children}</h3>,
};

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onToggleTool,
}: {
  message: Message;
  onToggleTool: (msgId: string, toolId: string) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-gradient-to-br from-primary to-primary/60"
            : "bg-gradient-to-br from-accent/30 to-accent/10 border border-accent/30",
        )}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-white" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-accent" />
        )}
      </div>

      {/* Content */}
      <div className={cn("max-w-[80%] space-y-1", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-gradient-to-br from-primary/80 to-primary/60 text-white rounded-tr-sm"
              : "bg-white/5 border border-white/10 text-white/90 rounded-tl-sm",
          )}
        >
          {isUser && message.content ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : !isUser && message.content ? (
            <Markdown components={markdownComponents}>
              {message.content}
            </Markdown>
          ) : message.streaming ? (
            <span className="flex items-center gap-1.5 text-white/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Thinking…</span>
            </span>
          ) : null}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1 w-full">
            {message.toolCalls.map((tc) => (
              <ToolCallBlock
                key={tc.id}
                toolCall={tc}
                onToggle={(toolId) => onToggleTool(message.id, toolId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ChatPage ─────────────────────────────────────────────────────────────

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>(
    () => localStorage.getItem(PROVIDER_KEY) ?? "",
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch providers ─────────────────────────────────────────────────────────
  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/providers`);
      if (!res.ok) return;
      const data = (await res.json()) as ProviderInfo[];
      setProviders(data);
      // Auto-select first available provider
      setSelectedProvider((prev) => {
        const valid = prev && data.some((p) => p.id === prev);
        const first = data[0]?.id ?? "";
        const saved = localStorage.getItem(PROVIDER_KEY) ?? "";
        const savedValid = saved && data.some((p) => p.id === saved);
        return valid ? prev : savedValid ? saved : first;
      });
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // ── Handle OAuth redirect ────────────────────────────────────────────────────
  useEffect(() => {
    if (searchParams.get("oauth_connected") === "true") {
      setSearchParams({}, { replace: true });
      fetchProviders();
    }
  }, [searchParams, setSearchParams, fetchProviders]);

  // ── Persist state ────────────────────────────────────────────────────────────
  useEffect(() => {
    saveMessages(messages.filter((m) => !m.streaming));
  }, [messages]);

  useEffect(() => {
    if (selectedProvider) localStorage.setItem(PROVIDER_KEY, selectedProvider);
  }, [selectedProvider]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-resize textarea ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !selectedProvider) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };

    const assistantMsgId = `a-${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      toolCalls: [],
      streaming: true,
    };

    setInput("");
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    // Build the history to send (all non-streaming messages + new user msg)
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, providerId: selectedProvider }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Unknown error");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${errText}`, streaming: false }
              : m,
          ),
        );
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by \n\n)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            let event: ChatEvent;
            try {
              event = JSON.parse(line.slice(6)) as ChatEvent;
            } catch {
              continue;
            }

            if (event.type === "text_delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: m.content + event.content } : m,
                ),
              );
            } else if (event.type === "tool_start") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls ?? []),
                          {
                            id: event.id,
                            name: event.name,
                            input: event.input,
                            expanded: false,
                          },
                        ],
                      }
                    : m,
                ),
              );
            } else if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        toolCalls: (m.toolCalls ?? []).map((tc) =>
                          tc.id === event.id ? { ...tc, result: event.content } : tc,
                        ),
                      }
                    : m,
                ),
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: m.content
                          ? `${m.content}\n\n⚠️ ${event.message}`
                          : `⚠️ ${event.message}`,
                        streaming: false,
                      }
                    : m,
                ),
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, streaming: false } : m,
                ),
              );
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `⚠️ ${msg}`, streaming: false }
            : m,
        ),
      );
    }

    setStreaming(false);
  }, [input, streaming, selectedProvider, messages]);

  // ── Toggle tool call expansion ────────────────────────────────────────────────
  const handleToggleTool = useCallback((msgId: string, toolId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              toolCalls: (m.toolCalls ?? []).map((tc) =>
                tc.id === toolId ? { ...tc, expanded: !tc.expanded } : tc,
              ),
            }
          : m,
      ),
    );
  }, []);

  // ── Keyboard handler ──────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Selected provider info ────────────────────────────────────────────────────
  const providerInfo = providers.find((p) => p.id === selectedProvider);
  const needsOAuth = providerInfo?.authType === "oauth" && !providerInfo.oauthConnected;

  // ── Google Sign-in ────────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (!providerInfo) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/chat/auth/google/start?providerId=${encodeURIComponent(providerInfo.id)}`,
      );
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank");
    } catch {
      // ignore
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-0px)] lg:h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 bg-black/20 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/40 to-primary/20 border border-primary/30">
            <MessageSquare className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">AI Chat</h1>
            <p className="text-[10px] text-white/40">Powered by FPL database</p>
          </div>
        </div>

        {/* Provider selector */}
        <div className="flex items-center gap-2">
          {providers.length === 0 ? (
            <span className="text-xs text-white/40">No providers configured</span>
          ) : (
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} className="bg-[hsl(267,70%,8%)]">
                  {p.name}
                  {p.authType === "oauth" && !p.oauthConnected ? " (not signed in)" : ""}
                </option>
              ))}
            </select>
          )}

          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-lg px-2.5 py-1.5 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <MessageSquare className="h-7 w-7 text-primary/60" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white/80">Ask about FPL</h2>
              <p className="mt-1 text-sm text-white/40 max-w-xs">
                Ask anything about players, fixtures, teams, or stats. The AI will query the live database for you.
              </p>
            </div>
            <div className="grid gap-2 text-xs text-white/50 max-w-sm w-full">
              {[
                "Who are the top 5 players by points this season?",
                "Which midfielders have the best value (points per million)?",
                "Show me players with the most clean sheets",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setInput(suggestion)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 hover:text-white/70 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onToggleTool={handleToggleTool}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* OAuth sign-in prompt */}
      {needsOAuth && (
        <div className="mx-4 mb-2 rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3">
          <div className="text-sm text-white/60 flex-1">
            Sign in with Google to use{" "}
            <span className="text-white/80">{providerInfo?.name}</span>
          </div>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-white/90 transition-colors shrink-0"
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign in with Google
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-white/10 bg-black/20 backdrop-blur-xl p-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-primary/40 focus-within:bg-white/8 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              needsOAuth
                ? "Sign in with Google first…"
                : providers.length === 0
                ? "Configure a provider in llm-providers.json…"
                : "Ask about FPL data… (Enter to send, Shift+Enter for newline)"
            }
            disabled={streaming || needsOAuth || providers.length === 0}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-white/90 placeholder:text-white/25 focus:outline-none disabled:opacity-40 py-0.5 max-h-40"
            style={{ lineHeight: "1.5" }}
          />
          <button
            type="button"
            onClick={send}
            disabled={streaming || !input.trim() || needsOAuth || providers.length === 0}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all",
              input.trim() && !streaming && !needsOAuth
                ? "bg-primary text-white hover:bg-primary/80"
                : "bg-white/5 text-white/20",
            )}
          >
            {streaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/20">
          AI can make mistakes. Verify important data in the Players or Fixtures pages.
        </p>
      </div>
    </div>
  );
}
