import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, MotionConfig, useMotionValue, useMotionTemplate, animate } from "framer-motion";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Coins, Crown, ExternalLink, Share2, ShieldAlert, Sparkles, Trophy, Zap } from "lucide-react";
import type {
  CaptainRecommendation,
  LiveGwUpdate,
  MyTeamGameweekPicksResponse,
  MyTeamPageResponse,
  MyTeamPick,
  PlayerDetail,
  PlayerXpts,
  TransferDecisionHorizon,
  TransferDecisionOption,
  TransferDecisionResponse,
} from "@fpl/contracts";
import {
  getCaptainRecommendation,
  getMyTeam,
  getMyTeamGameweekPicks,
  getPlayer,
  getPlayerXpts,
  getTransferDecision,
  linkMyTeamAccount,
  resolveAssetUrl,
  subscribeLiveGw,
  syncMyTeam,
} from "@/api/client";
import { BGPattern, GlowCard } from "@/components/ui/glow-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShareRecapDialog } from "@/components/ui/ShareRecapDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format";
import { computePointBreakdown } from "@/lib/points";
import { type SquadEntry } from "@/lib/my-team";

type AsyncState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: MyTeamPageResponse };

const POSITION_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: "GKP", color: "bg-yellow-500/20 text-yellow-300" },
  2: { label: "DEF", color: "bg-blue-500/20 text-blue-300" },
  3: { label: "MID", color: "bg-green-500/20 text-green-300" },
  4: { label: "FWD", color: "bg-pink-500/20 text-pink-300" },
};

function summarizeAuthError(error: string | null) {
  if (!error) {
    return "Please re-enter your FPL password and try the sync again.";
  }

  if (error.includes("no FPL team entry ID")) {
    return "We could sign in, but FPL did not expose your team entry automatically. Add your current season entry ID below, then relink.";
  }

  if (error.includes("FPL login failed")) {
    return "Your saved FPL password is no longer being accepted. Re-enter it below to relink this account.";
  }

  if (error.includes("can no longer be decrypted")) {
    return "Your saved FPL password can no longer be decrypted on this device. Re-enter it below to relink this account.";
  }

  if (error.includes("FPL request failed (401)") || error.includes("FPL request failed (403)")) {
    return "FPL rejected the authenticated session for this account. Re-enter your credentials and try again.";
  }

  if (error.includes("Could not resolve") || error.includes("Could not reach")) {
    return "This device cannot currently reach the FPL login service. Check your DNS, VPN, proxy, or firewall settings, then try again.";
  }

  return "This account needs to be relinked before it can sync fresh FPL data.";
}

function toSquadEntry(pick: MyTeamPick): SquadEntry {
  return {
    slotId: pick.slotId,
    player: pick.player,
    role: pick.role,
    benchOrder: pick.benchOrder,
    isCaptain: pick.isCaptain,
    isViceCaptain: pick.isViceCaptain,
  };
}

function dedupePitchEntries(entries: SquadEntry[]): SquadEntry[] {
  const seenSlotIds = new Set<string>();
  const seenPlayerIds = new Set<number>();
  const uniqueEntries: SquadEntry[] = [];

  for (const entry of entries) {
    if (seenSlotIds.has(entry.slotId) || seenPlayerIds.has(entry.player.id)) {
      continue;
    }

    seenSlotIds.add(entry.slotId);
    seenPlayerIds.add(entry.player.id);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

// Module-level cache — persists across page navigations within the same tab session
type MyTeamCache = {
  state: { status: "ready"; payload: MyTeamPageResponse };
  selectedAccountId: number | null;
  email: string;
  entryIdInput: string;
  viewGameweek: number | null;
  historicalData: MyTeamGameweekPicksResponse | null;
};
const _myTeamCache = new Map<string, MyTeamCache>();
const _myTeamHistoricalCache = new Map<string, MyTeamGameweekPicksResponse>();
const _playerDetailCache = new Map<number, PlayerDetail>();
const _liveGwCache = new Map<number, LiveGwUpdate>();
let _myTeamSavedParams = "";

export function resetMyTeamPageCacheForTests() {
  _myTeamCache.clear();
  _myTeamHistoricalCache.clear();
  _playerDetailCache.clear();
  _myTeamSavedParams = "";
}

function getSavedParam(key: string): string {
  if (!_myTeamSavedParams) return "";
  return new URLSearchParams(_myTeamSavedParams).get(key) ?? "";
}

function parseNullableNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMyTeamCacheKey(accountId: number | null | undefined): string {
  return accountId === null || accountId === undefined ? "default" : String(accountId);
}

function getHistoricalCacheKey(accountId: number, gameweek: number): string {
  return `${accountId}|${gameweek}`;
}

type PitchOverlayMode = "normal" | "xpts";
type TransferDecisionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: TransferDecisionResponse };

function formatTransferDecisionLabel(label: TransferDecisionOption["label"]) {
  switch (label) {
    case "roll":
      return "Roll";
    case "best_1ft":
      return "Best 1FT";
    case "best_2ft":
      return "Best 2FT";
    case "best_hit":
      return "Best Hit";
    default:
      return label;
  }
}

function formatTransferSummary(option: TransferDecisionOption) {
  if (option.transfers.length === 0) {
    return "Keep your squad as-is";
  }

  return option.transfers
    .map((transfer) => `${transfer.outPlayerName} -> ${transfer.inPlayerName}`)
    .join(", ");
}

function PitchPlayerCard({
  entry,
  gwPoints,
  multiplier,
  onClick,
  overlayMode,
  xpts,
  nextOpponent,
}: {
  entry: SquadEntry;
  gwPoints?: number;
  multiplier?: number;
  onClick?: () => void;
  overlayMode: PitchOverlayMode;
  xpts?: number | null;
  nextOpponent?: string | null;
}) {
  const image = resolveAssetUrl(entry.player.imagePath);
  const interactive = !!onClick;
  // Use isCaptain flag; also treat multiplier ≥ 2 as captain (reliable for historical picks)
  const isCaptain = entry.isCaptain || (multiplier !== undefined && multiplier >= 2);
  const isVice = !isCaptain && entry.isViceCaptain;
  const showingOverlay = overlayMode !== "normal";

  return (
    <div
      role={interactive ? "button" : "group"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={entry.player.webName}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      className={cn(
        "group flex w-full flex-col items-center text-center transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-lg",
        interactive ? "cursor-pointer" : "cursor-default",
      )}
    >
      {/* Kit image with C/V badge pinned to top-left corner */}
      <div className="relative mb-1 rounded-2xl px-1.5 py-1">
        {(isCaptain || isVice) && (
          <span className="absolute left-0 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-[11px] font-extrabold text-black shadow-lg">
            {isCaptain ? "C" : "V"}
          </span>
        )}
        {image ? (
          <img
            src={image}
            alt={entry.player.webName}
            className={cn(
              "h-16 w-16 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.55)] sm:h-20 sm:w-20",
              interactive && "transition-transform duration-200 group-hover:scale-105",
            )}
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
            <ShieldAlert className="h-7 w-7 text-white/50 drop-shadow" />
          </div>
        )}
      </div>

      {/* Name + points pill */}
      <div className="w-full max-w-[86px] rounded-md bg-[rgba(5,1,15,0.82)] px-1.5 py-1 backdrop-blur-sm">
        <div className="truncate font-display text-[11px] font-bold leading-tight text-white">
          {entry.player.webName}
        </div>
        {showingOverlay ? (
          <>
            <div className="font-display text-[12px] font-bold leading-tight text-accent">
              {xpts !== null && xpts !== undefined ? xpts.toFixed(1) : "—"}
            </div>
            <div className="truncate text-[9px] uppercase tracking-wide text-white/45">
              {`xPts · ${nextOpponent ?? "No fixture"}`}
            </div>
          </>
        ) : gwPoints !== undefined ? (
          <div className={cn(
            "font-display text-[13px] font-bold tabular-nums leading-tight",
            gwPoints > 0 ? "text-accent" : gwPoints < 0 ? "text-red-400" : "text-white/35",
          )}>
            {gwPoints}
          </div>
        ) : (
          <div className="text-[10px] text-white/55">{formatCost(entry.player.nowCost)}</div>
        )}
      </div>
    </div>
  );
}

function MyTeamCredentialsForm({
  email,
  password,
  entryIdInput,
  submitting,
  submitLabel,
  labelClassName = "mb-2 block text-[11px] uppercase tracking-[0.18em] text-white/45",
  inputClassName,
  onEmailChange,
  onPasswordChange,
  onEntryIdChange,
  onSubmit,
}: {
  email: string;
  password: string;
  entryIdInput: string;
  submitting: boolean;
  submitLabel: string;
  labelClassName?: string;
  inputClassName?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onEntryIdChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <label className={labelClassName}>Email</label>
        <Input
          aria-label="Email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="you@example.com"
          className={cn("min-h-11 border-white/10 bg-white/5", inputClassName)}
        />
      </div>
      <div>
        <label className={labelClassName}>Password</label>
        <Input
          aria-label="Password"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="FPL password"
          className={cn("min-h-11 border-white/10 bg-white/5", inputClassName)}
        />
      </div>
      <div>
        <label className={labelClassName}>Entry ID (optional)</label>
        <Input
          aria-label="Entry ID (optional)"
          inputMode="numeric"
          value={entryIdInput}
          onChange={(event) => onEntryIdChange(event.target.value.replace(/[^\d]/g, ""))}
          placeholder="Current season team entry ID"
          className={cn("min-h-11 border-white/10 bg-white/5", inputClassName)}
        />
      </div>
      <Button type="button" disabled={submitting || !email || !password} onClick={onSubmit} className="min-h-11">
        {submitting ? `${submitLabel}…` : submitLabel}
      </Button>
    </div>
  );
}

export function MyTeamPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAccountId = parseNullableNumber(searchParams.get("accountId") ?? getSavedParam("accountId"));
  const initialViewGameweek = parseNullableNumber(searchParams.get("viewGW") ?? getSavedParam("viewGW"));
  const initialCache = _myTeamCache.get(getMyTeamCacheKey(initialAccountId));
  const [state, setState] = useState<AsyncState>(() =>
    initialCache?.state ?? { status: "loading" },
  );
  // Skip entrance animations when data was already in cache at mount time
  const noAnim = useRef(state.status === "ready").current;
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    () => initialAccountId ?? initialCache?.selectedAccountId ?? null,
  );
  const [email, setEmail] = useState(() => initialCache?.email ?? "");
  const [password, setPassword] = useState("");
  const [entryIdInput, setEntryIdInput] = useState(() => initialCache?.entryIdInput ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [viewGameweek, setViewGameweek] = useState<number | null>(
    () => initialViewGameweek ?? initialCache?.viewGameweek ?? null,
  );
  const [historicalData, setHistoricalData] = useState<MyTeamGameweekPicksResponse | null>(
    () => {
      if (initialAccountId !== null && initialViewGameweek !== null) {
        return _myTeamHistoricalCache.get(getHistoricalCacheKey(initialAccountId, initialViewGameweek)) ?? initialCache?.historicalData ?? null;
      }
      return initialCache?.historicalData ?? null;
    },
  );
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [liveData, setLiveData] = useState<LiveGwUpdate | null>(null);
  const [captainRecs, setCaptainRecs] = useState<CaptainRecommendation[]>([]);
  const [pitchOverlayMode, setPitchOverlayMode] = useState<PitchOverlayMode>("normal");
  const [playerXpts, setPlayerXpts] = useState<PlayerXpts[]>([]);
  const [selectedPick, setSelectedPick] = useState<{ pick: MyTeamPick; gwPoints: number } | null>(null);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [shareGw, setShareGw] = useState<number | null>(null);
  const [transferHorizon, setTransferHorizon] = useState<TransferDecisionHorizon>(3);
  const [transferDecision, setTransferDecision] = useState<TransferDecisionState>({ status: "idle" });
  const transferDecisionRequestId = useRef(0);

  useEffect(() => {
    if (!selectedPick) {
      setPlayerDetail(null);
      return;
    }
    const playerId = selectedPick.pick.player.id;
    const cached = _playerDetailCache.get(playerId);
    if (cached) {
      setPlayerDetail(cached);
      return;
    }
    setPlayerDetailLoading(true);
    getPlayer(playerId)
      .then((data) => {
        _playerDetailCache.set(playerId, data);
        setPlayerDetail(data);
      })
      .catch(() => {})
      .finally(() => setPlayerDetailLoading(false));
  }, [selectedPick]);

  useEffect(() => {
    let cancelled = false;

    void getPlayerXpts()
      .then((xptsRows) => {
        if (cancelled) return;
        setPlayerXpts(xptsRows);
      })
      .catch(() => {
        if (cancelled) return;
        setPlayerXpts([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function applyCachedPage(cache: MyTeamCache) {
    setState(cache.state);
    setSelectedAccountId(cache.selectedAccountId);
    setEmail(cache.email);
    setEntryIdInput(cache.entryIdInput);
    setViewGameweek(cache.viewGameweek);
    setHistoricalData(cache.historicalData);
  }

  // Animated background — same cycling gradient as Dashboard
  const color = useMotionValue("#a855f7");
  useEffect(() => {
    animate(color, ["#a855f7", "#e90052", "#00ffbf", "#a855f7"], {
      ease: "easeInOut",
      duration: 12,
      repeat: Infinity,
      repeatType: "mirror",
    });
  }, [color]);
  const backgroundImage = useMotionTemplate`radial-gradient(125% 125% at 50% 0%, #0d0118 50%, ${color})`;

  async function submitAccountCredentials(emailValue: string, passwordValue: string, entryIdValue?: string) {
    setSubmitting(true);
    try {
      const parsedEntryId =
        entryIdValue && entryIdValue.trim()
          ? Number(entryIdValue.trim())
          : undefined;
      await linkMyTeamAccount(emailValue, passwordValue, parsedEntryId);
      setPassword("");
      await load(selectedAccountId ?? undefined, true);
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function load(accountId?: number, skipCache = false) {
    const requestedAccountId = accountId ?? null;
    const cacheKey = getMyTeamCacheKey(requestedAccountId);
    const cached = !skipCache ? _myTeamCache.get(cacheKey) : undefined;
    if (cached) {
      applyCachedPage(cached);
      return;
    }

    try {
      const payload = await getMyTeam(accountId);
      const readyState = { status: "ready" as const, payload };
      setState(readyState);
      const resolvedAccountId = payload.selectedAccountId ?? payload.accounts[0]?.id ?? null;
      setSelectedAccountId(resolvedAccountId);
      const resolvedEmail =
        payload.accounts.find((account) => account.id === resolvedAccountId)?.email ??
        payload.accounts[0]?.email ??
        "";
      setEmail(resolvedEmail);
      const resolvedEntryId = String(
        payload.accounts.find((account) => account.id === resolvedAccountId)?.entryId ??
          payload.accounts[0]?.entryId ??
          "",
      );
      setEntryIdInput(resolvedEntryId);
      const currentGw = payload.currentGameweek ?? null;
      const resolvedViewGameweek = viewGameweek ?? currentGw;
      setViewGameweek(resolvedViewGameweek);

      const cachedHistorical =
        resolvedAccountId !== null && resolvedViewGameweek !== null
          ? _myTeamHistoricalCache.get(getHistoricalCacheKey(resolvedAccountId, resolvedViewGameweek)) ?? null
          : null;
      setHistoricalData(cachedHistorical);

      // Populate module-level cache so navigating away and back skips the API call
      const cacheEntry = {
        state: readyState,
        selectedAccountId: resolvedAccountId,
        email: resolvedEmail,
        entryIdInput: resolvedEntryId,
        viewGameweek: resolvedViewGameweek,
        historicalData: cachedHistorical,
      };
      _myTeamCache.set(cacheKey, cacheEntry);
      if (resolvedAccountId !== null) {
        _myTeamCache.set(getMyTeamCacheKey(resolvedAccountId), cacheEntry);
      }

      if (resolvedViewGameweek && resolvedAccountId && !cachedHistorical) {
        setHistoricalLoading(true);
        getMyTeamGameweekPicks(resolvedAccountId, resolvedViewGameweek)
          .then((data) => {
            setHistoricalData(data);
            _myTeamHistoricalCache.set(getHistoricalCacheKey(resolvedAccountId, resolvedViewGameweek), data);
            const refreshedEntry = _myTeamCache.get(getMyTeamCacheKey(resolvedAccountId));
            if (refreshedEntry) {
              refreshedEntry.historicalData = data;
              _myTeamCache.set(getMyTeamCacheKey(resolvedAccountId), refreshedEntry);
            }
          })
          .catch(() => {})
          .finally(() => setHistoricalLoading(false));
      }
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function selectViewGameweek(gw: number, accountId: number, _currentGw: number) {
    setViewGameweek(gw);
    const cacheEntry = _myTeamCache.get(getMyTeamCacheKey(accountId));
    if (cacheEntry) {
      cacheEntry.viewGameweek = gw;
      _myTeamCache.set(getMyTeamCacheKey(accountId), cacheEntry);
    }
    const cached = _myTeamHistoricalCache.get(getHistoricalCacheKey(accountId, gw));
    if (cached) {
      setHistoricalData(cached);
      setHistoricalLoading(false);
      return;
    }
    setHistoricalLoading(true);
    try {
      const data = await getMyTeamGameweekPicks(accountId, gw);
      setHistoricalData(data);
      _myTeamHistoricalCache.set(getHistoricalCacheKey(accountId, gw), data);
      const refreshedEntry = _myTeamCache.get(getMyTeamCacheKey(accountId));
      if (refreshedEntry) {
        refreshedEntry.historicalData = data;
        _myTeamCache.set(getMyTeamCacheKey(accountId), refreshedEntry);
      }
    } finally {
      setHistoricalLoading(false);
    }
  }

  useEffect(() => {
    if (state.status === "ready") return;
    load(selectedAccountId ?? undefined);
  }, [state.status, selectedAccountId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId !== null) params.set("accountId", String(selectedAccountId));
    if (viewGameweek !== null) params.set("viewGW", String(viewGameweek));
    _myTeamSavedParams = params.toString();
    setSearchParams(params, { replace: true });
  }, [selectedAccountId, viewGameweek, setSearchParams]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const cacheKey = getMyTeamCacheKey(selectedAccountId);
    const existing = _myTeamCache.get(cacheKey);
    if (!existing) return;
    _myTeamCache.set(cacheKey, {
      ...existing,
      selectedAccountId,
      email,
      entryIdInput,
      viewGameweek,
      historicalData,
    });
  }, [
    state,
    selectedAccountId,
    email,
    entryIdInput,
    viewGameweek,
    historicalData,
  ]);

  const payload = state.status === "ready" ? state.payload : null;
  const selectedAccount =
    payload?.accounts.find((account) => account.id === selectedAccountId) ??
    payload?.accounts[0] ??
    null;
  const needsRelogin = selectedAccount?.authStatus === "relogin_required";

  const currentGw = payload?.currentGameweek ?? null;
  useEffect(() => {
    if (!currentGw) return;
    // Pre-populate from module cache
    const cached = _liveGwCache.get(currentGw);
    if (cached) setLiveData(cached);
    // Subscribe to live SSE stream
    const unsub = subscribeLiveGw(currentGw, (update) => {
      _liveGwCache.set(currentGw, update);
      setLiveData(update);
    });
    return unsub;
  }, [currentGw]);

  // Fetch captain recommendations whenever we have a linked account + current GW
  useEffect(() => {
    const accountId = selectedAccount?.id;
    const gw = payload?.currentGameweek;
    if (!accountId || !gw) return;
    getCaptainRecommendation(accountId, gw)
      .then(setCaptainRecs)
      .catch(() => {});
  }, [selectedAccount?.id, payload?.currentGameweek]);

  useEffect(() => {
    const accountId = selectedAccount?.id;
    const gw = viewGameweek ?? payload?.currentGameweek;
    if (!accountId || !gw) {
      setTransferDecision({ status: "idle" });
      return;
    }

    const requestId = ++transferDecisionRequestId.current;
    setTransferDecision({ status: "loading" });

    getTransferDecision(accountId, { gw, horizon: transferHorizon })
      .then((response) => {
        if (transferDecisionRequestId.current !== requestId) return;
        setTransferDecision({ status: "ready", payload: response });
      })
      .catch((error) => {
        if (transferDecisionRequestId.current !== requestId) return;
        setTransferDecision({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      if (transferDecisionRequestId.current === requestId) {
        transferDecisionRequestId.current += 1;
      }
    };
  }, [selectedAccount?.id, viewGameweek, payload?.currentGameweek, transferHorizon]);
  const relinkMessage = summarizeAuthError(selectedAccount?.authError ?? null);

  if (state.status === "loading") {
    return (
      <motion.div style={{ backgroundImage }} className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-white/50">Loading My Team…</p>
        </div>
      </motion.div>
    );
  }

  if (state.status === "error") {
    return (
      <motion.div style={{ backgroundImage }} className="flex min-h-screen items-center justify-center p-6">
        <GlowCard className="max-w-md p-6 text-center">
          <p className="text-sm text-destructive">{state.message}</p>
        </GlowCard>
      </motion.div>
    );
  }

  if (!payload || !selectedAccount || payload.accounts.length === 0) {
    return (
      <motion.div style={{ backgroundImage }} className="relative min-h-screen overflow-x-hidden text-white">
        <BGPattern variant="grid" mask="fade-edges" className="opacity-40" />
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6 lg:px-8">
          <GlowCard className="p-6 md:p-8" glowColor="magenta">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">
                My Team Authentication
              </span>
            </div>
            <h1 className="mt-4 font-display text-4xl font-bold bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent">
              Link your real FPL account
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
              Enter the same FPL email and password you use on the official website. If FPL blocks automatic entry detection, add your current season entry ID too.
            </p>

            <div className="mt-6">
              <MyTeamCredentialsForm
                email={email}
                password={password}
                entryIdInput={entryIdInput}
                submitting={submitting}
                submitLabel="Link and sync account"
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onEntryIdChange={setEntryIdInput}
                onSubmit={() => submitAccountCredentials(email, password, entryIdInput)}
              />
            </div>
          </GlowCard>
        </div>
      </motion.div>
    );
  }

  return (
    <MotionConfig skipAnimations={noAnim}>
    <motion.div style={{ backgroundImage }} className="relative min-h-screen w-full overflow-x-hidden text-white">
      <BGPattern variant="grid" mask="fade-edges" className="opacity-40" />

      <div className="relative z-10 mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">

        {/* ── HERO ─────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <GlowCard className="overflow-hidden p-5 md:p-6" glowColor="magenta">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,255,191,0.07),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(233,0,82,0.09),transparent_40%)]" />
            <div className="relative space-y-4">

              {/* Label + team name + manager info */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">My Team</span>
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent">
                  {payload.teamName}
                </h1>
                {/* Account selector — inline when single, buttons when multiple */}
                {payload.accounts.length === 1 ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-white/50">
                    <span className="font-medium text-white/70">{payload.accounts[0].managerName || payload.accounts[0].email}</span>
                    {payload.accounts[0].managerName && (
                      <>
                        <span className="text-white/20">·</span>
                        <span className="text-[13px] text-white/35">{payload.accounts[0].email}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {payload.accounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => { setSelectedAccountId(account.id); load(account.id); }}
                        className={cn(
                          "rounded-lg border px-3 py-1 text-left text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedAccountId === account.id
                            ? "border-primary/60 bg-primary/15 text-white"
                            : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        {account.managerName || account.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats — single horizontal row */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-accent" />
                  <span className="text-sm font-bold text-accent">#{payload.overallRank.toLocaleString()}</span>
                  <span className="text-xs text-white/35">rank</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-white/40" />
                  <span className="text-sm font-bold">{payload.overallPoints}</span>
                  <span className="text-xs text-white/35">pts</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-white/40" />
                  <span className="text-sm font-bold">{formatCost(payload.bank)}</span>
                  <span className="text-xs text-white/35">bank</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-white/40" />
                  <span className="text-sm font-bold">{payload.freeTransfers}</span>
                  <span className="text-xs text-white/35">free transfers</span>
                </div>
              </div>
            </div>

            {/* Auth warning */}
            {needsRelogin && (
              <div className="relative mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-50">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="space-y-2">
                    <div className="font-semibold">This account needs to be relinked before the next sync.</div>
                    <p className="leading-6 text-amber-50/85">
                      Your last synced team is still visible, but fresh FPL data is blocked until you re-enter the account password.
                    </p>
                    <p className="leading-6 text-amber-50/85">{relinkMessage}</p>
                    <p className="leading-6 text-amber-50/75">
                      If automatic entry lookup is being blocked, add your current season entry ID below before relinking.
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <MyTeamCredentialsForm
                    email={email}
                    password={password}
                    entryIdInput={entryIdInput}
                    submitting={submitting}
                    submitLabel="Relink and sync"
                    labelClassName="mb-2 block text-[11px] uppercase tracking-[0.18em] text-amber-100/75"
                    inputClassName="border-amber-200/20 bg-black/20"
                    onEmailChange={setEmail}
                    onPasswordChange={setPassword}
                    onEntryIdChange={setEntryIdInput}
                    onSubmit={() => submitAccountCredentials(email, password, entryIdInput)}
                  />
                </div>
              </div>
            )}
          </GlowCard>
        </motion.div>

        {/* ── MAIN GRID: Pitch + Planner ───────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">

          {/* Captain Recommendations */}
          {captainRecs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}>
              <GlowCard className="p-4 sm:p-5" glowColor="purple">
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm font-semibold text-white/80">Suggested Captain</span>
                  <span className="text-xs text-white/40 ml-auto">GW{payload?.currentGameweek} · based on xPts</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  {captainRecs.map((rec) => (
                    <div
                      key={rec.playerId}
                      className={cn(
                        "flex-1 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                        rec.rank === 1
                          ? "border-yellow-500/30 bg-yellow-500/10"
                          : "border-white/8 bg-white/4",
                      )}
                    >
                      <div className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        rec.rank === 1 ? "bg-yellow-500/20 text-yellow-300" : "bg-white/10 text-white/50",
                      )}>
                        {rec.rank === 1 ? "C" : `#${rec.rank}`}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">{rec.playerName}</p>
                        <p className="text-[10px] text-white/40 truncate">{rec.reasoning}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-display text-base font-bold text-accent">{rec.xpts?.toFixed(1)}</p>
                        <p className="text-[9px] text-white/30">xPts</p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlowCard>
            </motion.div>
          )}

          {/* Pitch View */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.45 }}>
            <GlowCard className="overflow-hidden p-5 sm:p-6" glowColor="teal">
              {/* Header row */}
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Pitch View</h2>
                  <p className="mt-0.5 text-sm text-white/50">
                    {viewGameweek === payload.currentGameweek
                      ? "Your latest synced squad."
                      : historicalLoading
                        ? "Loading…"
                        : historicalData
                          ? `${historicalData.totalPoints} pts · ${historicalData.pointsOnBench} on bench`
                          : "Select a gameweek to view."}
                  </p>
                </div>
                {viewGameweek === payload.currentGameweek && (
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-widest text-white/50">
                    Live
                  </span>
                )}
              </div>

              {viewGameweek && selectedAccount && (
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    title="Share GW Recap card"
                    onClick={() => setShareGw(viewGameweek)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-accent"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share recap
                  </button>
                </div>
              )}

              <div className="mb-4 flex flex-wrap gap-2">
                {([
                  ["normal", "Normal"],
                  ["xpts", "xPts"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPitchOverlayMode(mode)}
                    aria-pressed={pitchOverlayMode === mode}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                      pitchOverlayMode === mode
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* GW selector — prev/next buttons + dropdown */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {/* ← earlier gameweek (history is descending, so idx+1 = lower GW) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  disabled={(() => {
                    const idx = payload.history.findIndex((r) => r.gameweek === viewGameweek);
                    return idx < 0 || idx >= payload.history.length - 1;
                  })()}
                  onClick={() => {
                    const idx = payload.history.findIndex((r) => r.gameweek === viewGameweek);
                    if (idx >= 0 && idx < payload.history.length - 1) {
                      const earlier = payload.history[idx + 1].gameweek;
                      selectViewGameweek(earlier, selectedAccount.id, payload.currentGameweek ?? 0);
                    }
                  }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>

                {/* dropdown — naturally sized to content */}
                <Select
                  value={String(viewGameweek ?? "")}
                  onValueChange={(val) => selectViewGameweek(Number(val), selectedAccount.id, payload.currentGameweek ?? 0)}
                >
                  <SelectTrigger className="h-7 w-auto border-white/10 bg-white/5 px-2.5 text-xs">
                    <SelectValue placeholder="Select gameweek" />
                  </SelectTrigger>
                  <SelectContent>
                    {payload.history.map((row) => (
                      <SelectItem key={row.gameweek} value={String(row.gameweek)}>
                        GW{row.gameweek} — {row.points} pts
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* → later gameweek (history is descending, so idx-1 = higher GW) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  disabled={(() => {
                    const idx = payload.history.findIndex((r) => r.gameweek === viewGameweek);
                    return idx <= 0;
                  })()}
                  onClick={() => {
                    const idx = payload.history.findIndex((r) => r.gameweek === viewGameweek);
                    if (idx > 0) {
                      const later = payload.history[idx - 1].gameweek;
                      selectViewGameweek(later, selectedAccount.id, payload.currentGameweek ?? 0);
                    }
                  }}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                {liveData?.isLive && !viewGameweek && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">
                    ● LIVE
                  </span>
                )}
                {liveData && !liveData.isLive && !viewGameweek && (
                  <span className="text-[11px] text-white/35">
                    Updated {new Date(liveData.lastUpdated).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Pitch field */}
              {(() => {
                const isHistorical = viewGameweek !== payload.currentGameweek;
                const displayPicks = dedupePitchEntries(
                  isHistorical
                    ? historicalData?.picks.map(toSquadEntry) ?? []
                    : payload.picks.map(toSquadEntry),
                );
                const gwPointsMap = Object.fromEntries(
                  (historicalData?.picks ?? []).map((p) => [p.slotId, p.gwPoints ?? 0]),
                );
                const pickBySlotId = Object.fromEntries(
                  (historicalData?.picks ?? []).map((p) => [p.slotId, p]),
                );
                const handleCardClick = (slotId: string) => {
                  const pick = pickBySlotId[slotId];
                  if (pick && gwPointsMap[slotId] !== undefined) {
                    setSelectedPick({ pick, gwPoints: gwPointsMap[slotId] });
                  }
                };

                const displayStarters = displayPicks.filter((e) => e.role === "starter");
                const displayBench = displayPicks.filter((e) => e.role === "bench");
                const displayGrouped = [1, 2, 3, 4].map((posId) =>
                  displayStarters.filter((e) => e.player.positionId === posId),
                );

                const getBenchLabel = (entry: SquadEntry, benchIdx: number): string => {
                  if (entry.player.positionId === 1) return "GKP";
                  const outfieldRank = displayBench
                    .slice(0, benchIdx)
                    .filter((e) => e.player.positionId !== 1).length + 1;
                  return `${outfieldRank}. ${POSITION_CONFIG[entry.player.positionId]?.label ?? ""}`;
                };

                const livePointsMap = new Map(
                  (liveData && !viewGameweek ? liveData.players : []).map((p) => [p.playerId, p.totalLivePoints])
                );
                const xptsMap = new Map(playerXpts.map((row) => [row.playerId, row]));

                return (
                  <div className="overflow-hidden rounded-2xl border border-white/8">

                    {/* ── PITCH AREA ─────────────────────────────────── */}
                    <div className="relative bg-[linear-gradient(180deg,#2d8a4e_0%,#1f6335_55%,#174d28_100%)] px-4 pb-8 pt-5">

                      {/* SVG field markings */}
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        {/* Penalty area */}
                        <rect x="18" y="0" width="64" height="18" rx="0.3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="0.6" />
                        {/* Goal area */}
                        <rect x="34" y="0" width="32" height="8" rx="0.3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="0.6" />
                        {/* Penalty spot */}
                        <circle cx="50" cy="13" r="0.8" fill="white" fillOpacity="0.12" />
                        {/* Halfway line */}
                        <line x1="0" y1="84" x2="100" y2="84" stroke="white" strokeOpacity="0.09" strokeWidth="0.6" />
                        {/* Center circle */}
                        <circle cx="50" cy="84" r="10" fill="none" stroke="white" strokeOpacity="0.09" strokeWidth="0.6" />
                        {/* Center spot */}
                        <circle cx="50" cy="84" r="0.8" fill="white" fillOpacity="0.12" />
                      </svg>

                      {historicalLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                        </div>
                      ) : (
                        <div className="relative z-10 space-y-5">
                          {displayGrouped.map((row, index) => (
                            <div
                              key={`row-${index}`}
                              className="grid gap-2"
                              style={{ gridTemplateColumns: `repeat(${Math.max(row.length, 1)}, minmax(0, 1fr))` }}
                            >
                              {row.map((entry) => (
                                <PitchPlayerCard
                                  key={entry.slotId}
                                  entry={entry}
                                  gwPoints={livePointsMap.size > 0 ? livePointsMap.get(entry.player.id) : (gwPointsMap[entry.slotId] !== undefined ? gwPointsMap[entry.slotId] * Math.max(pickBySlotId[entry.slotId]?.multiplier ?? 1, 1) : undefined)}
                                  multiplier={pickBySlotId[entry.slotId]?.multiplier}
                                  onClick={gwPointsMap[entry.slotId] !== undefined ? () => handleCardClick(entry.slotId) : undefined}
                                  overlayMode={pitchOverlayMode}
                                  xpts={xptsMap.get(entry.player.id)?.xpts ?? null}
                                  nextOpponent={xptsMap.get(entry.player.id)?.nextOpponent ?? null}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── BENCH AREA ─────────────────────────────────── */}
                    <div className="bg-[rgba(8,3,22,0.98)] px-4 py-3">
                      <p className="mb-2.5 text-[9px] font-semibold uppercase tracking-[0.25em] text-white/30">
                        Substitutes
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {displayBench.map((entry, idx) => (
                          <div key={entry.slotId} className="flex flex-col items-center gap-1">
                            <span className="text-[9px] font-medium uppercase tracking-wider text-white/40">
                              {getBenchLabel(entry, idx)}
                            </span>
                            <PitchPlayerCard
                              entry={entry}
                              gwPoints={isHistorical && gwPointsMap[entry.slotId] !== undefined ? gwPointsMap[entry.slotId] : undefined}
                              onClick={isHistorical && gwPointsMap[entry.slotId] !== undefined ? () => handleCardClick(entry.slotId) : undefined}
                              overlayMode={pitchOverlayMode}
                              xpts={xptsMap.get(entry.player.id)?.xpts ?? null}
                              nextOpponent={xptsMap.get(entry.player.id)?.nextOpponent ?? null}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                );
              })()}
            </GlowCard>
          </motion.div>

          {/* Transfer Planner */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, duration: 0.45 }}>
            <GlowCard className="p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Transfer Decision</h2>
                  <p className="mt-0.5 text-sm text-white/50">
                    Roll versus the best single move before the deadline.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setSubmitting(true);
                      try {
                        await syncMyTeam({ accountId: selectedAccount.id });
                        await load(selectedAccount.id, true);
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    disabled={submitting || needsRelogin}
                  >
                    {needsRelogin ? "Relink required" : submitting ? "Syncing…" : "Sync"}
                  </Button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                {([1, 3] as const).map((horizon) => (
                  <button
                    key={horizon}
                    type="button"
                    onClick={() => setTransferHorizon(horizon)}
                    aria-pressed={transferHorizon === horizon}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                      transferHorizon === horizon
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {horizon} GW
                  </button>
                ))}
              </div>

              {transferDecision.status === "loading" || transferDecision.status === "idle" ? (
                <div className="flex items-center justify-center rounded-2xl border border-white/8 bg-white/4 px-4 py-10 text-sm text-white/55">
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    <span>Building the best deadline call…</span>
                  </div>
                </div>
              ) : transferDecision.status === "error" ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
                  {transferDecision.message}
                </div>
              ) : (
                <>
                  {(() => {
                    const replayState = transferDecision.payload.replayState ?? "full";
                    const replayNotes = transferDecision.payload.replayNotes ?? [];
                    const recommended = transferDecision.payload.recommendedOptionId
                      ? transferDecision.payload.options.find(
                          (option) => option.id === transferDecision.payload.recommendedOptionId,
                        ) ?? transferDecision.payload.options[0]
                      : null;
                    const headlineReason = recommended?.reasons[0] ?? null;
                    const headlineWarning = recommended?.confidence === "close_call"
                      ? recommended.warnings[0] ?? null
                      : null;
                    const replayLabel = replayState === "full"
                      ? "Live recommendation"
                      : replayState === "degraded"
                        ? "Historical replay"
                        : "Historical replay unavailable";
                    const replayNote = replayNotes[0] ?? null;

                    return (
                      <div className="mb-4 rounded-2xl border border-accent/20 bg-accent/10 p-4">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                          <Sparkles className="h-3.5 w-3.5" />
                          Top Recommendation
                        </div>
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                          {replayLabel}
                        </p>
                        <p className="mt-2 text-base font-semibold text-white">
                          {recommended ? formatTransferDecisionLabel(recommended.label) : "Unavailable"}
                        </p>
                        <p className="mt-1 text-sm text-white/65">
                          {recommended
                            ? (
                              recommended.label === "roll"
                                ? "No single move clearly beats waiting one more week."
                                : formatTransferSummary(recommended)
                            )
                            : "Historical replay is unavailable for this gameweek."}
                        </p>
                        {headlineReason && (
                          <p className="mt-3 text-sm leading-6 text-white/78">
                            {headlineReason}
                          </p>
                        )}
                        {!headlineReason && replayNote && (
                          <p className="mt-3 text-sm leading-6 text-white/78">
                            {replayNote}
                          </p>
                        )}
                        {headlineWarning && (
                          <p className="mt-2 text-xs leading-5 text-amber-200/85">
                            {headlineWarning}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid gap-3">
                    {(transferDecision.payload.replayNotes ?? []).length > 0 && (
                      <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                          Replay Notes
                        </p>
                        <div className="mt-3 space-y-2">
                          {(transferDecision.payload.replayNotes ?? []).map((note) => (
                            <p key={note} className="text-sm leading-6 text-white/68">
                              {note}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {transferDecision.payload.options.map((option) => {
                      const isRecommended =
                        option.id === transferDecision.payload.recommendedOptionId;

                      return (
                        <div
                          key={option.id}
                          className={cn(
                            "rounded-2xl border p-4 transition-colors",
                            isRecommended
                              ? "border-accent/35 bg-accent/10"
                              : "border-white/8 bg-white/4",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {formatTransferDecisionLabel(option.label)}
                              </p>
                              <p className="mt-1 text-sm text-white/60">
                                {formatTransferSummary(option)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                "font-display text-lg font-bold",
                                option.projectedGain > 0 ? "text-accent" : "text-white",
                              )}>
                                {option.projectedGain > 0 ? "+" : ""}
                                {option.projectedGain.toFixed(1)}
                              </p>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">xPts</p>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/50">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                              Bank: {formatCost(option.remainingBank)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                              Next GW: {option.nextGwGain > 0 ? "+" : ""}{option.nextGwGain.toFixed(1)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                              {option.confidence.replace("_", " ")}
                            </span>
                          </div>

                          {option.reasons.length > 0 && (
                            <p className="mt-3 text-sm leading-6 text-white/70">
                              {option.reasons[0]}
                            </p>
                          )}

                          {option.warnings.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-amber-200/85">
                              {option.warnings[0]}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </GlowCard>
          </motion.div>
        </div>

        {/* ── HISTORY GRID: 3 columns ───────────────────────────────── */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

          {/* Recent Gameweeks */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.45 }}>
            <GlowCard className="p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <Crown className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-bold">Gameweeks</h2>
              </div>
              <p className="mb-4 text-xs text-white/45">Current season history.</p>
              <div className="overflow-x-auto rounded-xl border border-white/6">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-secondary/40">
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">GW</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Pts</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Rank</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Value</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.history.map((row, idx) => (
                      <tr
                        key={`${row.gameweek}-${row.rank}`}
                        className={cn(
                          "border-b border-white/4 transition-colors hover:bg-white/4",
                          idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.025]",
                        )}
                      >
                        <td className="px-3 py-2 text-xs font-medium tabular-nums whitespace-nowrap text-white/60">GW {row.gameweek}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums whitespace-nowrap">{row.points}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-white/50">{row.totalPoints}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-accent">#{row.overallRank.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-white/50">{formatCost(row.value)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {selectedAccount && (
                            <button
                              type="button"
                              title="Share GW Recap"
                              onClick={() => setShareGw(row.gameweek)}
                              className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-accent transition-colors cursor-pointer"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              Share
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlowCard>
          </motion.div>

          {/* Recent Transfers */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.45 }}>
            <GlowCard className="p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-accent" />
                <h2 className="font-display text-lg font-bold">Transfers</h2>
              </div>
              <p className="mb-4 text-xs text-white/45">Transfer history from your FPL account.</p>
              <div className="overflow-x-auto rounded-xl border border-white/6">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-secondary/40">
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">GW</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Out</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">In</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Cost</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.transfers.map((transfer, idx) => (
                      <tr
                        key={transfer.id}
                        className={cn(
                          "border-b border-white/4 transition-colors hover:bg-white/4",
                          idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.025]",
                        )}
                      >
                        <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-white/50">GW {transfer.gameweek ?? "—"}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap text-white/70">{transfer.playerOut.webName}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap text-accent">{transfer.playerIn.webName}</td>
                        <td className={cn("px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap font-medium", transfer.cost > 0 ? "text-destructive" : "text-accent")}>
                          {transfer.cost > 0 ? `-${transfer.cost} pts` : "Free"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-white/45">
                          {new Date(transfer.madeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlowCard>
          </motion.div>

          {/* Season Archive */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.45 }}>
            <GlowCard className="p-5 sm:p-6">
              <div className="mb-1 flex items-center gap-2">
                <Coins className="h-4 w-4 text-accent" />
                <h2 className="font-display text-lg font-bold">Season Archive</h2>
              </div>
              <p className="mb-4 text-xs text-white/45">Historical season summaries.</p>
              <div className="overflow-x-auto rounded-xl border border-white/6">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-secondary/40">
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Season</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Points</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Final Rank</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Season Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.seasons.map((season, idx) => (
                      <tr
                        key={season.season}
                        className={cn(
                          "border-b border-white/4 transition-colors hover:bg-white/4",
                          idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.025]",
                        )}
                      >
                        <td className="px-3 py-2 text-xs font-semibold whitespace-nowrap">{season.season}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap">{season.overallPoints}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-white/60">#{season.overallRank.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap text-accent">#{season.rank.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlowCard>
          </motion.div>
        </div>

      </div>
    </motion.div>

    {/* ── PLAYER DETAIL MODAL ──────────────────────────────────── */}
    <Dialog open={!!selectedPick} onOpenChange={(open) => { if (!open) setSelectedPick(null); }}>
      <DialogContent>
        {selectedPick && (() => {
          const { pick, gwPoints } = selectedPick;
          const player = pick.player;
          const image = resolveAssetUrl(player.imagePath);
          const posConfig = POSITION_CONFIG[player.positionId];
          const multiplier = pick.multiplier;
          const displayPoints = gwPoints * multiplier;

          // Find matching history entry for this GW
          const gwHistory = playerDetail?.history.find(
            (h) => h.round === viewGameweek && h.totalPoints === gwPoints,
          ) ?? playerDetail?.history.find((h) => h.round === viewGameweek);
          const breakdown = gwHistory ? computePointBreakdown(gwHistory, player.positionId) : [];
          const breakdownTotal = breakdown.reduce((sum, item) => sum + item.points, 0);

          return (
            <div className="space-y-4">
              {/* Header */}
              <DialogHeader>
                <div className="flex items-center gap-3 pr-6">
                  {image ? (
                    <img src={image} alt={player.webName} className="h-14 w-14 rounded-xl object-cover ring-1 ring-white/15" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                      <ShieldAlert className="h-5 w-5 text-white/40" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate text-lg">{player.webName}</DialogTitle>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", posConfig?.color)}>
                        {posConfig?.label}
                      </span>
                      <span className="text-xs text-white/45">{player.teamShortName}</span>
                      {pick.isCaptain && (
                        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold text-accent">Captain</span>
                      )}
                      {!pick.isCaptain && pick.isViceCaptain && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/60">Vice</span>
                      )}
                      {pick.role === "bench" && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/60">Bench</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "font-display text-2xl font-bold tabular-nums",
                      displayPoints > 0 ? "text-white" : displayPoints < 0 ? "text-red-400" : "text-white/25",
                    )}>
                      {displayPoints}
                    </div>
                    <div className="text-[10px] text-white/40">pts</div>
                  </div>
                </div>
              </DialogHeader>

              {/* Point breakdown table */}
              {playerDetailLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              ) : gwHistory ? (
                <div className="rounded-xl border border-white/8 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/8 bg-white/[0.03]">
                        <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-white/40">Stat</th>
                        <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-white/40">Value</th>
                        <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-white/40">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map((item) => (
                        <tr key={item.label} className="border-b border-white/5">
                          <td className="px-3 py-1.5 text-xs text-white/70">{item.label}</td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums text-white/50">{item.stat}</td>
                          <td className={cn(
                            "px-3 py-1.5 text-right text-xs font-semibold tabular-nums",
                            item.points > 0 ? "text-accent" : item.points < 0 ? "text-red-400" : "text-white/30",
                          )}>{item.points}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10 bg-white/[0.03]">
                        <td className="px-3 py-2 text-xs font-semibold text-white/80">Total</td>
                        <td />
                        <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-white">
                          {breakdownTotal}
                          {multiplier > 1 && (
                            <span className="ml-1 text-[10px] font-normal text-white/40">
                              ({breakdownTotal} × {multiplier})
                            </span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}

              {/* Expected stats */}
              {gwHistory && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "xG", value: gwHistory.expectedGoals },
                    { label: "xA", value: gwHistory.expectedAssists },
                    { label: "xGI", value: gwHistory.expectedGoalInvolvements },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">{stat.label}</div>
                      <div className="mt-0.5 font-display text-sm font-bold tabular-nums">{stat.value.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* View full profile link */}
              <Link
                to={`/players/${player.id}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setSelectedPick(null)}
              >
                View full profile <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>

    {/* ── SHARE RECAP DIALOG ───────────────────────────────────── */}
    {shareGw !== null && payload && selectedAccount && (
      <ShareRecapDialog
        open={shareGw !== null}
        onOpenChange={(open) => { if (!open) setShareGw(null); }}
        accountId={selectedAccount.id}
        gameweek={shareGw}
        teamName={payload.teamName}
      />
    )}

    </MotionConfig>
  );
}
