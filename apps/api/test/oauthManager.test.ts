import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { getGoogleRedirectUri } from "../src/chat/oauthManager.js";

describe("oauthManager", () => {
  beforeEach(() => {
    env.publicUrl = "http://localhost:4000";
  });

  it("builds the Google redirect URI from the configured public API URL", () => {
    env.publicUrl = "https://api.fplytics.test";

    expect(getGoogleRedirectUri()).toBe("https://api.fplytics.test/api/chat/auth/google/callback");
  });
});
