#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const {
  CultCache,
  SingleFileMessagePackBackingStore,
  defineDocumentRegistry,
  defineDocumentType,
} = require("cultcache-ts");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.STONKS_PORT || 8802);
const host = args.host || process.env.STONKS_HOST || "0.0.0.0";
const intervalMs = Number(args.intervalMs || process.env.STONKS_INTERVAL_MS || 15000);
const stateDir = args.stateDir || path.join(repoRoot, "scratch", "stonks");
const cultCachePath = args.cultCachePath || process.env.STONKS_CULTCACHE_PATH || path.join(stateDir, "stonks-state.cc");
const finnhubTokenFile = args.finnhubTokenFile || process.env.STONKS_FINNHUB_TOKEN_FILE || path.join(repoRoot, "finnhub-oauth.txt");
const finnhubToken = String(args.finnhubToken || process.env.FINNHUB_API_KEY || process.env.STONKS_FINNHUB_TOKEN || readSecretFile(finnhubTokenFile)).trim();
const equityCallsPerMinute = clampNumber(args.equityCallsPerMinute || process.env.STONKS_EQUITY_CALLS_PER_MINUTE || 48, 1, 60);
const mentionRefreshMs = clampNumber(args.mentionRefreshMs || process.env.STONKS_MENTION_REFRESH_MS || 600000, 60000, 3600000);
const providerId = "stonks.market";
const clients = new Set();
const recentRequests = [];
const pendingCultCacheWrites = new Set();

const equitySymbols = String(args.equities || process.env.STONKS_EQUITIES || "ubi.fr,ea.us,ttwo.us,rblx.us,ntdoy.us,sony.us,msft.us,nvda.us,amd.us,googl.us,meta.us,aapl.us,tsla.us,tsm.us,asml.us,crsr.us,logi.us,se.us")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const cryptoIds = String(args.crypto || process.env.STONKS_CRYPTO || "bitcoin,ethereum,solana,dogecoin")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const privateWatch = String(args.privateWatch || process.env.STONKS_PRIVATE_WATCH || "Musk Complex")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const radarSymbols = String(args.radar || process.env.STONKS_RADAR || "u.us,app.us,hood.us,coin.us,pltr.us,crm.us,orcl.us,intc.us,mu.us,adbe.us,team.us,snow.us,net.us,crwd.us,ddog.us,shop.us")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const finnhubSymbolMap = {
  "ubi.fr": "UBSFY",
  "ea.us": "EA",
  "ttwo.us": "TTWO",
  "rblx.us": "RBLX",
  "ntdoy.us": "NTDOY",
  "7974.jp": "NTDOY",
  "sony.us": "SONY",
  "msft.us": "MSFT",
  "nvda.us": "NVDA",
  "amd.us": "AMD",
  "googl.us": "GOOGL",
  "meta.us": "META",
  "aapl.us": "AAPL",
  "tsla.us": "TSLA",
  "tsm.us": "TSM",
  "asml.us": "ASML",
  "crsr.us": "CRSR",
  "logi.us": "LOGI",
  "se.us": "SE",
  "u.us": "U",
  "app.us": "APP",
  "hood.us": "HOOD",
  "coin.us": "COIN",
  "pltr.us": "PLTR",
  "crm.us": "CRM",
  "orcl.us": "ORCL",
  "intc.us": "INTC",
  "mu.us": "MU",
  "adbe.us": "ADBE",
  "team.us": "TEAM",
  "snow.us": "SNOW",
  "net.us": "NET",
  "crwd.us": "CRWD",
  "ddog.us": "DDOG",
  "shop.us": "SHOP",
};
const mentionTargets = [
  { symbol: "ubi.fr", terms: ["ubisoft", "assassin's creed", "assassins creed", "rainbow six", "far cry"] },
  { symbol: "ea.us", terms: ["electronic arts", " ea ", "battlefield", "the sims", "apex legends"] },
  { symbol: "ttwo.us", terms: ["take-two", "take two", "rockstar", "gta", "grand theft auto", "2k games"] },
  { symbol: "rblx.us", terms: ["roblox"] },
  { symbol: "ntdoy.us", terms: ["nintendo", "switch 2", "zelda", "mario", "pokemon"] },
  { symbol: "7974.jp", terms: ["nintendo", "switch 2", "zelda", "mario", "pokemon"] },
  { symbol: "sony.us", terms: ["sony", "playstation", "ps5", "bungie"] },
  { symbol: "msft.us", terms: ["microsoft", "xbox", "activision", "blizzard", "bethesda", "openai"] },
  { symbol: "nvda.us", terms: ["nvidia", "geforce", "cuda", "gpu", "ai chip"] },
  { symbol: "amd.us", terms: ["amd", "radeon", "ryzen", "epyc"] },
  { symbol: "googl.us", terms: ["google", "alphabet", "android", "youtube", "gemini"] },
  { symbol: "meta.us", terms: ["meta", "facebook", "instagram", "quest", "llama"] },
  { symbol: "aapl.us", terms: ["apple", "iphone", "ipad", "vision pro", "mac"] },
  { symbol: "tsla.us", terms: ["tesla", "elon", "musk", "spacex", "xai", "neuralink", "boring company"] },
  { symbol: "tsm.us", terms: ["tsmc", "taiwan semiconductor"] },
  { symbol: "asml.us", terms: ["asml", "euv"] },
  { symbol: "crsr.us", terms: ["corsair", "elgato"] },
  { symbol: "logi.us", terms: ["logitech"] },
  { symbol: "se.us", terms: ["garena", "sea limited"] },
  { symbol: "u.us", terms: ["unity", "unity engine"] },
  { symbol: "app.us", terms: ["applovin"] },
  { symbol: "hood.us", terms: ["robinhood"] },
  { symbol: "coin.us", terms: ["coinbase"] },
  { symbol: "pltr.us", terms: ["palantir"] },
];
const equityCache = new Map();
const unsupportedEquitySymbols = new Set();
const mentionSources = [
  {
    id: "hacker-news",
    label: "HN",
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=50",
    kind: "hn-json",
  },
  {
    id: "ign",
    label: "IGN",
    url: "https://feeds.feedburner.com/ign/games-all",
    kind: "rss",
  },
  {
    id: "eurogamer",
    label: "Eurogamer",
    url: "https://www.eurogamer.net/feed",
    kind: "rss",
  },
];
let equityCursor = 0;
let nextMentionScanAt = 0;
let latestMentionScan = emptyMentionScan("not scanned yet");

fs.mkdirSync(stateDir, { recursive: true });

const passThroughSchema = { parse: (value) => value };
const requestEventDocument = defineDocumentType({
  type: "request-event",
  schemaId: "stonks.request_event.v1",
  schemaName: "stonks.request_event",
  schemaVersion: "v1",
  schema: passThroughSchema,
  indexes: {
    direction: "direction",
    kind: "kind",
  },
});
const marketSnapshotDocument = defineDocumentType({
  type: "market-snapshot",
  schemaId: "stonks.market_snapshot.v1",
  schemaName: "stonks.market_snapshot",
  schemaVersion: "v1",
  schema: passThroughSchema,
  global: true,
});
const eveSurfaceDocument = defineDocumentType({
  type: "eve-surface",
  schemaId: "gamecult.eve.surface_state.v1",
  schemaName: "gamecult.eve.surface_state",
  schemaVersion: "v1",
  schema: passThroughSchema,
  global: true,
});
let cultCache = createCultCache();

let version = 0;
let latestSnapshot = pendingSnapshot("Stonks starting");
let currentState = buildState(latestSnapshot);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await pullCultCacheOrQuarantine();
  loadRecentRequestsFromCultCache();
  const server = http.createServer(handleHttp);
  server.on("upgrade", handleUpgrade);
  server.listen(port, host, () => {
    console.log(`Stonks listening on ws://${host}:${port}/eve/deck`);
  });

  await refresh();
  setInterval(() => {
    refresh().catch((error) => console.error("refresh failed:", error));
  }, intervalMs);
}

function createCultCache() {
  return CultCache.builder()
    .withRegistry(defineDocumentRegistry(requestEventDocument, marketSnapshotDocument, eveSurfaceDocument))
    .withGenericStore(new SingleFileMessagePackBackingStore(cultCachePath))
    .build();
}

async function pullCultCacheOrQuarantine() {
  try {
    await cultCache.pullAllBackingStores();
  } catch (error) {
    if (!fs.existsSync(cultCachePath)) {
      throw error;
    }

    const corruptPath = `${cultCachePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.renameSync(cultCachePath, corruptPath);
    console.error(`Stonks CultCache state was unreadable and has been quarantined: ${corruptPath}`);
    console.error(`Stonks CultCache read error: ${error.message}`);
    cultCache = createCultCache();
    await cultCache.pullAllBackingStores();
  }
}

async function refresh() {
  latestSnapshot = await marketSnapshot();
  currentState = buildState(latestSnapshot);
  persistSnapshot(latestSnapshot, currentState);
  broadcast(currentState);
}

async function marketSnapshot() {
  const startedAt = new Date();
  const mentions = await refreshMentionsIfDue(startedAt).catch((error) => mentionScanError(error));
  const [equities, crypto] = await Promise.all([
    fetchEquities(mentions.mentionedSymbols).catch((error) => ({ ok: false, error: error.message, items: cachedEquities() })),
    fetchCrypto().catch((error) => ({ ok: false, error: error.message, items: [] })),
  ]);
  return {
    schema: "stonks.market_snapshot.v1",
    providerId,
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    sources: {
      equities: {
        name: "Finnhub",
        url: "https://finnhub.io/docs/api/quote",
        ok: equities.ok,
        error: equities.error || null,
        configured: equitySymbols.length,
        cached: equities.items.length,
        sampled: equities.sampled || [],
        callsThisRefresh: equities.callsThisRefresh || 0,
        budgetPerMinute: equityCallsPerMinute,
        tokenConfigured: Boolean(finnhubToken),
        unsupported: [...unsupportedEquitySymbols],
      },
      crypto: {
        name: "CoinGecko",
        url: "https://api.coingecko.com/api/v3/simple/price",
        ok: crypto.ok,
        error: crypto.error || null,
      },
    },
    equities: equities.items,
    crypto: crypto.items,
    mentions,
    privateWatch: privateWatch.map(privateWatchItem),
    radar: radarSymbolsFor(startedAt, mentions.mentionedSymbols).map((symbol) => ({
      kind: "radar",
      symbol: symbol.toUpperCase(),
      status: "candidate-tech-gaming-watch",
      source: "stonks-radar",
    })),
    recentRequests: [...recentRequests],
  };
}

async function fetchEquities(mentionedSymbols = []) {
  if (equitySymbols.length === 0) return { ok: true, items: [], sampled: [], callsThisRefresh: 0 };
  if (!finnhubToken) {
    return {
      ok: false,
      error: "FINNHUB_API_KEY or STONKS_FINNHUB_TOKEN missing",
      items: cachedEquities(),
      sampled: [],
      callsThisRefresh: 0,
    };
  }

  const availableSymbols = equitySymbols.filter((symbol) => !unsupportedEquitySymbols.has(symbol));
  const callsThisRefresh = Math.max(1, Math.min(
    availableSymbols.length,
    Math.floor((equityCallsPerMinute * intervalMs) / 60000),
  ));
  if (availableSymbols.length === 0) {
    return {
      ok: equityCache.size > 0,
      error: "all configured Finnhub symbols are unsupported or unavailable",
      items: cachedEquities(),
      sampled: [],
      callsThisRefresh: 0,
    };
  }
  const sampled = selectEquitySample(mentionedSymbols, callsThisRefresh);
  const results = await Promise.allSettled(sampled.map((symbol) => fetchFinnhubQuote(symbol)));
  const errors = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      equityCache.set(result.value.configuredSymbol, result.value);
    } else {
      if (result.reason?.statusCode === 403 && result.reason?.configuredSymbol) {
        unsupportedEquitySymbols.add(result.reason.configuredSymbol);
      }
      errors.push(result.reason?.message || "quote failed");
    }
  }

  return {
    ok: errors.length === 0 || equityCache.size > 0,
    error: errors.length ? errors.slice(0, 2).join("; ") : null,
    items: cachedEquities(),
    sampled,
    callsThisRefresh: sampled.length,
  };
}

async function fetchFinnhubQuote(configuredSymbol) {
  const finnhubSymbol = toFinnhubSymbol(configuredSymbol);
  const params = new URLSearchParams({ symbol: finnhubSymbol, token: finnhubToken });
  let row;
  try {
    row = JSON.parse(await getText(`https://finnhub.io/api/v1/quote?${params}`));
  } catch (error) {
    error.configuredSymbol = configuredSymbol;
    throw error;
  }
  if (!row || row.c === 0 || row.c == null) {
    throw new Error(`${finnhubSymbol} returned no quote`);
  }
  return {
    kind: "equity",
    symbol: finnhubSymbol,
    configuredSymbol,
    price: numberOrNull(row.c),
    change: numberOrNull(row.d),
    change24h: numberOrNull(row.dp),
    open: numberOrNull(row.o),
    high: numberOrNull(row.h),
    low: numberOrNull(row.l),
    previousClose: numberOrNull(row.pc),
    quoteTime: row.t ? new Date(row.t * 1000).toISOString() : null,
    pulledAt: new Date().toISOString(),
    source: "finnhub",
  };
}

function selectEquitySample(mentionedSymbols, count) {
  const configured = new Set(equitySymbols.filter((symbol) => !unsupportedEquitySymbols.has(symbol)));
  const availableSymbols = equitySymbols.filter((symbol) => configured.has(symbol));
  const prioritized = unique([
    ...mentionedSymbols.filter((symbol) => configured.has(symbol)),
    ...availableSymbols
      .filter((symbol) => !equityCache.has(symbol))
      .sort((left, right) => cacheAgeMs(right) - cacheAgeMs(left)),
  ]);
  const selected = [];
  for (const symbol of prioritized) {
    if (selected.length >= count) break;
    if (!selected.includes(symbol)) selected.push(symbol);
  }
  while (selected.length < count && availableSymbols.length > 0) {
    const symbol = availableSymbols[equityCursor % availableSymbols.length];
    equityCursor = (equityCursor + 1) % Math.max(1, availableSymbols.length);
    if (!selected.includes(symbol)) selected.push(symbol);
    if (selected.length >= availableSymbols.length) break;
  }
  return selected;
}

function cachedEquities() {
  return [...equityCache.values()]
    .sort((left, right) => String(left.symbol).localeCompare(String(right.symbol)));
}

function cacheAgeMs(symbol) {
  const item = equityCache.get(symbol);
  if (!item?.pulledAt) return Number.POSITIVE_INFINITY;
  const age = Date.now() - Date.parse(item.pulledAt);
  return Number.isFinite(age) ? age : Number.POSITIVE_INFINITY;
}

function toFinnhubSymbol(configuredSymbol) {
  const key = String(configuredSymbol).toLowerCase();
  if (finnhubSymbolMap[key]) return finnhubSymbolMap[key];
  return key.replace(/\.us$/, "").toUpperCase();
}

async function refreshMentionsIfDue(now = new Date()) {
  if (now.getTime() < nextMentionScanAt) return latestMentionScan;
  nextMentionScanAt = now.getTime() + mentionRefreshMs;
  const sources = await Promise.all(mentionSources.map(scanMentionSource));
  const texts = sources.flatMap((source) => source.texts || []);
  const matched = matchMentionSymbols(texts);
  latestMentionScan = {
    schema: "stonks.mention_scan.v1",
    updatedAt: new Date().toISOString(),
    ok: sources.some((source) => source.ok),
    sources: sources.map(({ id, label, ok, count, error }) => ({ id, label, ok, count, error: error || null })),
    mentionedSymbols: matched,
    scannedItems: texts.length,
    refreshMs: mentionRefreshMs,
    error: sources.every((source) => !source.ok) ? sources.map((source) => source.error).filter(Boolean).join("; ") : null,
  };
  return latestMentionScan;
}

async function scanMentionSource(source) {
  try {
    const text = await getText(source.url);
    const texts = source.kind === "hn-json" ? parseHnTitles(text) : parseRssTexts(text);
    return { id: source.id, label: source.label, ok: true, count: texts.length, texts };
  } catch (error) {
    return { id: source.id, label: source.label, ok: false, count: 0, texts: [], error: error.message };
  }
}

function parseHnTitles(text) {
  const json = JSON.parse(text);
  return (json.hits || [])
    .map((item) => [item.title, item.story_title, item.url].filter(Boolean).join(" "))
    .filter(Boolean);
}

function parseRssTexts(text) {
  const items = text.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const title = xmlTag(item, "title");
    const description = xmlTag(item, "description");
    const category = [...item.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((match) => decodeXml(match[1])).join(" ");
    return stripTags(`${title} ${description} ${category}`).trim();
  }).filter(Boolean);
}

function xmlTag(text, tag) {
  const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function stripTags(text) {
  return decodeXml(String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " "));
}

function decodeXml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function matchMentionSymbols(texts) {
  const haystack = ` ${texts.join(" ").toLowerCase().replace(/\s+/g, " ")} `;
  const matched = [];
  for (const target of mentionTargets) {
    if (target.terms.some((term) => haystack.includes(term.toLowerCase()))) {
      matched.push(target.symbol);
    }
  }
  return unique(matched).filter((symbol) => equitySymbols.includes(symbol) || radarSymbols.includes(symbol));
}

function mentionScanError(error) {
  latestMentionScan = {
    ...emptyMentionScan(error.message),
    updatedAt: new Date().toISOString(),
    error: error.message,
  };
  return latestMentionScan;
}

function emptyMentionScan(error = null) {
  return {
    schema: "stonks.mention_scan.v1",
    updatedAt: null,
    ok: false,
    sources: mentionSources.map((source) => ({ id: source.id, label: source.label, ok: false, count: 0, error })),
    mentionedSymbols: [],
    scannedItems: 0,
    refreshMs: mentionRefreshMs,
    error,
  };
}

async function fetchCrypto() {
  if (cryptoIds.length === 0) return { ok: true, items: [] };
  const params = new URLSearchParams({
    ids: cryptoIds.join(","),
    vs_currencies: "usd",
    include_24hr_vol: "true",
    include_24hr_change: "true",
    include_market_cap: "true",
  });
  const json = JSON.parse(await getText(`https://api.coingecko.com/api/v3/simple/price?${params}`));
  const items = Object.entries(json).map(([id, value]) => ({
    kind: "crypto",
    symbol: id.toUpperCase(),
    price: numberOrNull(value.usd),
    change24h: numberOrNull(value.usd_24h_change),
    volume24h: numberOrNull(value.usd_24h_vol),
    marketCap: numberOrNull(value.usd_market_cap),
    source: "coingecko",
  }));
  return { ok: true, items };
}

function buildState(snapshot) {
  version++;
  const recent = snapshot.recentRequests.slice(-12);
  const outbound = recent.filter((item) => item.direction === "outbound");
  const failed = recent.filter((item) => item.ok === false || item.kind === "fetch-error" || item.kind === "fetch-timeout");
  const rows = [
    pane("sources", "Source Status", [
      metricNode("updated", "updated", ageLabel(snapshot.updatedAt), "ok"),
      metricNode("equities-source", "Finnhub", snapshot.sources.equities.ok ? "ok" : "error", snapshot.sources.equities.ok ? "ok" : "warn"),
      metricNode("crypto-source", "crypto", snapshot.sources.crypto.ok ? "ok" : "error", snapshot.sources.crypto.ok ? "ok" : "warn"),
      metricNode("duration", "poll", `${snapshot.durationMs}ms`, snapshot.durationMs > 7000 ? "warn" : "ok"),
      snapshot.sources.equities.error ? textNode("equities-error", `equities error: ${errorSummary(snapshot.sources.equities.error)}`) : null,
      snapshot.sources.crypto.error ? textNode("crypto-error", `crypto error: ${errorSummary(snapshot.sources.crypto.error)}`) : null,
    ]),
    pane("pull-volume", "Pull Volume", [
      metricNode("equity-rows", "Finnhub cache", `${snapshot.equities.length}/${equitySymbols.length}`, snapshot.equities.length ? "ok" : "warn"),
      metricNode("equity-sample", "quote calls", `${snapshot.sources.equities.callsThisRefresh}/${snapshot.sources.equities.budgetPerMinute}/min`, snapshot.sources.equities.tokenConfigured ? "ok" : "warn"),
      metricNode("crypto-rows", "CoinGecko rows", `${snapshot.crypto.length}/${cryptoIds.length}`, snapshot.crypto.length ? "ok" : "warn"),
      metricNode("radar-count", "radar names", String(snapshot.radar.length), "ok"),
      metricNode("mention-count", "mentions", String(snapshot.mentions.mentionedSymbols.length), snapshot.mentions.ok ? "ok" : "warn"),
    ]),
    pane("mention-radar", "Mention Radar", [
      ...snapshot.mentions.sources.map((source) => metricNode(`mention-${source.id}`, source.label, source.ok ? `${source.count}` : "error", source.ok ? "ok" : "warn")),
      textNode("mention-symbols", `mentioned: ${snapshot.mentions.mentionedSymbols.map(toFinnhubSymbol).join(", ") || "none"}`),
      snapshot.mentions.error ? textNode("mention-error", `radar error: ${errorSummary(snapshot.mentions.error)}`) : null,
    ]),
    pane("request-health", "Request Health", [
      metricNode("request-total", "recent", String(recent.length), "ok"),
      metricNode("request-outbound", "outbound", String(outbound.length), outbound.length ? "ok" : "warn"),
      metricNode("request-failed", "failed", String(failed.length), failed.length ? "warn" : "ok"),
      textNode("request-note", "request events are persisted in CultCache; dashboard shows health summary only"),
    ]),
  ].filter(Boolean);

  return {
    schema: "gamecult.eve.surface_state.v1",
    providerId,
    title: "Stonks",
    version,
    updatedAt: snapshot.updatedAt,
    snapshot,
    surface: {
      root: {
        id: "stonks-root",
        kind: "interface",
        props: {
          title: "Stonks Market Pulse",
          providerId,
          overview: { visible: true, signal: "live-ops" },
          text: `Market pulse: ${snapshot.equities.length} equities, ${snapshot.crypto.length} crypto assets, ${snapshot.privateWatch.length} private watch names, ${snapshot.recentRequests.length} recent requests.`,
          marqueeText: marketTape(snapshot),
          layout: {
            density: "dense",
            layoutStrategy: "nested-dense-signal",
            preferredWidth: 108,
            preferredHeight: 36,
            minWidth: 56,
            minHeight: 14,
            priority: -20,
          },
        },
        children: rows,
      },
    },
  };
}

function marketTape(snapshot) {
  const quotes = [...snapshot.crypto, ...snapshot.equities]
    .slice(0, 16)
    .map((item) => quoteText(item));
  const warnings = [
    snapshot.sources.equities.ok ? "" : "EQUITIES SOURCE ERROR",
    snapshot.sources.crypto.ok ? "" : "CRYPTO SOURCE ERROR",
  ].filter(Boolean);
  return [...quotes, ...warnings].filter(Boolean).join(" / ");
}

function quoteText(item) {
  const price = item.price == null ? "N/D" : `$${formatNumber(item.price)}`;
  const change = item.change24h == null ? "" : ` ${item.change24h >= 0 ? "+" : ""}${item.change24h.toFixed(2)}%`;
  const volume = item.volume24h ?? item.volume;
  const volumeText = volume == null ? "" : ` vol ${formatCompact(volume)}`;
  return `${item.symbol} ${price}${change}${volumeText}`;
}

function pane(id, title, children) {
  return {
    id: `pane-${id}`,
    kind: "pane",
    props: { title },
    children: children.filter(Boolean),
  };
}

function metricNode(id, label, value, tone = "default") {
  return {
    id,
    kind: "metric",
    props: { title: label, label, value, text: `${label}: ${value}`, tone },
  };
}

function textNode(id, text) {
  return { id, kind: "text", props: { title: id, text } };
}

function pendingSnapshot(error) {
  return {
    schema: "stonks.market_snapshot.v1",
    providerId,
    updatedAt: new Date().toISOString(),
    durationMs: 0,
    error,
    sources: {
      equities: {
        name: "Finnhub",
        ok: false,
        error,
        configured: equitySymbols.length,
        cached: 0,
        sampled: [],
        callsThisRefresh: 0,
        budgetPerMinute: equityCallsPerMinute,
        tokenConfigured: Boolean(finnhubToken),
        unsupported: [...unsupportedEquitySymbols],
      },
      crypto: { name: "CoinGecko", ok: false, error },
    },
    equities: [],
    crypto: [],
    mentions: emptyMentionScan(error),
    privateWatch: privateWatch.map(privateWatchItem),
    radar: [],
    recentRequests: [...recentRequests],
  };
}

function privateWatchItem(name) {
  if (name.toLowerCase() === "musk complex") {
    return {
      kind: "private-watch",
      symbol: "MUSK-COMPLEX",
      name,
      status: "mixed-public-private",
      movement: "TSLA.US live; SpaceX/xAI-X/Neuralink/Boring need provider-owned news or secondary-market feed",
      source: "stonks-watchlist",
    };
  }

  return {
    kind: "private-watch",
    symbol: name.toUpperCase().replace(/\s+/g, "-"),
    name,
    status: "private-no-public-ticker",
    movement: "awaiting provider-owned news or secondary-market feed",
    source: "stonks-watchlist",
  };
}

function persistSnapshot(snapshot, state) {
  trackCultCacheWrite("persist snapshot", async () => {
    await cultCache.putGlobal(marketSnapshotDocument, snapshot);
    await cultCache.putGlobal(eveSurfaceDocument, state);
  });
}

function handleHttp(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  logRequest({ direction: "inbound", kind: "http", method: req.method || "GET", url: url.pathname, remote: req.socket.remoteAddress || "" });
  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      providerId,
      version: currentState.version,
      clients: clients.size,
      intervalMs,
      stateDir,
      cultCachePath,
      equities: equitySymbols,
      crypto: cryptoIds,
      privateWatch,
      radar: radarSymbols,
      finnhub: {
        tokenConfigured: Boolean(finnhubToken),
        tokenFileConfigured: Boolean(finnhubTokenFile),
        equityCallsPerMinute,
        mentionRefreshMs,
        cachedEquities: equityCache.size,
        unsupportedEquities: [...unsupportedEquitySymbols],
      },
      recentRequests: [...recentRequests],
      sources: latestSnapshot.sources,
      mentions: latestSnapshot.mentions,
    });
    return;
  }

  if (url.pathname === "/eve/deck/providers") {
    sendJson(res, 200, {
      providers: [{
        id: providerId,
        title: "Stonks",
        description: "Market data pulse provider for the GameCult CultMesh Verse.",
        version: String(currentState.version),
        endpoint: "/eve/deck",
        capabilities: ["market-data", "equities", "crypto", "cultui-surface"],
        usesCultMesh: true,
        transport: "CultCache .cc + Eve WebSocket projection",
      }],
    });
    return;
  }

  if (url.pathname === "/market/state") {
    sendJson(res, 200, latestSnapshot);
    return;
  }

  sendText(res, 404, "not found");
}

function handleUpgrade(req, socket) {
  logRequest({ direction: "inbound", kind: "websocket-upgrade", method: "GET", url: req.url || "/eve/deck", remote: socket.remoteAddress || "" });
  if (!req.url.startsWith("/eve/deck")) {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  clients.add(socket);
  sendFrame(socket, 0x1, Buffer.from(JSON.stringify(currentState), "utf8"));
  socket.on("data", (chunk) => {
    if ((chunk[0] & 0x0f) === 0x8) {
      clients.delete(socket);
      socket.end();
    }
  });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
}

function broadcast(state) {
  const payload = Buffer.from(JSON.stringify(state), "utf8");
  for (const client of [...clients]) {
    try {
      sendFrame(client, 0x1, payload);
    } catch {
      clients.delete(client);
      client.destroy();
    }
  }
}

function sendFrame(socket, opcode, payload) {
  const header = [0x80 | opcode];
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(126, payload.length >> 8, payload.length & 0xff);
  } else {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(payload.length));
    header.push(127, ...length);
  }
  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function getText(url) {
  const startedAt = Date.now();
  logRequest({ direction: "outbound", kind: "fetch", method: "GET", url: redactedUrl(url), startedAt: new Date(startedAt).toISOString() });
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000, headers: { "user-agent": "GameCult-Stonks/0.1" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        logRequest({ direction: "outbound", kind: "fetch-complete", method: "GET", url: redactedUrl(url), statusCode: res.statusCode, durationMs: Date.now() - startedAt });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`${redactedUrl(url)} returned ${res.statusCode}`);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => {
      logRequest({ direction: "outbound", kind: "fetch-timeout", method: "GET", url: redactedUrl(url), durationMs: Date.now() - startedAt, ok: false });
      req.destroy(new Error(`${redactedUrl(url)} timed out`));
    });
    req.on("error", (error) => {
      logRequest({ direction: "outbound", kind: "fetch-error", method: "GET", url: redactedUrl(url), durationMs: Date.now() - startedAt, ok: false, error: error.message });
      reject(error);
    });
  });
}

function logRequest(entry) {
  const observedAt = new Date().toISOString();
  const id = `request:${observedAt}:${crypto.randomUUID()}`;
  const record = {
    schema: "stonks.request_event.v1",
    id,
    observedAt,
    ...entry,
  };
  recentRequests.push(record);
  while (recentRequests.length > 80) recentRequests.shift();
  trackCultCacheWrite("persist request event", async () => {
    await cultCache.put(requestEventDocument, id, record);
  });
}

function loadRecentRequestsFromCultCache() {
  const records = cultCache.getAll(requestEventDocument)
    .sort((left, right) => String(left.observedAt).localeCompare(String(right.observedAt)))
    .slice(-80);
  recentRequests.splice(0, recentRequests.length, ...records);
}

function trackCultCacheWrite(label, operation) {
  const write = operation().catch((error) => {
    console.error(`${label} failed:`, error.message);
  }).finally(() => {
    pendingCultCacheWrites.delete(write);
  });
  pendingCultCacheWrites.add(write);
}

function redactedUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).slice(0, 180);
  }
}

function readSecretFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function radarSymbolsFor(date, mentionedSymbols = []) {
  if (radarSymbols.length === 0) return [];
  const configured = new Set(radarSymbols);
  const mentionedRadar = mentionedSymbols.filter((symbol) => configured.has(symbol));
  const seed = Math.floor(date.getTime() / 60000);
  return unique([...mentionedRadar, ...[...radarSymbols]
    .sort((a, b) => hashString(`${a}:${seed}`) - hashString(`${b}:${seed}`))
  ]).slice(0, Math.min(6, radarSymbols.length));
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatNumber(value) {
  return Math.abs(value) >= 100 ? value.toFixed(2) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatCompact(value) {
  if (value == null) return "";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function ageLabel(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  if (ms < 1000) return "now";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function errorSummary(error) {
  const value = String(error || "").trim();
  if (/timed out/i.test(value)) return "timed out";
  if (/returned\s+\d+/i.test(value)) return value.match(/returned\s+\d+/i)?.[0] || value;
  return value.replace(/https?:\/\/\S+/g, "endpoint").slice(0, 80);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index++;
  }
  return parsed;
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendText(res, status, value) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(value);
}
