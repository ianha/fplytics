import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { BootstrapResponse } from "../client/fplApiClient.js";
import { env } from "../config/env.js";
import type { AppDatabase } from "../db/database.js";

type AssetSyncResult = {
  playersDownloaded: number;
  teamsDownloaded: number;
  playerPlaceholdersGenerated: number;
  teamPlaceholdersGenerated: number;
  playersSkipped: number;
  teamsSkipped: number;
};

type SyncOutcome = "downloaded" | "placeholder" | "skipped";

class MissingRemoteAssetError extends Error {
  constructor(
    readonly remoteUrl: string,
    readonly status: number,
  ) {
    super(`Missing remote asset ${remoteUrl}: ${status}`);
    this.name = "MissingRemoteAssetError";
  }
}

function playerAssetPath(playerId: number) {
  return `/assets/players/${playerId}.jpg`;
}

function teamAssetPath(teamId: number) {
  return `/assets/teams/${teamId}.jpg`;
}

function getPlayerImageSource(photo: string) {
  const photoId = photo.replace(".jpg", "");
  return {
    sourceKey: photo,
    remoteUrl: `https://resources.premierleague.com/premierleague/photos/players/250x250/p${photoId}.png`,
  };
}

function getTeamImageSource(teamCode: number) {
  return {
    sourceKey: `badge:${teamCode}`,
    remoteUrl: `https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`,
  };
}

function toInitials(label: string, maxLength = 3) {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "FPL";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, maxLength).toUpperCase();
  }

  return parts
    .slice(0, maxLength)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPlaceholderSvg(
  width: number,
  height: number,
  title: string,
  subtitle: string,
  accentColor: string,
) {
  const initials = toInitials(title);
  const safeTitle = escapeXml(title);
  const safeSubtitle = escapeXml(subtitle);

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#04f5ff" />
          <stop offset="100%" stop-color="${accentColor}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="24" fill="url(#bg)" />
      <circle cx="${width / 2}" cy="${height / 2 - 28}" r="${Math.min(width, height) * 0.22}" fill="rgba(56,0,60,0.18)" />
      <text x="50%" y="${height / 2 - 8}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(width * 0.16)}" font-weight="700" fill="#ffffff">${escapeXml(initials)}</text>
      <text x="50%" y="${height - 54}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(width * 0.09)}" font-weight="700" fill="#26002f">${safeTitle}</text>
      <text x="50%" y="${height - 24}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(width * 0.055)}" font-weight="600" fill="#4a155f">${safeSubtitle}</text>
    </svg>
  `;
}

export class AssetSyncService {
  constructor(
    private readonly db: AppDatabase,
    private readonly assetsDir = env.assetsDir,
  ) {}

  async syncBootstrapAssets(
    bootstrap: BootstrapResponse,
    force = false,
  ): Promise<AssetSyncResult> {
    fs.mkdirSync(path.join(this.assetsDir, "players"), { recursive: true });
    fs.mkdirSync(path.join(this.assetsDir, "teams"), { recursive: true });

    let playersDownloaded = 0;
    let teamsDownloaded = 0;
    let playerPlaceholdersGenerated = 0;
    let teamPlaceholdersGenerated = 0;
    let playersSkipped = 0;
    let teamsSkipped = 0;

    const teamCodes = new Map(bootstrap.teams.map((team) => [team.id, team.code]));

    for (const team of bootstrap.teams) {
      const outcome = await this.syncTeamImage(
        team.id,
        team.code,
        team.short_name,
        team.name,
        force,
      );
      if (outcome === "downloaded") {
        teamsDownloaded += 1;
      } else if (outcome === "placeholder") {
        teamPlaceholdersGenerated += 1;
      } else {
        teamsSkipped += 1;
      }
    }

    for (const player of bootstrap.elements) {
      const outcome = await this.syncPlayerImage(
        player.id,
        player.photo,
        teamCodes.get(player.team) ?? player.team_code ?? 0,
        player.web_name,
        force,
      );
      if (outcome === "downloaded") {
        playersDownloaded += 1;
      } else if (outcome === "placeholder") {
        playerPlaceholdersGenerated += 1;
      } else {
        playersSkipped += 1;
      }
    }

    return {
      playersDownloaded,
      teamsDownloaded,
      playerPlaceholdersGenerated,
      teamPlaceholdersGenerated,
      playersSkipped,
      teamsSkipped,
    };
  }

  private async syncPlayerImage(
    playerId: number,
    photo: string,
    teamCode: number,
    playerName: string,
    force: boolean,
  ): Promise<SyncOutcome> {
    const { sourceKey, remoteUrl } = getPlayerImageSource(photo);
    const relativePath = playerAssetPath(playerId);
    const absolutePath = path.join(
      this.assetsDir,
      relativePath.replace("/assets/", ""),
    );
    const existing = this.db
      .prepare(
        "SELECT image_path AS imagePath, image_source AS imageSource FROM players WHERE id = ?",
      )
      .get(playerId) as
      | { imagePath: string | null; imageSource: string | null }
      | undefined;

    if (
      !force &&
      existing?.imagePath === relativePath &&
      existing.imageSource === sourceKey &&
      fs.existsSync(absolutePath)
    ) {
      return "skipped";
    }

    let outcome: SyncOutcome = "downloaded";
    try {
      await this.downloadAsJpeg(remoteUrl, absolutePath);
    } catch (error) {
      if (!(error instanceof MissingRemoteAssetError)) {
        throw error;
      }

      await this.createPlaceholderJpeg(absolutePath, {
        width: 250,
        height: 250,
        title: playerName,
        subtitle: "Official portrait unavailable",
        accentColor: "#38003c",
      });
      outcome = "placeholder";
    }

    this.db
      .prepare(
        `UPDATE players
         SET image_path = ?, image_source = ?, photo = ?, team_code = ?
         WHERE id = ?`,
      )
      .run(relativePath, sourceKey, photo, teamCode, playerId);
    return outcome;
  }

  private async syncTeamImage(
    teamId: number,
    teamCode: number,
    teamShortName: string,
    teamName: string,
    force: boolean,
  ): Promise<SyncOutcome> {
    const { sourceKey, remoteUrl } = getTeamImageSource(teamCode);
    const relativePath = teamAssetPath(teamId);
    const absolutePath = path.join(
      this.assetsDir,
      relativePath.replace("/assets/", ""),
    );
    const existing = this.db
      .prepare(
        "SELECT image_path AS imagePath, image_source AS imageSource FROM teams WHERE id = ?",
      )
      .get(teamId) as
      | { imagePath: string | null; imageSource: string | null }
      | undefined;

    if (
      !force &&
      existing?.imagePath === relativePath &&
      existing.imageSource === sourceKey &&
      fs.existsSync(absolutePath)
    ) {
      return "skipped";
    }

    let outcome: SyncOutcome = "downloaded";
    try {
      await this.downloadAsJpeg(remoteUrl, absolutePath);
    } catch (error) {
      if (!(error instanceof MissingRemoteAssetError)) {
        throw error;
      }

      await this.createPlaceholderJpeg(absolutePath, {
        width: 180,
        height: 180,
        title: teamShortName,
        subtitle: teamName,
        accentColor: "#00ff87",
      });
      outcome = "placeholder";
    }

    this.db
      .prepare(
        `UPDATE teams
         SET image_path = ?, image_source = ?, code = ?
         WHERE id = ?`,
      )
      .run(relativePath, sourceKey, teamCode, teamId);
    return outcome;
  }

  private async downloadAsJpeg(remoteUrl: string, outputPath: string) {
    const response = await fetch(remoteUrl, {
      headers: {
        "user-agent": "fpl-clone/1.0",
      },
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        throw new MissingRemoteAssetError(remoteUrl, response.status);
      }

      throw new Error(`Failed to download image ${remoteUrl}: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await sharp(Buffer.from(arrayBuffer))
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(outputPath);
  }

  private async createPlaceholderJpeg(
    outputPath: string,
    options: {
      width: number;
      height: number;
      title: string;
      subtitle: string;
      accentColor: string;
    },
  ) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const svg = buildPlaceholderSvg(
      options.width,
      options.height,
      options.title,
      options.subtitle,
      options.accentColor,
    );
    await sharp(Buffer.from(svg))
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(outputPath);
  }
}
