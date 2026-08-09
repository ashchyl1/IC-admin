/**
 * A stand-in Kite Connect REST API, for testing the OAuth login without a
 * broker account.
 *
 *   node scripts/mock-kite-rest.mjs [port] [api_key] [api_secret]
 *
 * Implements the endpoints the provider actually uses, with the parts that are
 * easy to get subtly wrong done properly:
 *
 *   POST /session/token   verifies sha256(api_key + request_token + api_secret)
 *                         and rejects a bad checksum the way Kite does
 *   GET  /instruments/historical/:token/:interval
 *   GET  /quote
 *   GET  /instruments/:exchange   (CSV dump)
 *
 * Timestamps carry IST wall-clock with a +0530 offset, matching the real API —
 * a client that mishandles the offset looks correct against a naive mock and is
 * five and a half hours wrong against Zerodha.
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4222);
const apiKey = process.argv[3] ?? "mockapikey";
const apiSecret = process.argv[4] ?? "mockapisecret";
const ACCESS_TOKEN = "mock-access-token-abcdef";

const INSTRUMENTS = [
  { instrument_token: 256265, exchange_token: 1001, tradingsymbol: "NIFTY 50", name: "NIFTY 50", exchange: "NSE", segment: "INDICES", instrument_type: "EQ", lot_size: 1, tick_size: 0.05 },
  { instrument_token: 408065, exchange_token: 1594, tradingsymbol: "INFY", name: "INFOSYS", exchange: "NSE", segment: "NSE", instrument_type: "EQ", lot_size: 1, tick_size: 0.05 },
  { instrument_token: 2953217, exchange_token: 11536, tradingsymbol: "TCS", name: "TATA CONSULTANCY SERV LT", exchange: "NSE", segment: "NSE", instrument_type: "EQ", lot_size: 1, tick_size: 0.05 },
];

const istStamp = (ms) => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+0530`;
const round = (n) => Math.round(n * 100) / 100;

function candles(token, interval, from, to) {
  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T23:59:59+05:30`);
  const stepMs = interval === "day" ? 86_400_000 : 3_600_000;
  const rows = [];
  let price = 20_000 + (token % 5_000);

  for (let t = start, i = 0; t <= end && rows.length < 2_000; t += stepMs, i += 1) {
    const ist = new Date(t + 5.5 * 3_600_000);
    const weekday = ist.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (interval !== "day") {
      const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (minutes < 9 * 60 + 15 || minutes > 15 * 60 + 30) continue;
    }
    const open = price;
    const close = price + Math.sin(i / 9) * 60 + Math.cos(i / 23) * 120;
    rows.push([
      istStamp(t),
      round(open),
      round(Math.max(open, close) + 25),
      round(Math.min(open, close) - 25),
      round(close),
      100000 + ((i * 7919) % 90000),
    ]);
    price = close;
  }
  return rows;
}

function authorised(req) {
  return req.headers.authorization === `token ${apiKey}:${ACCESS_TOKEN}`;
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  // ------------------------------------------------------ session/token ---
  if (req.method === "POST" && url.pathname === "/session/token") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const expected = createHash("sha256")
        .update(`${form.get("api_key")}${form.get("request_token")}${apiSecret}`)
        .digest("hex");

      if (form.get("api_key") !== apiKey) {
        return json(res, 403, { status: "error", message: "Invalid `api_key`." });
      }
      if (form.get("checksum") !== expected) {
        // Exactly what Kite says when the secret is wrong — the failure this
        // mock exists to be able to reproduce.
        return json(res, 400, { status: "error", message: "Invalid `checksum`." });
      }
      return json(res, 200, {
        status: "success",
        data: {
          user_id: "AB1234",
          user_name: "Mock Trader",
          access_token: ACCESS_TOKEN,
          public_token: "mock-public-token",
          login_time: new Date().toISOString(),
        },
      });
    });
    return;
  }

  if (req.method !== "GET") return json(res, 405, { status: "error", message: "Method not allowed" });

  if (!authorised(req)) {
    return json(res, 403, { status: "error", message: "Incorrect `api_key` or `access_token`." });
  }

  // -------------------------------------------------------- market data ---
  const historical = url.pathname.match(/^\/instruments\/historical\/(\d+)\/([a-z]+)$/);
  if (historical) {
    return json(res, 200, {
      status: "success",
      data: {
        candles: candles(
          Number(historical[1]),
          historical[2],
          url.searchParams.get("from"),
          url.searchParams.get("to")
        ),
      },
    });
  }

  if (url.pathname === "/quote") {
    const keys = url.searchParams.getAll("i");
    return json(res, 200, {
      status: "success",
      data: Object.fromEntries(
        keys.map((key) => [
          key,
          {
            last_price: 21_345.6,
            volume: 1_234_567,
            ohlc: { open: 21_200, high: 21_400, low: 21_150, close: 21_280 },
            timestamp: "2026-08-07 15:29:59",
          },
        ])
      ),
    });
  }

  if (url.pathname.startsWith("/instruments")) {
    const header = Object.keys(INSTRUMENTS[0]).join(",");
    const rows = INSTRUMENTS.map((row) => Object.values(row).join(",")).join("\n");
    res.writeHead(200, { "Content-Type": "text/csv" });
    return res.end(`${header}\n${rows}\n`);
  }

  return json(res, 404, { status: "error", message: `Unknown path ${url.pathname}` });
}).listen(port, () => {
  console.log(`mock kite rest on http://127.0.0.1:${port} (api_key: ${apiKey})`);
});
