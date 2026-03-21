import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, MotionConfig, useMotionValue, useMotionTemplate, animate } from "framer-motion";
import { ArrowRightLeft, Coins, Crown, ShieldAlert, Sparkles, Trophy, Zap } from "lucide-react";
import type { MyTeamGameweekPicksResponse, MyTeamPageResponse, MyTeamPick } from "@fpl/contracts";
import { getMyTeam, getMyTeamGameweekPicks, linkMyTeamAccount, resolveAssetUrl, syncMyTeam } from "@/api/client";
import { BGPattern, GlowCard } from "@/components/ui/glow-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format";
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

  if (error.includes("FPL request failed (401)") || error.includes("FPL request failed (403)")) {
    return "FPL rejected the authenticated session for this account. Re-enter your credentials and try again.";
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
let _myTeamSavedParams = "";

export function resetMyTeamPageCacheForTests() {
  _myTeamCache.clear();
  _myTeamHistoricalCache.clear();
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

function PitchPlayerCard({ entry, gwPoints }: { entry: SquadEntry; gwPoints?: number }) {
  const image = resolveAssetUrl(entry.player.imagePath);

  return (
    <div
      role="group"
      aria-label={entry.player.webName}
      className={cn(
        "group flex w-full flex-col items-center rounded-2xl border p-3 text-center transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "cursor-default border-white/10 bg-[rgba(17,6,39,0.7)]",
      )}
    >
      <div className="relative mb-2">
        {image ? (
          <img
            src={image}
            alt={entry.player.webName}
            className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/15"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <ShieldAlert className="h-5 w-5 text-white/40" />
          </div>
        )}
        {entry.isCaptain && (
          <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
            C
          </span>
        )}
        {!entry.isCaptain && entry.isViceCaptain && (
          <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold text-white">
            V
          </span>
        )}
      </div>

      <div className="font-display text-xs font-semibold text-white">{entry.player.webName}</div>
      <div className="mt-1 flex items-center justify-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", POSITION_CONFIG[entry.player.positionId]?.color)}>
          {POSITION_CONFIG[entry.player.positionId]?.label}
        </span>
        <span className="text-[10px] text-white/45">{entry.player.teamShortName}</span>
      </div>

      {gwPoints !== undefined ? (
        <div className={cn(
          "mt-1.5 font-display text-lg font-bold tabular-nums leading-none",
          gwPoints > 0 ? "text-white" : gwPoints < 0 ? "text-red-400" : "text-white/25",
        )}>
          {gwPoints}
          <span className="ml-0.5 text-[9px] font-normal text-white/40">pts</span>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/60">
          <span>{formatCost(entry.player.nowCost)}</span>
          <span className="text-accent">{entry.player.form.toFixed(1)}</span>
        </div>
      )}

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

              {/* GW selector dropdown */}
              <div className="mb-5">
                <Select
                  value={String(viewGameweek ?? "")}
                  onValueChange={(val) => selectViewGameweek(Number(val), selectedAccount.id, payload.currentGameweek ?? 0)}
                >
                  <SelectTrigger className="min-h-9 border-white/10 bg-white/5 text-sm">
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
              </div>

              {/* Pitch field */}
              {(() => {
                const isHistorical = viewGameweek !== payload.currentGameweek;
                const displayPicks = isHistorical
                  ? historicalData?.picks.map(toSquadEntry) ?? []
                  : payload.picks.map(toSquadEntry);
                const gwPointsMap = Object.fromEntries(
                  (historicalData?.picks ?? []).map((p) => [p.slotId, p.gwPoints ?? 0]),
                );

                const displayStarters = displayPicks.filter((e) => e.role === "starter");
                const displayBench = displayPicks.filter((e) => e.role === "bench");
                const displayGrouped = [1, 2, 3, 4].map((posId) =>
                  displayStarters.filter((e) => e.player.positionId === posId),
                );

                return (
                  <div className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(0,70,35,0.45)_0%,rgba(3,18,10,0.97)_100%)] p-4 sm:p-5">
                    {historicalLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-3">
                          {displayGrouped.map((row, index) => (
                            <div
                              key={`row-${index}`}
                              className={cn(
                                "grid gap-3",
                                index > 0 && "border-t border-white/5 pt-3",
                              )}
                              style={{ gridTemplateColumns: `repeat(${Math.max(row.length, 1)}, minmax(0, 1fr))` }}
                            >
                              {row.map((entry) => (
                                <PitchPlayerCard
                                  key={entry.slotId}
                                  entry={entry}
                                  gwPoints={gwPointsMap[entry.slotId]}
                                />
                              ))}
                            </div>
                          ))}
                        </div>

                        <div className="mt-5 border-t border-white/10 pt-4">
                          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">Bench</p>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {displayBench.map((entry) => (
                              <PitchPlayerCard
                                key={entry.slotId}
                                entry={entry}
                                gwPoints={isHistorical ? gwPointsMap[entry.slotId] : undefined}
                              />
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </GlowCard>
          </motion.div>

          {/* Transfer Planner */}
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, duration: 0.45 }}>
            <GlowCard className="p-5 sm:p-6">
              {/* Header */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Transfer Planner</h2>
                  <p className="mt-0.5 text-sm text-white/50">Sync controls stay here while the local planner workspace is being rebuilt.</p>
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

              <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 p-4 text-sm leading-6 text-white/55">
                Planner actions are temporarily unavailable in the UI while the shared My Team shell is being simplified. Use the synced pitch, gameweek history, and transfer log here, then make final moves on the official FPL site.
              </div>
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
    </MotionConfig>
  );
}
