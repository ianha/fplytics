import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { MyTeamSyncService } from "../src/my-team/myTeamSyncService.js";
import { createApp } from "../src/app.js";
import { seedPublicData } from "./myTeamFixtures.js";

vi.hoisted(() => {
  process.env.FPL_AUTH_SECRET = "test-fpl-secret";
});

vi.mock("../src/my-team/fplSessionClient.js", () => ({
  FplSessionClient: vi.fn().mockImplementation(() => ({
    login: vi.fn(async () => undefined),
    getMe: async () => ({ player: { id: 77, entry: 321, entry_name: "Midnight Press FC" } }),
    getEntry: async () => ({
      player_first_name: "Ian",
      player_last_name: "Harper",
      player_region_name: "Canada",
      name: "Midnight Press FC",
    }),
    getEntryHistory: async () => ({
      current: [
        {
          event: 7,
          points: 64,
          total_points: 612,
          overall_rank: 121482,
          rank: 121482,
          bank: 14,
          value: 1012,
          event_transfers: 1,
          event_transfers_cost: 4,
          points_on_bench: 6,
        },
      ],
      past: [],
    }),
    getTransfers: async () => [],
    getEventPicks: async () => ({
      active_chip: null,
      entry_history: {
        bank: 14,
        value: 1012,
        event_transfers: 1,
        event_transfers_cost: 4,
        points_on_bench: 6,
        points: 64,
        total_points: 612,
        overall_rank: 121482,
        rank: 121482,
      },
      picks: [
        { element: 11, position: 1, multiplier: 2, is_captain: true, is_vice_captain: false, selling_price: 110, purchase_price: 108 },
        { element: 10, position: 2, multiplier: 1, is_captain: false, is_vice_captain: true, selling_price: 105, purchase_price: 103 },
      ],
    }),
    getEntryIdFromMyTeamPage: async () => null,
    getEntryResolutionDiagnostics: () => "none",
  })),
}));

let tempDir = "";
let originalAssetsDir = "";
let originalPublicUrl = "";

function extractMetaContent(html: string, propertyOrName: string): string | null {
  const propertyMatch = html.match(new RegExp(`<meta[^>]+property="${propertyOrName}"[^>]+content="([^"]+)"`, "i"));
  if (propertyMatch) return propertyMatch[1];

  const nameMatch = html.match(new RegExp(`<meta[^>]+name="${propertyOrName}"[^>]+content="([^"]+)"`, "i"));
  return nameMatch?.[1] ?? null;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-recap-preview-"));
  originalAssetsDir = env.assetsDir;
  originalPublicUrl = env.publicUrl;
  env.assetsDir = path.join(tempDir, "assets");
  env.publicUrl = "";
});

afterEach(() => {
  env.assetsDir = originalAssetsDir;
  env.publicUrl = originalPublicUrl;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GET /api/my-team/:accountId/recap/:gw/preview", () => {
  async function setupDb() {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);
    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");
    await service.syncAccount(accountId, true);
    return { db, accountId };
  }

  it("returns HTML with asset-backed OG/Twitter meta tags and a fetchable image URL", async () => {
    const { db, accountId } = await setupDb();
    const app = createApp(db);

    const res = await request(app)
      .get(`/api/my-team/${accountId}/recap/7/preview`)
      .set("host", "localhost:4000");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    const ogImage = extractMetaContent(res.text, "og:image");
    const ogUrl = extractMetaContent(res.text, "og:url");

    expect(ogImage).toMatch(new RegExp(`^http://localhost:4000/assets/recaps/account-${accountId}-gw-7-[a-f0-9]{12}\\.png$`));
    expect(ogUrl).toBe(`http://localhost:4000/api/my-team/${accountId}/recap/7/preview`);
    expect(res.text).toContain('meta name="description"');
    expect(res.text).toContain('property="og:site_name" content="FPLytics"');
    expect(res.text).toContain('property="og:image:secure_url"');
    expect(res.text).toContain('property="og:image:width" content="480"');
    expect(res.text).toContain('property="og:image:height" content="320"');
    expect(res.text).toContain('property="og:image:type" content="image/png"');
    expect(res.text).toContain('property="og:title"');
    expect(res.text).toContain("Ian Harper");
    expect(res.text).toContain("GW7 Recap");
    expect(res.text).toContain('name="twitter:card" content="summary_large_image"');
    expect(res.text).toContain('name="twitter:image"');
    expect(res.text).toContain(`<img src="/assets/recaps/`);
    expect(res.text).toContain(">Open recap image<");

    const assetUrl = new URL(ogImage!);
    const assetRes = await request(app).get(assetUrl.pathname);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers["content-type"]).toMatch(/image\/png/);
    expect(assetRes.body.length).toBeGreaterThan(0);

    const recapFiles = fs.readdirSync(path.join(env.assetsDir, "recaps"));
    expect(recapFiles).toHaveLength(1);
  });

  it("returns 404 when no recap data exists for that account and gameweek", async () => {
    const { db, accountId } = await setupDb();
    const app = createApp(db);

    const res = await request(app).get(`/api/my-team/${accountId}/recap/99/preview`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid params", async () => {
    const { db } = await setupDb();
    const app = createApp(db);

    const res = await request(app).get("/api/my-team/0/recap/0/preview");

    expect(res.status).toBe(400);
  });

  it("builds absolute metadata URLs from forwarded host/protocol behind the proxy", async () => {
    const { db, accountId } = await setupDb();
    const app = createApp(db);

    const res = await request(app)
      .get(`/api/my-team/${accountId}/recap/7/preview`)
      .set("host", "internal-api:4000")
      .set("x-forwarded-proto", "https")
      .set("x-forwarded-host", "fplytics-dev.ianha.com");

    expect(res.status).toBe(200);
    expect(extractMetaContent(res.text, "og:url")).toBe(
      `https://fplytics-dev.ianha.com/api/my-team/${accountId}/recap/7/preview`,
    );
    expect(extractMetaContent(res.text, "og:image")).toMatch(
      new RegExp(`^https://fplytics-dev\\.ianha\\.com/assets/recaps/account-${accountId}-gw-7-[a-f0-9]{12}\\.png$`),
    );
  });

  it("builds absolute metadata URLs from the standard Forwarded header", async () => {
    const { db, accountId } = await setupDb();
    const app = createApp(db);

    const res = await request(app)
      .get(`/api/my-team/${accountId}/recap/7/preview`)
      .set("host", "localhost:4000")
      .set("forwarded", 'for=127.0.0.1;proto=https;host="fplytics-dev.ianha.com"');

    expect(res.status).toBe(200);
    expect(extractMetaContent(res.text, "og:url")).toBe(
      `https://fplytics-dev.ianha.com/api/my-team/${accountId}/recap/7/preview`,
    );
    expect(extractMetaContent(res.text, "og:image")).toMatch(
      new RegExp(`^https://fplytics-dev\\.ianha\\.com/assets/recaps/account-${accountId}-gw-7-[a-f0-9]{12}\\.png$`),
    );
  });

  it("falls back to PUBLIC_URL when the resolved host is localhost", async () => {
    env.publicUrl = "https://fplytics-dev.ianha.com";

    const { db, accountId } = await setupDb();
    const app = createApp(db);

    const res = await request(app)
      .get(`/api/my-team/${accountId}/recap/7/preview`)
      .set("host", "localhost:4000")
      .set("x-forwarded-proto", "https");

    expect(res.status).toBe(200);
    expect(extractMetaContent(res.text, "og:url")).toBe(
      `https://fplytics-dev.ianha.com/api/my-team/${accountId}/recap/7/preview`,
    );
    expect(extractMetaContent(res.text, "og:image")).toMatch(
      new RegExp(`^https://fplytics-dev\\.ianha\\.com/assets/recaps/account-${accountId}-gw-7-[a-f0-9]{12}\\.png$`),
    );
  });
});
