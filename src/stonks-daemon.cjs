#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.STONKS_PORT || 8802);
const host = args.host || process.env.STONKS_HOST || "0.0.0.0";
const intervalMs = Number(args.intervalMs || process.env.STONKS_INTERVAL_MS || 15000);
const stateDir = args.stateDir || path.join(repoRoot, "scratch", "stonks");
const providerId = "stonks.market";
const clients = new Set();

const equitySymbols = String(args.equities || process.env.STONKS_EQUITIES || "ubi.fr,ea.us,ttwo.us,rblx.us,ntdoy.us,7974.jp,sony.us,msft.us,nvda.us,amd.us,googl.us,meta.us,aapl.us,tsla.us,tsm.us,asml.us,crsr.us,logi.us,se.us")
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

fs.mkdirSync(stateDir, { recursive: true });

let version = 0;
let latestSnapshot = pendingSnapshot("Stonks starting");
let currentState = buildState(latestSnapshot);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
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

async function refresh() {
  latestSnapshot = await marketSnapshot();
  currentState = buildState(latestSnapshot);
  persistSnapshot(latestSnapshot, currentState);
  broadcast(currentState);
}

async function marketSnapshot() {
  const startedAt = new Date();
  const [equities, crypto] = await Promise.all([
    fetchEquities().catch((error) => ({ ok: false, error: error.message, items: [] })),
    fetchCrypto().catch((error) => ({ ok: false, error: error.message, items: [] })),
  ]);
  return {
    schema: "stonks.market_snapshot.v1",
    providerId,
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    sources: {
      equities: {
        name: "Stooq",
        url: "https://stooq.com/q/l/",
        ok: equities.ok,
        error: equities.error || null,
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
    privateWatch: privateWatch.map(privateWatchItem),
  };
}

async function fetchEquities() {
  if (equitySymbols.length === 0) return { ok: true, items: [] };
  const rows = await Promise.all(equitySymbols.map(async (symbol) => {
    const params = new URLSearchParams({ s: symbol, f: "sd2t2ohlcv", h: "", e: "csv" });
    const text = await getText(`https://stooq.com/q/l/?${params}`);
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift()?.split(",") || [];
    return lines.map((line) => csvLine(line, header));
  }));
  const items = rows
    .flat()
    .filter((row) => row.Symbol && row.Close && row.Close !== "N/D")
    .map((row) => ({
      kind: "equity",
      symbol: row.Symbol.toUpperCase(),
      price: numberOrNull(row.Close),
      open: numberOrNull(row.Open),
      high: numberOrNull(row.High),
      low: numberOrNull(row.Low),
      volume: numberOrNull(row.Volume),
      date: row.Date,
      time: row.Time,
      source: "stooq",
    }));
  return { ok: true, items };
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
  const rows = [
    textNode("updated", `updated ${snapshot.updatedAt}`),
    textNode("source-equities", `equities ${snapshot.sources.equities.ok ? "ok" : "error"} via ${snapshot.sources.equities.name}`),
    textNode("source-crypto", `crypto ${snapshot.sources.crypto.ok ? "ok" : "error"} via ${snapshot.sources.crypto.name}`),
    ...snapshot.equities.map((item) => quoteNode(item)),
    ...snapshot.crypto.map((item) => quoteNode(item)),
    ...snapshot.privateWatch.map((item) => privateWatchNode(item)),
  ];
  if (snapshot.equities.length === 0 && snapshot.crypto.length === 0) {
    rows.push(textNode("empty", snapshot.error || "no market rows available"));
  }

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
          text: `Market pulse: ${snapshot.equities.length} equities, ${snapshot.crypto.length} crypto assets, ${snapshot.privateWatch.length} private watch names.`,
        },
        children: rows,
      },
    },
  };
}

function quoteNode(item) {
  const price = item.price == null ? "N/D" : `$${formatNumber(item.price)}`;
  const change = item.change24h == null ? "" : ` ${item.change24h >= 0 ? "+" : ""}${item.change24h.toFixed(2)}%`;
  const volume = item.volume24h ?? item.volume;
  const volumeText = volume == null ? "" : ` vol ${formatCompact(volume)}`;
  return textNode(`quote-${item.kind}-${item.symbol}`, `${item.symbol} ${price}${change}${volumeText}`);
}

function privateWatchNode(item) {
  return textNode(`watch-${item.symbol}`, `${item.name} ${item.status}; ${item.movement}`);
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
      equities: { name: "Stooq", ok: false, error },
      crypto: { name: "CoinGecko", ok: false, error },
    },
    equities: [],
    crypto: [],
    privateWatch: privateWatch.map(privateWatchItem),
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
  fs.writeFileSync(path.join(stateDir, "latest-market-state.json"), JSON.stringify(snapshot, null, 2), "utf8");
  fs.writeFileSync(path.join(stateDir, "latest-surface.json"), JSON.stringify(state, null, 2), "utf8");
}

function handleHttp(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      providerId,
      version: currentState.version,
      clients: clients.size,
      intervalMs,
      stateDir,
      equities: equitySymbols,
      crypto: cryptoIds,
      privateWatch,
      sources: latestSnapshot.sources,
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
        usesCultMesh: false,
        transport: "Eve WebSocket + scratch snapshot",
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
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000, headers: { "user-agent": "GameCult-Stonks/0.1" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`${url} timed out`));
    });
    req.on("error", reject);
  });
}

function csvLine(line, header) {
  const values = line.split(",");
  const row = {};
  for (let i = 0; i < header.length; i++) {
    row[header[i]] = values[i] || "";
  }
  return row;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
