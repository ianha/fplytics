import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env.js";
import type { AppDatabase } from "../db/database.js";

export type RecapData = {
  accountId: number;
  managerName: string;
  teamName: string;
  gameweek: number;
  points: number;
  totalPoints: number;
  overallRank: number;
  rankChange: number; // positive = rose, negative = fell
  bestPlayerName: string;
  bestPlayerPoints: number;
  captainName: string;
  captainPoints: number;
  hitsCost: number; // transfer penalty points (negative, e.g. -4)
};

export class RecapCardService {
  constructor(
    private readonly db: AppDatabase,
    private readonly assetsDir = env.assetsDir,
  ) {}

  getRecapData(accountId: number, gameweek: number): RecapData | null {
    // Account info
    const account = this.db
      .prepare(
        `SELECT player_first_name || ' ' || player_last_name AS managerName,
                team_name AS teamName
         FROM my_team_accounts WHERE id = ?`,
      )
      .get(accountId) as { managerName: string; teamName: string } | undefined;
    if (!account) return null;

    // Current GW stats
    const gw = this.db
      .prepare(
        `SELECT points, total_points AS totalPoints, overall_rank AS overallRank,
                event_transfers_cost AS hitsCost
         FROM my_team_gameweeks WHERE account_id = ? AND gameweek_id = ?`,
      )
      .get(accountId, gameweek) as
      | { points: number; totalPoints: number; overallRank: number; hitsCost: number }
      | undefined;
    if (!gw) return null;

    // Previous GW rank for rank change
    const prevGw = this.db
      .prepare(
        `SELECT overall_rank AS overallRank FROM my_team_gameweeks
         WHERE account_id = ? AND gameweek_id = ? AND overall_rank > 0`,
      )
      .get(accountId, gameweek - 1) as { overallRank: number } | undefined;
    const rankChange = prevGw ? prevGw.overallRank - gw.overallRank : 0;

    // Best player by gw_points (position <= 11, multiplier considered)
    const bestPlayer = this.db
      .prepare(
        `SELECT p.web_name AS playerName,
                mtp.gw_points * mtp.multiplier AS effectivePoints
         FROM my_team_picks mtp
         JOIN players p ON p.id = mtp.player_id
         WHERE mtp.account_id = ? AND mtp.gameweek_id = ? AND mtp.position <= 11
         ORDER BY effectivePoints DESC LIMIT 1`,
      )
      .get(accountId, gameweek) as
      | { playerName: string; effectivePoints: number }
      | undefined;

    // Captain
    const captain = this.db
      .prepare(
        `SELECT p.web_name AS playerName,
                mtp.gw_points * mtp.multiplier AS effectivePoints
         FROM my_team_picks mtp
         JOIN players p ON p.id = mtp.player_id
         WHERE mtp.account_id = ? AND mtp.gameweek_id = ? AND mtp.is_captain = 1
         LIMIT 1`,
      )
      .get(accountId, gameweek) as
      | { playerName: string; effectivePoints: number }
      | undefined;

    return {
      accountId,
      managerName: account.managerName.trim(),
      teamName: account.teamName,
      gameweek,
      points: gw.points,
      totalPoints: gw.totalPoints,
      overallRank: gw.overallRank,
      rankChange,
      bestPlayerName: bestPlayer?.playerName ?? "—",
      bestPlayerPoints: bestPlayer?.effectivePoints ?? 0,
      captainName: captain?.playerName ?? "—",
      captainPoints: captain?.effectivePoints ?? 0,
      hitsCost: gw.hitsCost ?? 0,
    };
  }

  async ensureCardAsset(data: RecapData): Promise<{ relativePath: string; absolutePath: string }> {
    const version = this.assetVersion(data);
    const fileName = `account-${data.accountId}-gw-${data.gameweek}-${version}.png`;
    const recapsDir = path.join(this.assetsDir, "recaps");
    const absolutePath = path.join(recapsDir, fileName);
    const relativePath = `/assets/recaps/${fileName}`;

    fs.mkdirSync(recapsDir, { recursive: true });

    if (!fs.existsSync(absolutePath)) {
      const png = await this.renderCard(data);
      await fs.promises.writeFile(absolutePath, png);
      await this.removeStaleAssets(recapsDir, `account-${data.accountId}-gw-${data.gameweek}-`, fileName);
    }

    return { relativePath, absolutePath };
  }

  async renderCard(data: RecapData): Promise<Buffer> {
    const rankDir = data.rankChange > 0 ? "▲" : data.rankChange < 0 ? "▼" : "—";
    const rankAbs = Math.abs(data.rankChange).toLocaleString();
    const rankChangeText =
      data.rankChange === 0
        ? "No change"
        : `${rankDir} ${rankAbs} places`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#37003c"/>
      <stop offset="100%" style="stop-color:#0d0118"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="480" height="320" fill="url(#bg)" rx="16"/>

  <!-- Top accent stripe -->
  <rect width="480" height="4" fill="#e90052" rx="0"/>

  <!-- Header -->
  <text x="24" y="38" font-family="system-ui, sans-serif" font-size="13" font-weight="700"
        fill="#e90052" letter-spacing="1">FPLYTICS</text>
  <text x="100" y="38" font-family="system-ui, sans-serif" font-size="13" fill="#ffffff50">&#9830;</text>
  <text x="116" y="38" font-family="system-ui, sans-serif" font-size="13" fill="#ffffff80">
    GW${data.gameweek} Recap
  </text>

  <!-- Divider -->
  <line x1="24" y1="52" x2="456" y2="52" stroke="#ffffff15" stroke-width="1"/>

  <!-- Manager / Team -->
  <text x="24" y="82" font-family="system-ui, sans-serif" font-size="20" font-weight="700"
        fill="#ffffff">${escSvg(data.teamName)}</text>
  <text x="24" y="102" font-family="system-ui, sans-serif" font-size="12" fill="#ffffff60">
    ${escSvg(data.managerName)}
  </text>

  <!-- Points + Rank row -->
  <text x="24" y="142" font-family="system-ui, sans-serif" font-size="36" font-weight="800"
        fill="#00ffbf">${data.points}</text>
  <text x="80" y="152" font-family="system-ui, sans-serif" font-size="13" fill="#ffffff60">pts</text>

  <text x="240" y="132" font-family="system-ui, sans-serif" font-size="12" fill="#ffffff50">
    Overall Rank
  </text>
  <text x="240" y="152" font-family="system-ui, sans-serif" font-size="18" font-weight="700"
        fill="#ffffff">${data.overallRank > 0 ? data.overallRank.toLocaleString() : "&#8212;"}</text>

  <!-- Rank change -->
  <text x="24" y="168" font-family="system-ui, sans-serif" font-size="12"
        fill="${data.rankChange > 0 ? "#4ade80" : data.rankChange < 0 ? "#f87171" : "#ffffff50"}">
    ${rankChangeText}
  </text>

  <!-- Divider -->
  <line x1="24" y1="184" x2="456" y2="184" stroke="#ffffff15" stroke-width="1"/>

  <!-- Stats -->
  <text x="24" y="210" font-family="system-ui, sans-serif" font-size="13" fill="#ffffff80">
    Best: ${escSvg(data.bestPlayerName)} &#8212; ${data.bestPlayerPoints} pts
  </text>
  <text x="24" y="234" font-family="system-ui, sans-serif" font-size="13" fill="#ffffff80">
    Captain: ${escSvg(data.captainName)} &#8212; ${data.captainPoints} pts
  </text>
  <text x="24" y="258" font-family="system-ui, sans-serif" font-size="13"
        fill="${data.hitsCost > 0 ? "#f87171" : "#ffffff80"}">
    Hits: ${data.hitsCost > 0 ? `-${data.hitsCost} pts` : "None"}
  </text>

  <!-- Divider -->
  <line x1="24" y1="274" x2="456" y2="274" stroke="#ffffff15" stroke-width="1"/>

  <!-- Footer -->
  <text x="24" y="298" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff40">
    #FPL  #GW${data.gameweek}  fplytics.app
  </text>
  <text x="420" y="298" font-family="system-ui, sans-serif" font-size="11"
        fill="#e90052" text-anchor="end">fplytics</text>
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private assetVersion(data: RecapData): string {
    const payload = [
      data.accountId,
      data.managerName,
      data.teamName,
      data.gameweek,
      data.points,
      data.totalPoints,
      data.overallRank,
      data.rankChange,
      data.bestPlayerName,
      data.bestPlayerPoints,
      data.captainName,
      data.captainPoints,
      data.hitsCost,
    ];

    return crypto
      .createHash('sha1')
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 12);
  }

  private async removeStaleAssets(recapsDir: string, prefix: string, keepFileName: string) {
    const entries = await fs.promises.readdir(recapsDir).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix) && entry !== keepFileName)
        .map((entry) => fs.promises.unlink(path.join(recapsDir, entry)).catch(() => undefined)),
    );
  }
}

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
