import { env } from "../config/env.js";

type CookieJar = Map<string, string>;

type MeResponse = {
  player: {
    entry: number;
    entry_name: string;
    first_name: string;
    last_name: string;
    region_name: string;
    id: number;
  } | null;
};

type EntryResponse = {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  player_region_name: string;
  summary_overall_points: number;
  summary_overall_rank: number;
};

type EntryHistoryResponse = {
  current: Array<{
    event: number;
    points: number;
    total_points: number;
    overall_rank: number | null;
    rank: number | null;
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  }>;
  past: Array<{
    season_name: string;
    total_points: number;
    rank: number | null;
  }>;
};

type EntryPicksResponse = {
  active_chip: string | null;
  entry_history: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number | null;
    rank: number | null;
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  };
  picks: Array<{
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
    selling_price: number;
    purchase_price: number;
  }>;
};

type TransferResponse = Array<{
  element_in: number;
  element_out: number;
  element_in_cost: number;
  element_out_cost: number;
  event: number | null;
  time: string;
}>;

function appendCookies(jar: CookieJar, response: Response) {
  const headers = "getSetCookie" in response.headers
    ? (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()
    : [];

  for (const header of headers) {
    const [cookie] = header.split(";");
    const [name, ...rest] = cookie.split("=");
    jar.set(name.trim(), rest.join("=").trim());
  }
}

function toCookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function extractEntryIdFromHtml(html: string) {
  const patterns = [
    /\/entry\/(\d+)(?:\/|["'])/i,
    /"entry"\s*:\s*(\d+)/i,
    /"entry_id"\s*:\s*(\d+)/i,
    /"entryId"\s*:\s*(\d+)/i,
    /\/api\/my-team\/(\d+)(?:\/|["'])/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return null;
}

function extractEntryIdFromUrl(url: string) {
  const match = url.match(/\/entry\/(\d+)(?:\/|$)/i) ?? url.match(/[\?&]entry=(\d+)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function summarizeHtmlSignals(html: string) {
  return [
    /\/entry\/\d+/i.test(html) ? "entry-path" : null,
    /"entry"\s*:/i.test(html) ? "entry-json" : null,
    /"entryId"\s*:/i.test(html) ? "entryId-json" : null,
    /"entry_id"\s*:/i.test(html) ? "entry_id-json" : null,
    /\/api\/my-team\//i.test(html) ? "my-team-api-path" : null,
    /__NEXT_DATA__/i.test(html) ? "next-data" : null,
    /application\/ld\+json/i.test(html) ? "ld-json" : null,
  ].filter(Boolean) as string[];
}

function describeNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  const cause = error.cause;
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    const code = cause.code;
    const hostname =
      "hostname" in cause && typeof cause.hostname === "string"
        ? cause.hostname
        : null;

    if (code === "ENOTFOUND") {
      return hostname
        ? `Could not resolve ${hostname}. Check DNS/VPN/network settings and try again.`
        : "Could not resolve the FPL login host. Check DNS/VPN/network settings and try again.";
    }

    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
      return "Could not reach the FPL service. Check your network connection and try again.";
    }
  }

  return null;
}

export class FplSessionClient {
  private readonly cookies: CookieJar = new Map();
  private discoveredEntryId: number | null = null;
  private readonly diagnostics: string[] = [];

  private addDiagnostic(label: string, value: string) {
    this.diagnostics.push(`${label}=${value}`);
  }

  private async fetchWithCookies(url: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          cookie: toCookieHeader(this.cookies),
        },
      });
    } catch (error) {
      throw new Error(describeNetworkError(error) ?? "Could not reach the FPL service.", { cause: error });
    }
    appendCookies(this.cookies, response);
    this.discoveredEntryId ||= extractEntryIdFromUrl(response.url);
    this.addDiagnostic("fetch-url", response.url);
    return response;
  }

  async login(email: string, password: string) {
    let response: Response;
    try {
      response = await fetch("https://users.premierleague.com/accounts/login/", {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-requested-with": "XMLHttpRequest",
          origin: env.siteUrl,
          referer: `${env.siteUrl}/`,
        },
        body: new URLSearchParams({
          login: email,
          password,
          app: "plfpl-web",
          redirect_uri: `${env.siteUrl}/a/login`,
        }),
      });
    } catch (error) {
      throw new Error(describeNetworkError(error) ?? "Could not reach the FPL login service.", { cause: error });
    }

    appendCookies(this.cookies, response);
    this.discoveredEntryId ||= extractEntryIdFromUrl(response.url);
    this.addDiagnostic("login-response-url", response.url);

    let redirectCount = 0;
    while (redirectCount < 6 && response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      this.discoveredEntryId ||= extractEntryIdFromUrl(location);
       this.addDiagnostic("login-redirect-location", location);
      const nextUrl = new URL(location, response.url).toString();
      response = await this.fetchWithCookies(nextUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          referer: `${env.siteUrl}/`,
          accept: "text/html,application/json",
        },
      });
      redirectCount += 1;
    }

    const body = await response.text();
    this.addDiagnostic("login-body-signals", summarizeHtmlSignals(body).join(",") || "none");

    if (!response.ok || /"success"\s*:\s*false/.test(body) || /"password"\s*:\s*\[/i.test(body)) {
      throw new Error("FPL login failed. Check your email/password and try again.");
    }
  }

  private async fetchJson<T>(url: string) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          cookie: toCookieHeader(this.cookies),
          referer: `${env.siteUrl}/`,
          accept: "application/json",
        },
      });
    } catch (error) {
      throw new Error(describeNetworkError(error) ?? "Could not reach the FPL API.", { cause: error });
    }
    appendCookies(this.cookies, response);
    if (!response.ok) {
      throw new Error(`FPL request failed (${response.status}) for ${url}`);
    }
    return response.json() as Promise<T>;
  }

  private async fetchText(url: string) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          cookie: toCookieHeader(this.cookies),
          referer: `${env.siteUrl}/`,
          accept: "text/html,application/json",
        },
      });
    } catch (error) {
      throw new Error(describeNetworkError(error) ?? "Could not reach the FPL site.", { cause: error });
    }
    appendCookies(this.cookies, response);
    if (!response.ok) {
      throw new Error(`FPL request failed (${response.status}) for ${url}`);
    }
    return response.text();
  }

  private async fetchTextResponse(url: string) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          cookie: toCookieHeader(this.cookies),
          referer: `${env.siteUrl}/`,
          accept: "text/html,application/json",
        },
      });
    } catch (error) {
      throw new Error(describeNetworkError(error) ?? "Could not reach the FPL site.", { cause: error });
    }
    appendCookies(this.cookies, response);
    if (!response.ok) {
      throw new Error(`FPL request failed (${response.status}) for ${url}`);
    }
    this.addDiagnostic("fetch-text-url", response.url);
    return {
      url: response.url,
      body: await response.text(),
    };
  }

  getMe() {
    return this.fetchJson<MeResponse>(`${env.baseUrl}/me/`);
  }

  getEntry(entryId: number) {
    return this.fetchJson<EntryResponse>(`${env.baseUrl}/entry/${entryId}/`);
  }

  getEntryHistory(entryId: number) {
    return this.fetchJson<EntryHistoryResponse>(`${env.baseUrl}/entry/${entryId}/history/`);
  }

  getEventPicks(entryId: number, gameweekId: number) {
    return this.fetchJson<EntryPicksResponse>(`${env.baseUrl}/entry/${entryId}/event/${gameweekId}/picks/`);
  }

  getTransfers(entryId: number) {
    return this.fetchJson<TransferResponse>(`${env.baseUrl}/entry/${entryId}/transfers/`);
  }

  async getEntryIdFromMyTeamPage() {
    if (this.discoveredEntryId) {
      return this.discoveredEntryId;
    }

    const candidates = [`${env.siteUrl}/a/login`, `${env.siteUrl}/my-team`];

    for (const candidateUrl of candidates) {
      const response = await this.fetchTextResponse(candidateUrl);
      this.addDiagnostic(
        "entry-probe",
        `${candidateUrl}|resolved=${response.url}|signals=${summarizeHtmlSignals(response.body).join(",") || "none"}`,
      );
      const fromUrl = extractEntryIdFromUrl(response.url);
      if (fromUrl) {
        this.discoveredEntryId = fromUrl;
        return fromUrl;
      }

      const fromHtml = extractEntryIdFromHtml(response.body);
      if (fromHtml) {
        this.discoveredEntryId = fromHtml;
        return fromHtml;
      }
    }

    return null;
  }

  getEntryResolutionDiagnostics() {
    const latest = this.diagnostics.slice(-12);
    return latest.join(" ; ");
  }
}

export type {
  EntryHistoryResponse,
  EntryPicksResponse,
  EntryResponse,
  MeResponse,
  TransferResponse,
};

export { extractEntryIdFromHtml, extractEntryIdFromUrl };
