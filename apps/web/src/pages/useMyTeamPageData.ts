import { useEffect, useRef, useState } from "react";
import type {
  CaptainRecommendation,
  LiveGwUpdate,
  MyTeamPick,
  PlayerDetail,
  PlayerXpts,
  TransferDecisionHorizon,
  TransferDecisionResponse,
} from "@fpl/contracts";
import {
  getCaptainRecommendation,
  getPlayer,
  getPlayerXpts,
  getTransferDecision,
  subscribeLiveGw,
} from "@/api/client";
import {
  getCachedLiveGw,
  getCachedPlayerDetail,
  setCachedLiveGw,
  setCachedPlayerDetail,
} from "./myTeamPageCache";

export type SelectedMyTeamPick = { pick: MyTeamPick; gwPoints: number } | null;

type TransferDecisionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: TransferDecisionResponse };

export function usePlayerXpts() {
  const [playerXpts, setPlayerXpts] = useState<PlayerXpts[]>([]);

  useEffect(() => {
    let cancelled = false;

    void getPlayerXpts()
      .then((xptsRows) => {
        if (!cancelled) {
          setPlayerXpts(xptsRows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerXpts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return playerXpts;
}

export function usePlayerDetail(selectedPick: SelectedMyTeamPick) {
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);

  useEffect(() => {
    if (!selectedPick) {
      setPlayerDetail(null);
      return;
    }

    const playerId = selectedPick.pick.player.id;
    const cached = getCachedPlayerDetail(playerId);
    if (cached) {
      setPlayerDetail(cached);
      return;
    }

    setPlayerDetailLoading(true);
    getPlayer(playerId)
      .then((data) => {
        setCachedPlayerDetail(playerId, data);
        setPlayerDetail(data);
      })
      .catch(() => {})
      .finally(() => setPlayerDetailLoading(false));
  }, [selectedPick]);

  return { playerDetail, playerDetailLoading };
}

export function useLiveGameweek(currentGw: number | null) {
  const [liveData, setLiveData] = useState<LiveGwUpdate | null>(null);

  useEffect(() => {
    if (!currentGw) return;

    const cached = getCachedLiveGw(currentGw);
    if (cached) {
      setLiveData(cached);
    }

    const unsubscribe = subscribeLiveGw(currentGw, (update) => {
      setCachedLiveGw(currentGw, update);
      setLiveData(update);
    });

    return unsubscribe;
  }, [currentGw]);

  return liveData;
}

export function useCaptainRecommendations(accountId: number | undefined, currentGw: number | null) {
  const [captainRecs, setCaptainRecs] = useState<CaptainRecommendation[]>([]);

  useEffect(() => {
    if (!accountId || !currentGw) return;

    getCaptainRecommendation(accountId, currentGw)
      .then(setCaptainRecs)
      .catch(() => {});
  }, [accountId, currentGw]);

  return captainRecs;
}

export function useTransferDecision(
  accountId: number | undefined,
  gw: number | null,
  horizon: TransferDecisionHorizon,
) {
  const [transferDecision, setTransferDecision] = useState<TransferDecisionState>({ status: "idle" });
  const transferDecisionRequestId = useRef(0);

  useEffect(() => {
    if (!accountId || !gw) {
      setTransferDecision({ status: "idle" });
      return;
    }

    const requestId = ++transferDecisionRequestId.current;
    setTransferDecision({ status: "loading" });

    getTransferDecision(accountId, { gw, horizon })
      .then((response) => {
        if (transferDecisionRequestId.current === requestId) {
          setTransferDecision({ status: "ready", payload: response });
        }
      })
      .catch((error) => {
        if (transferDecisionRequestId.current === requestId) {
          setTransferDecision({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      if (transferDecisionRequestId.current === requestId) {
        transferDecisionRequestId.current += 1;
      }
    };
  }, [accountId, gw, horizon]);

  return transferDecision;
}
