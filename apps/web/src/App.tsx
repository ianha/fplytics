import { useEffect, useState } from "react";
import type { OverviewResponse, PlayerCard, PlayerDetail } from "@fpl/contracts";
import { getOverview, getPlayer, getPlayers, resolveAssetUrl } from "./api/client";
import { StatPill } from "./components/StatPill";
import { formatCost, formatPercent } from "./lib/format";
import "./styles/global.css";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const initialOverview: AsyncState<OverviewResponse> = { status: "loading" };
const initialPlayers: AsyncState<PlayerCard[]> = { status: "loading" };
const initialPlayerDetail: AsyncState<PlayerDetail | null> = {
  status: "ready",
  data: null,
};

export default function App() {
  const [overview, setOverview] = useState(initialOverview);
  const [players, setPlayers] = useState(initialPlayers);
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayerDetail);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void getOverview()
      .then((data) => setOverview({ status: "ready", data }))
      .catch((error: Error) =>
        setOverview({ status: "error", message: error.message }),
      );
  }, []);

  useEffect(() => {
    void getPlayers(search)
      .then((data) => {
        setPlayers({ status: "ready", data });
        if (data[0]) {
          return getPlayer(data[0].id).then((detail) =>
            setSelectedPlayer({ status: "ready", data: detail }),
          );
        }
        setSelectedPlayer({ status: "ready", data: null });
      })
      .catch((error: Error) =>
        setPlayers({ status: "error", message: error.message }),
      );
  }, [search]);

  const currentGameweek =
    overview.status === "ready"
      ? overview.data.gameweeks.find((gameweek) => gameweek.isCurrent) ??
        overview.data.gameweeks[0]
      : null;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Fantasy Premier League clone</p>
          <h1>Track form, fixtures, and gameweeks from a local FPL mirror.</h1>
          <p className="hero-copy">
            Public FPL data is synced into SQLite and served through a local API,
            giving you a fast, inspectable foundation for analytics or a custom
            fantasy dashboard.
          </p>
        </div>
        {currentGameweek ? (
          <div className="deadline-card">
            <span>Current deadline</span>
            <strong>{currentGameweek.name}</strong>
            <p>{new Date(currentGameweek.deadlineTime).toLocaleString()}</p>
          </div>
        ) : null}
      </section>

      {overview.status === "ready" ? (
        <>
          <section className="panel overview-grid">
            {overview.data.topPlayers.map((player) => (
              <article className="player-highlight" key={player.id}>
                <div className="player-highlight-header">
                  <span>{player.teamShortName}</span>
                  {player.imagePath ? (
                    <img
                      alt={`${player.webName} portrait`}
                      className="player-image"
                      src={resolveAssetUrl(player.imagePath) ?? undefined}
                    />
                  ) : null}
                </div>
                <h2>{player.webName}</h2>
                <div className="pill-row">
                  <StatPill label="Points" value={player.totalPoints} />
                  <StatPill label="Form" value={player.form.toFixed(1)} />
                  <StatPill
                    label="xGI"
                    value={player.expectedGoalInvolvements.toFixed(1)}
                  />
                  <StatPill label="Price" value={formatCost(player.nowCost)} />
                </div>
              </article>
            ))}
          </section>

          <section className="dashboard-grid">
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Fixtures</p>
                  <h2>Upcoming and live schedule</h2>
                </div>
              </div>
              <div className="fixture-list">
                {overview.data.fixtures.map((fixture) => (
                  <article className="fixture-card" key={fixture.id}>
                    <div>
                      {overview.data.teams.find((team) => team.id === fixture.teamH)?.imagePath ? (
                        <img
                          alt={`${fixture.teamHName} badge`}
                          className="team-badge"
                          src={
                            resolveAssetUrl(
                              overview.data.teams.find((team) => team.id === fixture.teamH)
                                ?.imagePath ?? null,
                            ) ?? undefined
                          }
                        />
                      ) : null}
                      <strong>{fixture.teamHShortName}</strong>
                      <span>{fixture.teamHName}</span>
                    </div>
                    <div className="fixture-score">
                      {fixture.teamHScore ?? "-"} : {fixture.teamAScore ?? "-"}
                    </div>
                    <div>
                      {overview.data.teams.find((team) => team.id === fixture.teamA)?.imagePath ? (
                        <img
                          alt={`${fixture.teamAName} badge`}
                          className="team-badge"
                          src={
                            resolveAssetUrl(
                              overview.data.teams.find((team) => team.id === fixture.teamA)
                                ?.imagePath ?? null,
                            ) ?? undefined
                          }
                        />
                      ) : null}
                      <strong>{fixture.teamAShortName}</strong>
                      <span>{fixture.teamAName}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Players</p>
                  <h2>Search the player pool</h2>
                </div>
                <input
                  aria-label="Search players"
                  className="search-input"
                  placeholder="Search by name"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              {players.status === "ready" ? (
                <div className="player-grid">
                  {players.data.map((player) => (
                    <button
                      className="player-card"
                      key={player.id}
                      onClick={() =>
                        void getPlayer(player.id).then((detail) =>
                          setSelectedPlayer({ status: "ready", data: detail }),
                        )
                      }
                      type="button"
                    >
                      <div className="player-card-header">
                        <div className="player-card-title">
                          {player.imagePath ? (
                            <img
                              alt={`${player.webName} portrait`}
                              className="player-image player-image-small"
                              src={resolveAssetUrl(player.imagePath) ?? undefined}
                            />
                          ) : null}
                          <h3>{player.webName}</h3>
                        </div>
                        <span>{player.teamShortName}</span>
                      </div>
                      <p>{player.positionName}</p>
                      <div className="player-card-stats">
                        <span>{player.totalPoints} pts</span>
                        <span>{formatPercent(player.selectedByPercent)}</span>
                        <span>{formatCost(player.nowCost)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          </section>

          {selectedPlayer.status === "ready" && selectedPlayer.data ? (
            <section className="panel detail-panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Selected player</p>
                  <div className="detail-player-header">
                    {selectedPlayer.data.player.imagePath ? (
                      <img
                        alt={`${selectedPlayer.data.player.webName} portrait`}
                        className="player-image"
                        src={resolveAssetUrl(selectedPlayer.data.player.imagePath) ?? undefined}
                      />
                    ) : null}
                    <h2>{selectedPlayer.data.player.firstName} {selectedPlayer.data.player.secondName}</h2>
                  </div>
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-column">
                  <div className="pill-row">
                    <StatPill
                      label="Points"
                      value={selectedPlayer.data.player.totalPoints}
                    />
                    <StatPill
                      label="Goals"
                      value={selectedPlayer.data.player.goalsScored}
                    />
                    <StatPill
                      label="Assists"
                      value={selectedPlayer.data.player.assists}
                    />
                    <StatPill
                      label="xG"
                      value={selectedPlayer.data.player.expectedGoals.toFixed(2)}
                    />
                    <StatPill
                      label="xA"
                      value={selectedPlayer.data.player.expectedAssists.toFixed(2)}
                    />
                    <StatPill
                      label="T"
                      value={selectedPlayer.data.player.tackles}
                    />
                    <StatPill
                      label="Price"
                      value={formatCost(selectedPlayer.data.player.nowCost)}
                    />
                  </div>
                  <div className="history-list">
                    {selectedPlayer.data.history.map((history) => (
                      <article className="history-row" key={history.round}>
                        <strong>GW {history.round}</strong>
                        <span>{history.totalPoints} pts</span>
                        <span>{history.minutes} mins</span>
                        <span>{history.goalsScored} G / {history.assists} A</span>
                        <span>xGI {history.expectedGoalInvolvements.toFixed(2)}</span>
                        <span>T {history.tackles}</span>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="detail-column">
                  <h3>Upcoming fixtures</h3>
                  <div className="history-list">
                    {selectedPlayer.data.upcomingFixtures.map((fixture) => (
                      <article className="history-row" key={fixture.id}>
                        <strong>{fixture.teamHShortName} vs {fixture.teamAShortName}</strong>
                        <span>GW {fixture.eventId ?? "TBD"}</span>
                        <span>
                          {fixture.kickoffTime
                            ? new Date(fixture.kickoffTime).toLocaleString()
                            : "TBD"}
                        </span>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {overview.status === "error" ? (
        <section className="panel">
          <h2>Unable to load overview</h2>
          <p>{overview.message}</p>
        </section>
      ) : null}
    </main>
  );
}
