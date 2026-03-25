import { createHash } from "node:crypto";
import type { AppDatabase } from "../db/database.js";
import { env } from "../config/env.js";
import { decryptCredentials, encryptCredentials } from "./credentialStore.js";
import { FplSessionClient } from "./fplSessionClient.js";

function now() {
  return new Date().toISOString();
}

type LinkedAccount = {
  id: number;
  email: string;
  encryptedCredentials: string;
  entryId: number | null;
};

function isAuthenticationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("FPL login failed") ||
    message.includes("FPL request failed (401)") ||
    message.includes("FPL request failed (403)") ||
    message.includes("no FPL team entry ID") ||
    message.includes("can no longer be decrypted") ||
    // Node/undici TLS errors that occur when the FPL login server rejects the session
    message.includes("Unsupported state or unable to authenticate data") ||
    message.includes("SSL routines") ||
    message.includes("ECONNRESET") ||
    message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")
  );
}

function normalizeSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Unsupported state or unable to authenticate data")) {
    return new Error(
      "Stored FPL credentials can no longer be decrypted. Re-enter your FPL password to relink this account.",
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function safeRank(value: number | null | undefined) {
  return value ?? 0;
}

export class MyTeamSyncService {
  constructor(private readonly db: AppDatabase) {}

  linkAccount(email: string, password: string, entryId?: number) {
    const encrypted = encryptCredentials({ email, password });
    const updatedAt = now();
    const result = this.db
      .prepare(
        `INSERT INTO my_team_accounts (email, encrypted_credentials, entry_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           encrypted_credentials = excluded.encrypted_credentials,
           entry_id = COALESCE(excluded.entry_id, my_team_accounts.entry_id),
           auth_status = 'linked',
           auth_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(email, encrypted, entryId ?? null, updatedAt);

    const existing = this.db
      .prepare("SELECT id FROM my_team_accounts WHERE email = ?")
      .get(email) as { id: number };
    return Number(result.lastInsertRowid || existing.id);
  }

  getAccounts() {
    return this.db
      .prepare(
        `SELECT id, email, manager_id AS managerId, entry_id AS entryId,
                player_first_name AS firstName, player_last_name AS lastName,
                team_name AS teamName, auth_status AS authStatus, auth_error AS authError,
                last_authenticated_at AS lastAuthenticatedAt
         FROM my_team_accounts
         ORDER BY updated_at DESC`,
      )
      .all();
  }

  async syncAll(force = false, requestedGameweek?: number) {
    const accounts = this.db
      .prepare(
        `SELECT id, email, encrypted_credentials AS encryptedCredentials, entry_id AS entryId
         FROM my_team_accounts
         ORDER BY id`,
      )
      .all() as LinkedAccount[];

    const results = [];
    for (const account of accounts) {
      try {
        results.push(await this.syncAccount(account.id, force, requestedGameweek));
      } catch (error) {
        results.push({
          accountId: account.id,
          entryId: account.entryId,
          syncedGameweeks: 0,
          error: error instanceof Error ? error.message : String(error),
          isAuthError: isAuthenticationError(error),
        });
      }
    }
    return results;
  }

  async syncAccount(accountId: number, force = false, requestedGameweek?: number) {
    const account = this.db
      .prepare(
        `SELECT id, email, encrypted_credentials AS encryptedCredentials, entry_id AS entryId
         FROM my_team_accounts
         WHERE id = ?`,
      )
      .get(accountId) as LinkedAccount | undefined;

    if (!account) {
      throw new Error(`My Team account ${accountId} not found.`);
    }

    try {
      const credentials = decryptCredentials(account.encryptedCredentials);
      const client = new FplSessionClient();
      await client.login(credentials.email, credentials.password);
      const me = await client.getMe();
      const entryId =
        me.player?.entry ??
        account.entryId ??
        await client.getEntryIdFromMyTeamPage();
      if (!entryId) {
        throw new Error(
          `FPL login succeeded, but no FPL team entry ID was returned for this account. Make sure this login has an active Fantasy Premier League team, then relink and try again. Resolver diagnostics: ${client.getEntryResolutionDiagnostics() || "none"}`,
        );
      }
      const profile = await client.getEntry(entryId);
      const history = await client.getEntryHistory(entryId);
      const currentGameweek = requestedGameweek ?? history.current.at(-1)?.event ?? 1;
      const transfers = await client.getTransfers(entryId);
      const picksToSync = requestedGameweek
        ? [requestedGameweek]
        : history.current.map((row) => row.event);

      const snapshot = createHash("sha256")
        .update(
          JSON.stringify({
            entryId,
            history,
            transfers,
            picksToSync,
          }),
        )
        .digest("hex");

      const prior = this.db
        .prepare("SELECT last_full_snapshot AS lastFullSnapshot FROM my_team_sync_status WHERE account_id = ?")
        .get(accountId) as { lastFullSnapshot: string | null } | undefined;

      if (!force && !requestedGameweek && prior?.lastFullSnapshot === snapshot) {
        return { accountId, entryId, syncedGameweeks: 0, noop: true };
      }

      this.db.transaction(() => {
        this.db
          .prepare(
            `UPDATE my_team_accounts
             SET manager_id = ?, entry_id = ?, player_first_name = ?, player_last_name = ?,
                 player_region_name = ?, team_name = ?, auth_status = 'authenticated',
                 auth_error = NULL, last_authenticated_at = ?, updated_at = ?
             WHERE id = ?`,
          )
            .run(
              me.player?.id ?? null,
              entryId,
              profile.player_first_name,
              profile.player_last_name,
              profile.player_region_name,
              profile.name || me.player?.entry_name || account.email,
              now(),
              now(),
              accountId,
            );

        this.db.prepare("DELETE FROM my_team_seasons WHERE account_id = ?").run(accountId);
        for (const season of history.past) {
          this.db
            .prepare(
              `INSERT INTO my_team_seasons (account_id, season_name, total_points, overall_rank, rank)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              accountId,
              season.season_name,
              season.total_points,
              safeRank(season.rank),
              safeRank(season.rank),
            );
        }

        if (!requestedGameweek) {
          this.db.prepare("DELETE FROM my_team_gameweeks WHERE account_id = ?").run(accountId);
          this.db.prepare("DELETE FROM my_team_transfers WHERE account_id = ?").run(accountId);
        }
      })();

      for (const row of history.current) {
        if (requestedGameweek && row.event !== requestedGameweek) continue;
        this.db
          .prepare(
            `INSERT INTO my_team_gameweeks (
               account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value,
               event_transfers, event_transfers_cost, points_on_bench, active_chip
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
               (SELECT active_chip FROM my_team_gameweeks WHERE account_id = ? AND gameweek_id = ?),
               NULL
             ))
             ON CONFLICT(account_id, gameweek_id) DO UPDATE SET
               points = excluded.points,
               total_points = excluded.total_points,
               overall_rank = excluded.overall_rank,
               rank = excluded.rank,
               bank = excluded.bank,
               value = excluded.value,
               event_transfers = excluded.event_transfers,
               event_transfers_cost = excluded.event_transfers_cost,
               points_on_bench = excluded.points_on_bench`,
          )
          .run(
            accountId,
            row.event,
            row.points,
            row.total_points,
            safeRank(row.overall_rank),
            safeRank(row.rank),
            row.bank,
            row.value,
            row.event_transfers,
            row.event_transfers_cost,
            row.points_on_bench,
            accountId,
            row.event,
          );
      }

      for (const transfer of transfers) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO my_team_transfers (
               account_id, transfer_id, gameweek_id, transferred_at, player_in_id, player_out_id,
               player_in_cost, player_out_cost
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            accountId,
            `${transfer.time}:${transfer.element_in}:${transfer.element_out}`,
            transfer.event,
            transfer.time,
            transfer.element_in,
            transfer.element_out,
            transfer.element_in_cost,
            transfer.element_out_cost,
          );
      }

      for (const gameweekId of picksToSync) {
        const picks = await client.getEventPicks(entryId, gameweekId);
        this.db.prepare("DELETE FROM my_team_picks WHERE account_id = ? AND gameweek_id = ?").run(accountId, gameweekId);
        this.db
          .prepare(
            `UPDATE my_team_gameweeks
             SET active_chip = ?, bank = ?, value = ?, event_transfers = ?, event_transfers_cost = ?, points_on_bench = ?,
                 points = ?, total_points = ?, overall_rank = ?, rank = ?
             WHERE account_id = ? AND gameweek_id = ?`,
          )
          .run(
            picks.active_chip,
            picks.entry_history.bank,
            picks.entry_history.value,
            picks.entry_history.event_transfers,
            picks.entry_history.event_transfers_cost,
            picks.entry_history.points_on_bench,
            picks.entry_history.points,
            picks.entry_history.total_points,
            safeRank(picks.entry_history.overall_rank),
            safeRank(picks.entry_history.rank),
            accountId,
            gameweekId,
          );

        for (const pick of picks.picks) {
          this.db
            .prepare(
              `INSERT INTO my_team_picks (
                 account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain,
                 selling_price, purchase_price
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              accountId,
              gameweekId,
              pick.element,
              pick.position,
              pick.multiplier,
              Number(pick.is_captain),
              Number(pick.is_vice_captain),
              pick.selling_price,
              pick.purchase_price,
            );
        }

        // Fetch live GW points from the public FPL API and store per-player
        try {
          const liveRes = await fetch(`${env.baseUrl}/event/${gameweekId}/live/`);
          if (liveRes.ok) {
            const liveData = await liveRes.json() as { elements: Array<{ id: number; stats: { total_points: number } }> };
            const pointsById = new Map(liveData.elements.map((e) => [e.id, e.stats.total_points]));
            const upsertPoints = this.db.prepare(
              `UPDATE my_team_picks SET gw_points = ? WHERE account_id = ? AND gameweek_id = ? AND player_id = ?`,
            );
            for (const pick of picks.picks) {
              const pts = pointsById.get(pick.element);
              if (pts !== undefined) {
                upsertPoints.run(pts, accountId, gameweekId, pick.element);
              }
            }
            // Recompute GW total from live points × multiplier so the stored value matches player cards
            const totalPoints = picks.picks
              .filter((p) => p.position <= 11)
              .reduce((sum, p) => sum + (pointsById.get(p.element) ?? 0) * p.multiplier, 0);
            const pointsOnBench = picks.picks
              .filter((p) => p.position > 11)
              .reduce((sum, p) => sum + (pointsById.get(p.element) ?? 0), 0);
            this.db
              .prepare(`UPDATE my_team_gameweeks SET points = ?, points_on_bench = ? WHERE account_id = ? AND gameweek_id = ?`)
              .run(totalPoints, pointsOnBench, accountId, gameweekId);
          }
        } catch {
          // live points are best-effort; don't fail the sync
        }
      }

      this.db
        .prepare(
          `INSERT INTO my_team_sync_status (account_id, last_full_snapshot, last_gameweek_snapshot, last_synced_at, last_error)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(account_id) DO UPDATE SET
             last_full_snapshot = excluded.last_full_snapshot,
             last_gameweek_snapshot = excluded.last_gameweek_snapshot,
             last_synced_at = excluded.last_synced_at,
             last_error = NULL`,
        )
        .run(accountId, requestedGameweek ? null : snapshot, requestedGameweek ? snapshot : null, now());

      return { accountId, entryId, syncedGameweeks: picksToSync.length, currentGameweek };
    } catch (error) {
      const normalizedError = normalizeSyncError(error);
      if (isAuthenticationError(normalizedError)) {
        this.db
          .prepare(
            `UPDATE my_team_accounts
             SET auth_status = 'relogin_required', auth_error = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(normalizedError.message, now(), accountId);

        this.db
          .prepare(
            `INSERT INTO my_team_sync_status (account_id, last_synced_at, last_error)
             VALUES (?, NULL, ?)
             ON CONFLICT(account_id) DO UPDATE SET
               last_error = excluded.last_error`,
          )
          .run(accountId, normalizedError.message);
      }

      throw normalizedError;
    }
  }
}
