import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyTeamPage, resetMyTeamPageCacheForTests } from "./MyTeamPage";

function makePlayer(id: number, positionId: number, teamId: number, totalPoints: number) {
  return {
    id,
    webName: `Player ${id}`,
    firstName: "Player",
    secondName: String(id),
    teamId,
    teamName: `Team ${teamId}`,
    teamShortName: `T${teamId}`,
    imagePath: null,
    positionId,
    positionName: ["", "Goalkeeper", "Defender", "Midfielder", "Forward"][positionId],
    nowCost: 45 + id,
    totalPoints,
    form: 5 + (id % 4),
    selectedByPercent: 10 + id,
    pointsPerGame: 4.5,
    goalsScored: positionId === 4 ? 10 : 3,
    assists: positionId === 3 ? 8 : 2,
    cleanSheets: positionId < 3 ? 8 : 3,
    minutes: 900 + id,
    bonus: 10,
    bps: 100,
    creativity: 30,
    influence: 30,
    threat: 30,
    ictIndex: 30,
    expectedGoals: 5,
    expectedAssists: 4,
    expectedGoalInvolvements: 9,
    expectedGoalPerformance: 1,
    expectedAssistPerformance: 1,
    expectedGoalInvolvementPerformance: 2,
    expectedGoalsConceded: 8,
    cleanSheetsPer90: 0.2,
    starts: 10,
    tackles: 8,
    recoveries: 12,
    defensiveContribution: 9,
    status: "a",
  };
}

const mockPlayers = [
  ...Array.from({ length: 4 }, (_, index) => makePlayer(index + 1, 1, index + 1, 100 - index)),
  ...Array.from({ length: 9 }, (_, index) => makePlayer(index + 10, 2, (index % 6) + 1, 120 - index)),
  ...Array.from({ length: 9 }, (_, index) => makePlayer(index + 30, 3, (index % 6) + 1, 140 - index)),
  ...Array.from({ length: 6 }, (_, index) => makePlayer(index + 50, 4, (index % 6) + 1, 160 - index)),
];

function buildPayload() {
  const picks = mockPlayers.slice(0, 15).map((player, index) => ({
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
  }));

  return {
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
      {
        id: 2,
        email: "labs@fpl.local",
        entryId: 202,
        managerName: "Harper Labs",
        teamName: "Teal Arrow XI",
        authStatus: "authenticated",
        authError: null,
        lastAuthenticatedAt: "2026-03-20T12:00:00.000Z",
      },
    ],
    selectedAccountId: 1,
    currentGameweek: 7,
    freeTransfers: 2,
    bank: 14,
    overallPoints: 612,
    overallRank: 121482,
    teamName: "Midnight Press FC",
    managerName: "Ian Harper",
    picks,
    transfers: [
      {
        id: "tr-1",
        gameweek: 7,
        madeAt: "2026-03-18T18:00:00.000Z",
        playerIn: mockPlayers[12],
        playerOut: mockPlayers[4],
        cost: 4,
      },
    ],
    seasons: [
      { season: "2025/26", overallPoints: 2310, overallRank: 150002, rank: 150002 },
    ],
    history: [
      {
        gameweek: 7,
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
      {
        gameweek: 6,
        points: 48,
        totalPoints: 548,
        overallRank: 154820,
        rank: 154820,
        bank: 12,
        value: 1007,
        eventTransfers: 0,
        eventTransfersCost: 0,
        pointsOnBench: 3,
        activeChip: null,
      },
    ],
  };
}

const {
  getMyTeamMock,
  getMyTeamGameweekPicksMock,
  linkMyTeamAccountMock,
  syncMyTeamMock,
} = vi.hoisted(() => ({
  getMyTeamMock: vi.fn(),
  getMyTeamGameweekPicksMock: vi.fn(),
  linkMyTeamAccountMock: vi.fn(),
  syncMyTeamMock: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  getMyTeam: getMyTeamMock,
  getMyTeamGameweekPicks: getMyTeamGameweekPicksMock,
  linkMyTeamAccount: linkMyTeamAccountMock,
  syncMyTeam: syncMyTeamMock,
  resolveAssetUrl: vi.fn(() => null),
}));

describe("MyTeamPage", () => {
  beforeEach(() => {
    resetMyTeamPageCacheForTests();
    getMyTeamMock.mockResolvedValue(buildPayload());
    getMyTeamGameweekPicksMock.mockImplementation(async (_accountId: number, gameweek: number) => ({
      gameweek,
      picks: buildPayload().picks.map((pick) => ({ ...pick, gwPoints: pick.position })),
      totalPoints: gameweek === 6 ? 48 : 64,
      pointsOnBench: gameweek === 6 ? 3 : 6,
    }));
    linkMyTeamAccountMock.mockResolvedValue(buildPayload());
    syncMyTeamMock.mockResolvedValue(buildPayload());
  });

  it("renders the native page sections inside the shared page shell", async () => {
    render(
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /Midnight Press FC/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Pitch View/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Transfer Planner/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Season Archive/i })).toBeInTheDocument();
  });

  it("shows auth form when there are no linked accounts", async () => {
    getMyTeamMock.mockResolvedValueOnce({
      accounts: [],
      selectedAccountId: null,
      currentGameweek: null,
      freeTransfers: 0,
      bank: 0,
      overallPoints: 0,
      overallRank: 0,
      teamName: "",
      managerName: "",
      picks: [],
      transfers: [],
      seasons: [],
      history: [],
    });

    render(
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /Link your real FPL account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Link and sync account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Entry ID \(optional\)/i)).toBeInTheDocument();
  });

  it("loads historical picks when a different gameweek is selected", async () => {
    render(
      <MemoryRouter initialEntries={["/my-team?accountId=1&viewGW=6"]}>
        <MyTeamPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Midnight Press FC/i });

    await waitFor(() => {
      expect(getMyTeamGameweekPicksMock).toHaveBeenCalledWith(1, 6);
    });
    expect(await screen.findByText(/48 pts · 3 on bench/i, { selector: "p" })).toBeInTheDocument();
  });

  it("shows a relink banner and disables sync when the account needs re-authentication", async () => {
    getMyTeamMock.mockResolvedValueOnce({
      ...buildPayload(),
      accounts: [
        {
          id: 1,
          email: "ian@fpl.local",
          entryId: 101,
          managerName: "Ian Harper",
          teamName: "Midnight Press FC",
          authStatus: "relogin_required",
          authError: "FPL login failed. Check your email/password and try again.",
          lastAuthenticatedAt: "2026-03-20T12:00:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/needs to be relinked before the next sync/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("ian@fpl.local")).toBeInTheDocument();
    expect(screen.getByText(/saved fpl password is no longer being accepted/i)).toBeInTheDocument();
    expect(screen.queryByText(/Resolver diagnostics:/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Relink required/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Relink and sync/i })).toBeInTheDocument();
    expect(screen.getByText(/planner actions are temporarily unavailable/i)).toBeInTheDocument();
  });
});
