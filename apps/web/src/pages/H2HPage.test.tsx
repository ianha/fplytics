import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { H2HPage, resetH2HPageCacheForTests } from "./H2HPage";

const { getH2HComparisonMock, syncH2HRivalMock } = vi.hoisted(() => ({
  getH2HComparisonMock: vi.fn(),
  syncH2HRivalMock: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  getH2HComparison: getH2HComparisonMock,
  syncH2HRival: syncH2HRivalMock,
}));

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    syncRequired: false,
    rivalEntry: {
      entryId: 501,
      playerName: "Brad",
      teamName: "Brad FC",
      rank: 1,
      totalPoints: 130,
    },
    squadOverlap: {
      gameweek: 2,
      overlapPct: 86.7,
      sharedPlayers: [
        { id: 10, webName: "Saka", teamShortName: "ARS", nowCost: 105, positionName: "Midfielder" },
      ],
      userOnlyPlayers: [
        { id: 22, webName: "Isak", teamShortName: "CHE", nowCost: 85, positionName: "Forward" },
      ],
      rivalOnlyPlayers: [
        { id: 23, webName: "Palmer", teamShortName: "CHE", nowCost: 105, positionName: "Midfielder" },
      ],
    },
    gmRankHistory: [
      { gameweek: 1, userOverallRank: 120000, rivalOverallRank: 130000 },
      { gameweek: 2, userOverallRank: 90000, rivalOverallRank: 98000 },
    ],
    attribution: {
      totalPointDelta: 6,
      captaincy: {
        userPoints: 17,
        rivalPoints: 14,
        delta: 3,
        shareOfGap: 50,
      },
      transfers: {
        userHitCost: 0,
        rivalHitCost: 4,
        userNetImpact: 10,
        rivalNetImpact: 0,
        delta: 10,
      },
      bench: {
        userPointsOnBench: 11,
        rivalPointsOnBench: 9,
        delta: -2,
      },
    },
    positionalAudit: {
      rows: [
        {
          positionName: "Goalkeeper",
          userPoints: 34,
          rivalPoints: 31,
          pointDelta: 3,
          userSpend: 19.7,
          rivalSpend: 19.7,
          userValuePerMillion: 1.73,
          rivalValuePerMillion: 1.57,
          valueDelta: 0.16,
          trend: "lead",
        },
        {
          positionName: "Defender",
          userPoints: 20,
          rivalPoints: 20,
          pointDelta: 0,
          userSpend: 13,
          rivalSpend: 13,
          userValuePerMillion: 1.54,
          rivalValuePerMillion: 1.54,
          valueDelta: 0,
          trend: "level",
        },
        {
          positionName: "Midfielder",
          userPoints: 41,
          rivalPoints: 49,
          pointDelta: -8,
          userSpend: 24.6,
          rivalSpend: 35.1,
          userValuePerMillion: 1.67,
          rivalValuePerMillion: 1.4,
          valueDelta: 0.27,
          trend: "trail",
        },
      ],
    },
    luckVsSkill: {
      basedOnGameweek: 3,
      actualDelta: 6,
      expectedDelta: 1.4,
      userActualPoints: 132,
      rivalActualPoints: 126,
      userExpectedPoints: 58.2,
      rivalExpectedPoints: 56.8,
      userVariance: 73.8,
      rivalVariance: 69.2,
      varianceEdge: -4.6,
      verdict: "balanced",
      dataQuality: "full",
      missingPlayerProjections: 0,
    },
    syncStatus: {
      currentGameweek: 3,
      lastSyncedGw: 2,
      stale: false,
      fetchedAt: "2026-04-13T09:00:00.000Z",
    },
    ...overrides,
  };
}

function renderH2HPage(initialEntries = ["/leagues/99/h2h/501"]) {
  return {
    ...render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/leagues" element={<H2HPage />} />
          <Route path="/leagues/:leagueId/h2h/:rivalEntryId" element={<H2HPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  };
}

describe("H2HPage", () => {
  beforeEach(() => {
    resetH2HPageCacheForTests();
    vi.clearAllMocks();
  });

  it("renders the first synced h2h slice for a rival route", async () => {
    getH2HComparisonMock.mockResolvedValue(buildPayload());

    renderH2HPage();

    expect(await screen.findByRole("heading", { name: /Brad FC/i })).toBeInTheDocument();
    expect(screen.getByText(/86.7% overlap/i)).toBeInTheDocument();
    expect(screen.getByText(/Isak/i)).toBeInTheDocument();
    expect(screen.getByText(/Palmer/i)).toBeInTheDocument();
    expect(screen.getAllByText(/GW 2/i).length).toBeGreaterThan(0);
  });

  it("renders points attribution and positional audit sections for a synced rival", async () => {
    getH2HComparisonMock.mockResolvedValue(buildPayload());

    renderH2HPage();

    expect(await screen.findByRole("heading", { name: /Brad FC/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Points attribution/i })).toBeInTheDocument();
    expect(screen.getByText(/Captaincy swing/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\+3 pts/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/\+50\.0% of gap/i)).toBeInTheDocument();
    expect(screen.getByText(/Transfer net impact/i)).toBeInTheDocument();
    expect(screen.getByText(/You: \+10 · Rival: 0/i)).toBeInTheDocument();
    expect(screen.getByText(/Bench points stranded/i)).toBeInTheDocument();
    expect(screen.getByText(/You left 2 more pts on the bench/i)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: /Positional audit/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Goalkeeper$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Midfielder$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Lead/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Level/i)).toBeInTheDocument();
    expect(screen.queryByText(/Defender[\s\S]*under-index/i)).not.toBeInTheDocument();
  });

  it("renders a luck-vs-skill card for the current comparison", async () => {
    getH2HComparisonMock.mockResolvedValue(buildPayload());

    renderH2HPage();

    expect(await screen.findByRole("heading", { name: /Luck vs skill/i })).toBeInTheDocument();
    expect(screen.getByText(/Expected edge/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1\.4 pts/i)).toBeInTheDocument();
    expect(screen.getByText(/Variance edge/i)).toBeInTheDocument();
    expect(screen.getByText(/Balanced/i)).toBeInTheDocument();
  });

  it("shows a sync-required state instead of comparison sections when rival data is missing", async () => {
    getH2HComparisonMock.mockResolvedValue(
      buildPayload({
        syncRequired: true,
        squadOverlap: null,
        gmRankHistory: [],
        attribution: null,
        positionalAudit: null,
        luckVsSkill: null,
        syncStatus: {
          currentGameweek: 3,
          lastSyncedGw: null,
          stale: false,
          fetchedAt: null,
        },
      }),
    );

    renderH2HPage();

    expect(await screen.findByText(/Sync this rival to load comparison insights/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync rival now/i })).toBeInTheDocument();
    expect(screen.queryByText(/86.7% overlap/i)).not.toBeInTheDocument();
  });

  it("refetches on rival change and does not reuse the previous rival payload", async () => {
    getH2HComparisonMock
      .mockResolvedValueOnce(buildPayload())
      .mockResolvedValueOnce(
        buildPayload({
          rivalEntry: {
            entryId: 502,
            playerName: "Sean",
            teamName: "Sean FC",
            rank: 2,
            totalPoints: 125,
          },
          squadOverlap: {
            gameweek: 2,
            overlapPct: 73.3,
            sharedPlayers: [],
            userOnlyPlayers: [],
            rivalOnlyPlayers: [],
          },
        }),
      );

    const firstRender = renderH2HPage(["/leagues/99/h2h/501"]);

    expect(await screen.findByRole("heading", { name: /Brad FC/i })).toBeInTheDocument();

    firstRender.unmount();
    renderH2HPage(["/leagues/99/h2h/502"]);

    expect(await screen.findByRole("heading", { name: /Sean FC/i })).toBeInTheDocument();
    expect(screen.getByText(/73.3% overlap/i)).toBeInTheDocument();
    expect(getH2HComparisonMock).toHaveBeenNthCalledWith(1, 99, 501);
    expect(getH2HComparisonMock).toHaveBeenNthCalledWith(2, 99, 502);
  });

  it("re-syncs a stale rival and refetches the comparison instead of serving stale cache", async () => {
    getH2HComparisonMock
      .mockResolvedValueOnce(
        buildPayload({
          syncStatus: {
            currentGameweek: 3,
            lastSyncedGw: 2,
            stale: true,
            fetchedAt: "2026-04-13T08:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        buildPayload({
          syncStatus: {
            currentGameweek: 3,
            lastSyncedGw: 3,
            stale: false,
            fetchedAt: "2026-04-13T10:00:00.000Z",
          },
        }),
      );
    syncH2HRivalMock.mockResolvedValue({ entryId: 501, syncedGameweeks: 3, lastSyncedGw: 3 });

    renderH2HPage();

    expect(await screen.findByText(/Last synced through GW 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-sync rival/i }));

    await waitFor(() => {
      expect(syncH2HRivalMock).toHaveBeenCalledWith(99, 501, {});
    });
    await waitFor(() => {
      expect(getH2HComparisonMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/Last synced through GW 2/i)).not.toBeInTheDocument();
  });
});
