import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makePlayer } from "./test/factories";

const apiMocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getGameweeks: vi.fn(),
  getPlayers: vi.fn(),
  getMyTeam: vi.fn(),
  getMyTeamGameweekPicks: vi.fn(),
  getTransferDecision: vi.fn(),
  linkMyTeamAccount: vi.fn(),
  syncMyTeam: vi.fn(),
  getPlayer: vi.fn(),
  resolveAssetUrl: vi.fn((imagePath: string | null) =>
    imagePath ? `http://localhost:4000${imagePath}` : null,
  ),
}));

const mockPlayers = [
  makePlayer(10, 3, 1, 215),
  ...Array.from({ length: 4 }, (_, index) => makePlayer(index + 1, 1, index + 1, 100 - index)),
  ...Array.from({ length: 9 }, (_, index) => makePlayer(index + 20, 2, (index % 6) + 1, 120 - index)),
  ...Array.from({ length: 9 }, (_, index) => makePlayer(index + 40, 3, (index % 6) + 1, 140 - index)),
  ...Array.from({ length: 6 }, (_, index) => makePlayer(index + 60, 4, (index % 6) + 1, 160 - index)),
];

vi.mock("./api/client", () => ({
  resolveAssetUrl: apiMocks.resolveAssetUrl,
  getOverview: apiMocks.getOverview,
  getGameweeks: apiMocks.getGameweeks,
  getPlayers: apiMocks.getPlayers,
  getMyTeam: apiMocks.getMyTeam,
  getMyTeamGameweekPicks: apiMocks.getMyTeamGameweekPicks,
  getTransferDecision: apiMocks.getTransferDecision,
  linkMyTeamAccount: apiMocks.linkMyTeamAccount,
  syncMyTeam: apiMocks.syncMyTeam,
  getPlayer: apiMocks.getPlayer,
  getPlayerXpts: vi.fn(() => Promise.resolve([])),
  getCaptainRecommendation: vi.fn(() => Promise.resolve([])),
  subscribeLiveGw: vi.fn(() => vi.fn()),
  getLiveGwSnapshot: vi.fn(() => Promise.resolve(null)),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.getOverview.mockResolvedValue({
    generatedAt: "2026-03-14T00:00:00Z",
    gameweeks: [
      {
        id: 1,
        name: "Gameweek 1",
        deadlineTime: "2026-08-15T10:00:00Z",
        averageEntryScore: 57,
        highestScore: 102,
        isCurrent: true,
        isFinished: false,
      },
    ],
    topPlayers: [
      {
        id: 10,
        webName: "Saka",
        firstName: "Bukayo",
        secondName: "Saka",
        teamId: 1,
        teamName: "Arsenal",
        teamShortName: "ARS",
        imagePath: "/assets/players/10.jpg",
        positionId: 3,
        positionName: "Midfielder",
        nowCost: 105,
        totalPoints: 215,
        form: 7.8,
        selectedByPercent: 35.6,
        pointsPerGame: 6.1,
        goalsScored: 16,
        assists: 12,
        cleanSheets: 10,
        minutes: 2890,
        bonus: 30,
        bps: 620,
        creativity: 980.5,
        influence: 1122.4,
        threat: 901.7,
        ictIndex: 300.4,
        expectedGoals: 14.6,
        expectedAssists: 11.2,
        expectedGoalInvolvements: 25.8,
        expectedGoalPerformance: 1.4,
        expectedAssistPerformance: 0.8,
        expectedGoalInvolvementPerformance: 2.2,
        expectedGoalsConceded: 22.3,
        cleanSheetsPer90: 0.31,
        starts: 33,
        tackles: 54,
        recoveries: 146,
        defensiveContribution: 88,
        status: "a",
      },
    ],
    fixtures: [
      {
        id: 1,
        code: 111,
        eventId: 1,
        kickoffTime: "2026-08-16T15:30:00Z",
        teamH: 1,
        teamA: 2,
        teamHName: "Arsenal",
        teamAName: "Chelsea",
        teamHShortName: "ARS",
        teamAShortName: "CHE",
        teamHScore: null,
        teamAScore: null,
        finished: false,
        started: false,
      },
    ],
    teams: [
      {
        id: 1,
        name: "Arsenal",
        shortName: "ARS",
        strength: 5,
        imagePath: "/assets/teams/1.jpg",
      },
      {
        id: 2,
        name: "Chelsea",
        shortName: "CHE",
        strength: 4,
        imagePath: "/assets/teams/2.jpg",
      },
    ],
  });
    apiMocks.getGameweeks.mockResolvedValue([
    {
      id: 1,
      name: "Gameweek 1",
      deadlineTime: "2026-08-15T10:00:00Z",
      averageEntryScore: 57,
      highestScore: 102,
      isCurrent: true,
      isFinished: false,
    },
    {
      id: 2,
      name: "Gameweek 2",
      deadlineTime: "2026-08-22T10:00:00Z",
      averageEntryScore: null,
      highestScore: null,
      isCurrent: false,
      isFinished: false,
    },
  ]);
    apiMocks.getPlayers.mockResolvedValue(mockPlayers);
    apiMocks.getMyTeam.mockResolvedValue({
    accounts: [
      {
        id: 1,
        email: "ian@fpl.local",
        entryId: 101,
        managerName: "Ian Harper",
        teamName: "Midnight Press FC",
        authStatus: "authenticated",
        authError: null,
        lastAuthenticatedAt: "2026-03-20T12:00:00.000Z",
      },
    ],
    selectedAccountId: 1,
    currentGameweek: 1,
    freeTransfers: 2,
    bank: 14,
    overallPoints: 612,
    overallRank: 121482,
    teamName: "Midnight Press FC",
    managerName: "Ian Harper",
    picks: mockPlayers.slice(0, 15).map((player, index) => ({
      slotId: `pick-${index + 1}`,
      position: index + 1,
      multiplier: index < 11 ? 1 : 0,
      isCaptain: index === 1,
      isViceCaptain: index === 2,
      sellingPrice: player.nowCost,
      purchasePrice: player.nowCost - 2,
      role: index < 11 ? "starter" : "bench",
      benchOrder: index < 11 ? null : index - 10,
      player,
    })),
    transfers: [],
    seasons: [],
    history: [
      {
        gameweek: 1,
        points: 64,
        totalPoints: 612,
        overallRank: 121482,
        rank: 121482,
        bank: 14,
        value: 1012,
        eventTransfers: 1,
        eventTransfersCost: 4,
        pointsOnBench: 6,
        activeChip: null,
      },
    ],
  });
    apiMocks.getMyTeamGameweekPicks.mockResolvedValue({
    gameweek: 1,
    picks: mockPlayers.slice(0, 15).map((player, index) => ({
      slotId: `pick-${index + 1}`,
      position: index + 1,
      multiplier: index < 11 ? 1 : 0,
      isCaptain: index === 1,
      isViceCaptain: index === 2,
      sellingPrice: player.nowCost,
      purchasePrice: player.nowCost - 2,
      role: index < 11 ? "starter" : "bench",
      benchOrder: index < 11 ? null : index - 10,
      gwPoints: 0,
      player,
    })),
    totalPoints: 64,
    pointsOnBench: 6,
  });
    apiMocks.getTransferDecision.mockResolvedValue({
    gameweek: 1,
    freeTransfers: 2,
    bank: 14,
    horizon: 3,
    recommendedOptionId: "roll",
    options: [
      {
        id: "roll",
        label: "roll",
        transfers: [],
        horizon: 3,
        projectedGain: 0,
        nextGwGain: 0,
        hitCost: 0,
        remainingBank: 14,
        confidence: "medium",
        reasons: ["Sets the baseline for this week's decision."],
        warnings: [],
      },
    ],
  });
    apiMocks.getPlayer.mockResolvedValue({
    player: {
      id: 10,
      webName: "Saka",
      firstName: "Bukayo",
      secondName: "Saka",
      teamId: 1,
      teamName: "Arsenal",
      teamShortName: "ARS",
      imagePath: "/assets/players/10.jpg",
      positionId: 3,
      positionName: "Midfielder",
      nowCost: 105,
      totalPoints: 215,
      form: 7.8,
      selectedByPercent: 35.6,
      pointsPerGame: 6.1,
      goalsScored: 16,
      assists: 12,
      cleanSheets: 10,
      minutes: 2890,
      bonus: 30,
      bps: 620,
      creativity: 980.5,
      influence: 1122.4,
      threat: 901.7,
      ictIndex: 300.4,
      expectedGoals: 14.6,
      expectedAssists: 11.2,
      expectedGoalInvolvements: 25.8,
      expectedGoalPerformance: 1.4,
      expectedAssistPerformance: 0.8,
      expectedGoalInvolvementPerformance: 2.2,
      expectedGoalsConceded: 22.3,
      cleanSheetsPer90: 0.31,
      starts: 33,
      tackles: 54,
      recoveries: 146,
      defensiveContribution: 88,
      status: "a",
    },
    history: [
      {
        element: 10,
        round: 1,
        totalPoints: 12,
        minutes: 90,
        goalsScored: 1,
        assists: 1,
        cleanSheets: 1,
        bonus: 3,
        bps: 42,
        creativity: 28.4,
        influence: 55.1,
        threat: 48.9,
        ictIndex: 13.2,
        expectedGoals: 0.64,
        expectedAssists: 0.31,
        expectedGoalInvolvements: 0.95,
        expectedGoalPerformance: 0.36,
        expectedAssistPerformance: 0.69,
        expectedGoalInvolvementPerformance: 1.05,
        expectedGoalsConceded: 0.74,
        tackles: 4,
        recoveries: 8,
        clearancesBlocksInterceptions: 2,
        defensiveContribution: 5,
        starts: 1,
        opponentTeam: 2,
        value: 105,
        wasHome: true,
        kickoffTime: "2026-08-16T15:30:00Z",
      },
    ],
    upcomingFixtures: [],
  });
  });

  it("renders shared navigation and loads dashboard data on the root route", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My Team/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Players/i }).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: /Gameweek 1/i })).toBeInTheDocument();
    expect(apiMocks.getOverview).toHaveBeenCalled();
  });

  it("renders the my-team route inside the shared shell", async () => {
    render(
      <MemoryRouter initialEntries={["/my-team"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /Midnight Press FC/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My Team/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync/i })).toBeInTheDocument();
    expect(apiMocks.getMyTeam).toHaveBeenCalled();
  });
});
