import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatRouter } from "../src/chat/chatRouter.js";
import { env } from "../src/config/env.js";

const providerConfigMocks = vi.hoisted(() => ({
  listProviderInfos: vi.fn(),
  getProviderById: vi.fn(),
}));

const oauthManagerMocks = vi.hoisted(() => ({
  getAuthUrl: vi.fn(),
  handleCallbackWithConfig: vi.fn(),
  hasTokens: vi.fn(),
}));

const providerStreamMocks = vi.hoisted(() => ({
  streamAnthropic: vi.fn(),
  streamGemini: vi.fn(),
  streamOpenAI: vi.fn(),
}));

vi.mock("../src/chat/providerConfig.js", () => providerConfigMocks);
vi.mock("../src/chat/oauthManager.js", () => oauthManagerMocks);
vi.mock("../src/chat/providers/anthropic.js", () => ({
  streamAnthropic: providerStreamMocks.streamAnthropic,
}));
vi.mock("../src/chat/providers/gemini.js", () => ({
  streamGemini: providerStreamMocks.streamGemini,
}));
vi.mock("../src/chat/providers/openai.js", () => ({
  streamOpenAI: providerStreamMocks.streamOpenAI,
}));

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", createChatRouter({} as any));
  return app;
}

describe("chatRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    providerConfigMocks.listProviderInfos.mockReturnValue([]);
    providerConfigMocks.getProviderById.mockReturnValue(undefined);
    oauthManagerMocks.hasTokens.mockReturnValue(false);
    oauthManagerMocks.getAuthUrl.mockReturnValue("https://accounts.google.test/oauth");
    oauthManagerMocks.handleCallbackWithConfig.mockResolvedValue(undefined);
    providerStreamMocks.streamAnthropic.mockResolvedValue(undefined);
    providerStreamMocks.streamGemini.mockResolvedValue(undefined);
    providerStreamMocks.streamOpenAI.mockResolvedValue(undefined);
    env.webUrl = "http://localhost:5173";
  });

  it("returns configured provider infos", async () => {
    providerConfigMocks.listProviderInfos.mockReturnValue([
      {
        id: "openai-main",
        name: "OpenAI",
        provider: "openai",
        model: "gpt-5.4",
        authType: "apiKey",
        oauthConnected: false,
      },
    ]);

    const response = await request(createTestApp()).get("/api/chat/providers").expect(200);

    expect(response.body).toEqual([
      {
        id: "openai-main",
        name: "OpenAI",
        provider: "openai",
        model: "gpt-5.4",
        authType: "apiKey",
        oauthConnected: false,
      },
    ]);
  });

  it("rejects streaming requests without messages and providerId", async () => {
    const response = await request(createTestApp()).post("/api/chat/stream").send({}).expect(400);

    expect(response.body).toEqual({ error: "messages and providerId are required" });
  });

  it("rejects streaming requests for unknown providers", async () => {
    const response = await request(createTestApp())
      .post("/api/chat/stream")
      .send({ providerId: "missing", messages: [{ role: "user", content: "hi" }] })
      .expect(404);

    expect(response.body).toEqual({ error: 'Provider "missing" not found' });
  });

  it("blocks oauth providers until tokens exist", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "google-main",
      name: "Gemini",
      provider: "google",
      model: "gemini-2.5-pro",
      auth: "oauth",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const response = await request(createTestApp())
      .post("/api/chat/stream")
      .send({ providerId: "google-main", messages: [{ role: "user", content: "hi" }] })
      .expect(401);

    expect(response.body).toEqual({
      error: 'Provider "google-main" requires OAuth sign-in first',
    });
    expect(oauthManagerMocks.hasTokens).toHaveBeenCalledWith("google-main");
  });

  it("streams provider events over SSE", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "openai-main",
      name: "OpenAI",
      provider: "openai",
      model: "gpt-5.4",
      apiKey: "secret",
    });
    providerStreamMocks.streamOpenAI.mockImplementation(async (_db, _config, messages, emit) => {
      expect(messages).toEqual([{ role: "user", content: "Who is top of the league?" }]);
      emit({ type: "text_delta", content: "Salah leads the way." });
      emit({ type: "done" });
    });

    const response = await request(createTestApp())
      .post("/api/chat/stream")
      .send({
        providerId: "openai-main",
        messages: [{ role: "user", content: "Who is top of the league?" }],
      })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain('data: {"type":"text_delta","content":"Salah leads the way."}');
    expect(response.text).toContain('data: {"type":"done"}');
  });

  it("emits an error event when the provider throws during streaming", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "openai-main",
      name: "OpenAI",
      provider: "openai",
      model: "gpt-5.4",
      apiKey: "secret",
    });
    providerStreamMocks.streamOpenAI.mockRejectedValue(new Error("provider exploded"));

    const response = await request(createTestApp())
      .post("/api/chat/stream")
      .send({ providerId: "openai-main", messages: [{ role: "user", content: "hi" }] })
      .expect(200);

    expect(response.text).toContain('data: {"type":"error","message":"provider exploded"}');
  });

  it("returns a google auth URL for oauth providers", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "google-main",
      name: "Gemini",
      provider: "google",
      model: "gemini-2.5-pro",
      auth: "oauth",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const response = await request(createTestApp())
      .get("/api/chat/auth/google/start")
      .query({ providerId: "google-main" })
      .expect(200);

    expect(response.body).toEqual({ url: "https://accounts.google.test/oauth" });
    expect(oauthManagerMocks.getAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ id: "google-main" }),
      "google-main",
    );
  });

  it("rejects oauth start requests for non-oauth providers", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "openai-main",
      name: "OpenAI",
      provider: "openai",
      model: "gpt-5.4",
      apiKey: "secret",
    });

    const response = await request(createTestApp())
      .get("/api/chat/auth/google/start")
      .query({ providerId: "openai-main" })
      .expect(400);

    expect(response.body).toEqual({ error: 'Provider "openai-main" is not an OAuth provider' });
  });

  it("redirects back to the web app after a successful oauth callback", async () => {
    env.webUrl = "https://app.fplytics.test";

    providerConfigMocks.getProviderById.mockReturnValue({
      id: "google-main",
      name: "Gemini",
      provider: "google",
      model: "gemini-2.5-pro",
      auth: "oauth",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const response = await request(createTestApp())
      .get("/api/chat/auth/google/callback")
      .query({ code: "auth-code", state: "google-main" })
      .expect(302);

    expect(response.headers.location).toBe("https://app.fplytics.test/chat?oauth_connected=true");
    expect(oauthManagerMocks.handleCallbackWithConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: "google-main" }),
      "auth-code",
      "google-main",
    );
  });

  it("surfaces oauth callback failures", async () => {
    providerConfigMocks.getProviderById.mockReturnValue({
      id: "google-main",
      name: "Gemini",
      provider: "google",
      model: "gemini-2.5-pro",
      auth: "oauth",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    oauthManagerMocks.handleCallbackWithConfig.mockRejectedValue(new Error("token exchange failed"));

    const response = await request(createTestApp())
      .get("/api/chat/auth/google/callback")
      .query({ code: "auth-code", state: "google-main" })
      .expect(500);

    expect(response.text).toBe("OAuth callback failed: token exchange failed");
  });
});
