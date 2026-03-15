import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapFixture } from "./fixtures.js";
import { createDatabase } from "../src/db/database.js";
import { AssetSyncService } from "../src/services/assetSyncService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createPngBuffer(color: string) {
  return sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

function seedBootstrapRows(db: ReturnType<typeof createDatabase>) {
  const position = bootstrapFixture.element_types[0];
  const team = bootstrapFixture.teams[0];
  const player = bootstrapFixture.elements[0];

  db.prepare(
    `INSERT INTO positions (id, name, short_name, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(position.id, position.singular_name, position.singular_name_short, new Date().toISOString());

  db.prepare(
    `INSERT INTO teams (id, name, short_name, strength, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(team.id, team.name, team.short_name, team.strength, new Date().toISOString());

  db.prepare(
    `INSERT INTO players (
      id, web_name, first_name, second_name, team_id, position_id, now_cost,
      total_points, form, selected_by_percent, points_per_game, goals_scored,
      assists, clean_sheets, minutes, status, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    player.id,
    player.web_name,
    player.first_name,
    player.second_name,
    player.team,
    player.element_type,
    player.now_cost,
    player.total_points,
    Number(player.form),
    Number(player.selected_by_percent),
    Number(player.points_per_game),
    player.goals_scored,
    player.assists,
    player.clean_sheets,
    player.minutes,
    player.status,
    new Date().toISOString(),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AssetSyncService", () => {
  it("downloads player and team images as local JPEG files", async () => {
    const db = createDatabase(path.join(makeTempDir("fpl-assets-db-"), "test.sqlite"));
    const assetsDir = makeTempDir("fpl-assets-files-");
    seedBootstrapRows(db);

    const pngBuffer = await createPngBuffer("#04f5ff");
    const fetchMock = vi.fn(async () => new Response(pngBuffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new AssetSyncService(db, assetsDir);
    const result = await service.syncBootstrapAssets({
      ...bootstrapFixture,
      teams: bootstrapFixture.teams.slice(0, 1),
      elements: bootstrapFixture.elements.slice(0, 1),
    });

    expect(result).toEqual({
      playersDownloaded: 1,
      teamsDownloaded: 1,
      playerPlaceholdersGenerated: 0,
      teamPlaceholdersGenerated: 0,
      playersSkipped: 0,
      teamsSkipped: 0,
    });

    const playerPath = path.join(assetsDir, "players", "10.jpg");
    const teamPath = path.join(assetsDir, "teams", "1.jpg");
    expect(fs.existsSync(playerPath)).toBe(true);
    expect(fs.existsSync(teamPath)).toBe(true);
    await expect(sharp(playerPath).metadata()).resolves.toMatchObject({ format: "jpeg" });
    await expect(sharp(teamPath).metadata()).resolves.toMatchObject({ format: "jpeg" });

    const playerRow = db
      .prepare("SELECT image_path AS imagePath, image_source AS imageSource FROM players WHERE id = 10")
      .get() as { imagePath: string | null; imageSource: string | null };
    const teamRow = db
      .prepare("SELECT image_path AS imagePath, image_source AS imageSource FROM teams WHERE id = 1")
      .get() as { imagePath: string | null; imageSource: string | null };

    expect(playerRow).toEqual({
      imagePath: "/assets/players/10.jpg",
      imageSource: "10010.jpg",
    });
    expect(teamRow).toEqual({
      imagePath: "/assets/teams/1.jpg",
      imageSource: "badge:3",
    });
  });

  it("generates placeholder JPEG files when FPL image assets are unavailable", async () => {
    const db = createDatabase(path.join(makeTempDir("fpl-assets-db-"), "test.sqlite"));
    const assetsDir = makeTempDir("fpl-assets-files-");
    seedBootstrapRows(db);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 403 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new AssetSyncService(db, assetsDir);
    const result = await service.syncBootstrapAssets({
      ...bootstrapFixture,
      teams: bootstrapFixture.teams.slice(0, 1),
      elements: bootstrapFixture.elements.slice(0, 1),
    });

    expect(result).toEqual({
      playersDownloaded: 0,
      teamsDownloaded: 0,
      playerPlaceholdersGenerated: 1,
      teamPlaceholdersGenerated: 1,
      playersSkipped: 0,
      teamsSkipped: 0,
    });

    const playerMetadata = await sharp(path.join(assetsDir, "players", "10.jpg")).metadata();
    const teamMetadata = await sharp(path.join(assetsDir, "teams", "1.jpg")).metadata();
    expect(playerMetadata.format).toBe("jpeg");
    expect(teamMetadata.format).toBe("jpeg");
  });

  it("skips re-downloading assets that are already present for the same source", async () => {
    const db = createDatabase(path.join(makeTempDir("fpl-assets-db-"), "test.sqlite"));
    const assetsDir = makeTempDir("fpl-assets-files-");
    seedBootstrapRows(db);

    const pngBuffer = await createPngBuffer("#00ff87");
    const fetchMock = vi.fn(async () => new Response(pngBuffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new AssetSyncService(db, assetsDir);
    const payload = {
      ...bootstrapFixture,
      teams: bootstrapFixture.teams.slice(0, 1),
      elements: bootstrapFixture.elements.slice(0, 1),
    };

    await service.syncBootstrapAssets(payload);
    fetchMock.mockClear();

    const result = await service.syncBootstrapAssets(payload);

    expect(result).toEqual({
      playersDownloaded: 0,
      teamsDownloaded: 0,
      playerPlaceholdersGenerated: 0,
      teamPlaceholdersGenerated: 0,
      playersSkipped: 1,
      teamsSkipped: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-downloads assets on a forced sync even when the source key is unchanged", async () => {
    const db = createDatabase(path.join(makeTempDir("fpl-assets-db-"), "test.sqlite"));
    const assetsDir = makeTempDir("fpl-assets-files-");
    seedBootstrapRows(db);

    const pngBuffer = await createPngBuffer("#38003c");
    const fetchMock = vi.fn(async () => new Response(pngBuffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new AssetSyncService(db, assetsDir);
    const payload = {
      ...bootstrapFixture,
      teams: bootstrapFixture.teams.slice(0, 1),
      elements: bootstrapFixture.elements.slice(0, 1),
    };

    await service.syncBootstrapAssets(payload);
    fetchMock.mockClear();

    const result = await service.syncBootstrapAssets(payload, true);

    expect(result).toEqual({
      playersDownloaded: 1,
      teamsDownloaded: 1,
      playerPlaceholdersGenerated: 0,
      teamPlaceholdersGenerated: 0,
      playersSkipped: 0,
      teamsSkipped: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
