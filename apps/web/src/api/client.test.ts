import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.fplytics.test/api");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("subscribes to live updates against the configured API origin", async () => {
    const close = vi.fn();
    const eventSourceMock = vi.fn(() => ({
      close,
      onmessage: null,
      onerror: null,
    }));
    vi.stubGlobal("EventSource", eventSourceMock as unknown as typeof EventSource);

    const { subscribeLiveGw } = await import("./client");
    const unsubscribe = subscribeLiveGw(38, vi.fn());

    expect(eventSourceMock).toHaveBeenCalledWith("https://api.fplytics.test/api/live/gw/38/stream");
    unsubscribe();
    expect(close).toHaveBeenCalled();
  });
});
