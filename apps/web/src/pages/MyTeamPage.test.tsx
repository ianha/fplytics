import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyTeamPage, resetMyTeamPageCacheForTests } from "./MyTeamPage";
import { makePlayer } from "../test/factories";

const mockPlayers = [
  ...Array.from({ length: 4 }, (_, index) =>
    makePlayer(index + 1, 1, index + 1, 100 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 9 }, (_, index) =>
    makePlayer(index + 10, 2, (index % 6) + 1, 120 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 9 }, (_, index) =>
    makePlayer(index + 30, 3, (index % 6) + 1, 140 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 6 }, (_, index) =>
    makePlayer(index + 50, 4, (index % 6) + 1, 160 - index, { imagePath: null }),
  ),
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

function buildTransferDecisionPayload() {
  return {
    gameweek: 7,
    freeTransfers: 2,
    bank: 14,
    horizon: 3 as const,
    recommendedOptionId: "best-1ft",
    options: [
      {
        id: "roll",
        label: "roll" as const,
        transfers: [],
        horizon: 3 as const,
        projectedGain: 0,
        nextGwGain: 0,
        hitCost: 0,
        remainingBank: 14,
        confidence: "medium" as const,
        reasons: ["Sets the baseline for this week's decision."],
        warnings: [],
      },
      {
        id: "best-1ft",
        label: "best_1ft" as const,
        transfers: [
          {
            outPlayerId: mockPlayers[0].id,
            outPlayerName: mockPlayers[0].webName,
            inPlayerId: mockPlayers[20].id,
            inPlayerName: mockPlayers[20].webName,
            position: mockPlayers[20].positionName,
            priceDelta: 2,
          },
        ],
        horizon: 3 as const,
        projectedGain: 2.4,
        nextGwGain: 1.1,
        hitCost: 0,
        remainingBank: 12,
        confidence: "strong" as const,
        reasons: ["+2.4 xPts over 3 GWs."],
        warnings: [],
      },
    ],
  };
}

const {
  getMyTeamMock,
  getMyTeamGameweekPicksMock,
  getPlayerXptsMock,
  getTransferDecisionMock,
  linkMyTeamAccountMock,
  syncMyTeamMock,
} = vi.hoisted(() => ({
  getMyTeamMock: vi.fn(),
  getMyTeamGameweekPicksMock: vi.fn(),
  getPlayerXptsMock: vi.fn(),
  getTransferDecisionMock: vi.fn(),
  linkMyTeamAccountMock: vi.fn(),
  syncMyTeamMock: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  getMyTeam: getMyTeamMock,
  getMyTeamGameweekPicks: getMyTeamGameweekPicksMock,
  getPlayerXpts: getPlayerXptsMock,
  getTransferDecision: getTransferDecisionMock,
  linkMyTeamAccount: linkMyTeamAccountMock,
  syncMyTeam: syncMyTeamMock,
  getCaptainRecommendation: vi.fn(() => Promise.resolve([])),
  resolveAssetUrl: vi.fn(() => null),
  subscribeLiveGw: vi.fn(() => vi.fn()), // returns a no-op unsubscribe fn
  getLiveGwSnapshot: vi.fn(() => Promise.resolve(null)),
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
    getPlayerXptsMock.mockResolvedValue([
      {
        playerId: mockPlayers[0].id,
        playerName: mockPlayers[0].webName,
        teamShortName: mockPlayers[0].teamShortName,
        imagePath: mockPlayers[0].imagePath,
        position: mockPlayers[0].positionName,
        nextOpponent: "ARS (H)",
        difficulty: 2,
        xpts: 4.8,
        form: mockPlayers[0].form,
        minutesProbability: 0.92,
      },
    ]);
    getTransferDecisionMock.mockResolvedValue(buildTransferDecisionPayload());
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
    expect(screen.getByRole("button", { name: /Harper Labs/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sync$/i })).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(3);
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

    expect(await screen.findByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Entry ID \(optional\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Link and sync account/i })).toBeDisabled();
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

  it("deduplicates repeated historical players in the pitch view", async () => {
    const duplicatedPlayer = mockPlayers[0];
    getMyTeamGameweekPicksMock.mockResolvedValueOnce({
      gameweek: 6,
      totalPoints: 48,
      pointsOnBench: 3,
      picks: [
        {
          slotId: "pick-1",
          position: 1,
          multiplier: 1,
          isCaptain: false,
          isViceCaptain: false,
          sellingPrice: duplicatedPlayer.nowCost,
          purchasePrice: duplicatedPlayer.nowCost - 1,
          role: "starter",
          benchOrder: null,
          gwPoints: 6,
          player: duplicatedPlayer,
        },
        {
          slotId: "pick-2",
          position: 2,
          multiplier: 1,
          isCaptain: false,
          isViceCaptain: false,
          sellingPrice: duplicatedPlayer.nowCost,
          purchasePrice: duplicatedPlayer.nowCost - 1,
          role: "starter",
          benchOrder: null,
          gwPoints: 6,
          player: duplicatedPlayer,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/my-team?accountId=1&viewGW=6"]}>
        <MyTeamPage />
      </MemoryRouter>,
    );

    expect(await screen.findAllByLabelText(duplicatedPlayer.webName)).toHaveLength(1);
  });

  it("toggles pitch overlay modes using xPts and ownership data", async () => {
    render(
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Midnight Press FC/i });
    fireEvent.click(screen.getByRole("button", { name: /^xPts$/i }));

    expect(await screen.findByText("4.8")).toBeInTheDocument();
    expect(screen.getByText(/xPts · ARS \(H\)/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /FDR next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ownership %/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Relink required/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Relink and sync/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
  });

  it("renders the transfer decision workspace and switches horizons", async () => {
    getTransferDecisionMock
      .mockResolvedValueOnce(buildTransferDecisionPayload())
      .mockResolvedValueOnce({
        ...buildTransferDecisionPayload(),
        horizon: 1,
        recommendedOptionId: "roll",
        options: [
          {
            ...buildTransferDecisionPayload().options[0],
            horizon: 1,
          },
          {
            ...buildTransferDecisionPayload().options[1],
            horizon: 1,
            projectedGain: 0.2,
            nextGwGain: 0.2,
            confidence: "close_call",
            reasons: ["+0.2 xPts over 1 GW."],
            warnings: ["Close to rolling this week."],
          },
        ],
      });

    render(
      <MemoryRouter>
        <MyTeamPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Top Recommendation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Best 1FT/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(new RegExp(`${mockPlayers[0].webName} -> ${mockPlayers[20].webName}`, "i")).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^1 GW$/i }));

    await waitFor(() => {
      expect(getTransferDecisionMock).toHaveBeenLastCalledWith(1, { gw: 7, horizon: 1 });
    });
    expect(await screen.findByText(/No single move clearly beats waiting one more week/i)).toBeInTheDocument();
  });
});
