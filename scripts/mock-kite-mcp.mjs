/**
 * A stand-in Kite MCP server, for testing the provider without a broker.
 *
 *   node scripts/mock-kite-mcp.mjs [port]        # starts signed out
 *   node scripts/mock-kite-mcp.mjs 4111 --authed # starts signed in
 *
 * Speaks the streamable-HTTP MCP transport the real server uses: `initialize`
 * hands back an `Mcp-Session-Id`, `tools/list` advertises Kite's tool names and
 * their JSON schemas, and `tools/call` answers in Kite Connect's own response
 * shapes. Data tools refuse until `login` has been called, which is what makes
 * the sign-in path testable.
 *
 * Deliberately answers over SSE rather than plain JSON, because that is the
 * harder framing for a client to get right and the real server uses it.
 *
 * This exists to prove the transport, the tool discovery, the argument mapping
 * and the login flow. It is not Zerodha, and the candles are made up.
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4111);
const sessions = new Map();
let authorised = process.argv.includes("--authed");

const TOOLS = [
  {
    name: "login",
    description: "Authorise this session against a Kite account.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_historical_data",
    description: "Historical OHLC candles for an instrument.",
    inputSchema: {
      type: "object",
      properties: {
        instrument_token: { type: "integer" },
        from_date: { type: "string" },
        to_date: { type: "string" },
        interval: { type: "string" },
        continuous: { type: "boolean" },
        oi: { type: "boolean" },
      },
      required: ["instrument_token", "from_date", "to_date", "interval"],
    },
  },
  {
    name: "get_quotes",
    description: "Full market quotes for one or more instruments.",
    inputSchema: {
      type: "object",
      properties: { instruments: { type: "array", items: { type: "string" } } },
      required: ["instruments"],
    },
  },
  {
    name: "search_instruments",
    description: "Search the instrument master.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, exchange: { type: "string" }, limit: { type: "integer" } },
      required: ["query"],
    },
  },
  {
    name: "place_order",
    description: "Places a real order. The provider must never call this.",
    inputSchema: { type: "object", properties: { tradingsymbol: { type: "string" } } },
  },
];

const INSTRUMENTS = [
  { instrument_token: 256265, tradingsymbol: "NIFTY 50", name: "NIFTY 50", exchange: "NSE", segment: "INDICES" },
  { instrument_token: 260105, tradingsymbol: "NIFTY BANK", name: "NIFTY BANK", exchange: "NSE", segment: "INDICES" },
  { instrument_token: 408065, tradingsymbol: "INFY", name: "INFOSYS", exchange: "NSE", instrument_type: "EQ" },
  { instrument_token: 2953217, tradingsymbol: "TCS", name: "TATA CONSULTANCY SERV LT", exchange: "NSE", instrument_type: "EQ" },
];

/** Kite's historical rows: [timestamp, o, h, l, c, volume], IST with a +0530 offset. */
function candles(token, interval, from, to) {
  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T23:59:59+05:30`);
  const stepMs = interval === "day" ? 86_400_000 : 3_600_000;
  const rows = [];
  let price = 20_000 + (token % 5_000);

  for (let t = start, i = 0; t <= end && rows.length < 2_000; t += stepMs, i += 1) {
    // Kite returns exchange sessions only: weekdays, and 09:15-15:30 IST for
    // intraday intervals. A mock that emits bars at 3am would let a timezone
    // bug through unnoticed.
    const ist = new Date(t + 5.5 * 3_600_000);
    const day = ist.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (interval !== "day") {
      const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (minutes < 9 * 60 + 15 || minutes > 15 * 60 + 30) continue;
    }
    const drift = Math.sin(i / 9) * 60 + Math.cos(i / 23) * 120;
    const open = price;
    const close = price + drift;
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

const round = (n) => Math.round(n * 100) / 100;

/**
 * Kite stamps candles with IST wall-clock and an explicit +0530 offset, e.g.
 * `2024-05-02T09:15:00+0530`. Getting this right in the mock matters: a client
 * that mishandles the offset would otherwise look correct here and be five and
 * a half hours wrong against the real server.
 */
function istStamp(epochMs) {
  return `${new Date(epochMs + 5.5 * 3_600_000).toISOString().slice(0, 19)}+0530`;
}
const textBlock = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

function callTool(name, args) {
  if (name === "login") {
    authorised = true;
    return {
      content: [
        {
          type: "text",
          text: "Open https://kite.zerodha.com/connect/login?api_key=mock&v=3 to authorise this session.",
        },
      ],
    };
  }

  if (!authorised) {
    return {
      isError: true,
      content: [{ type: "text", text: "Session is not authorised. Call the login tool first." }],
    };
  }

  switch (name) {
    case "get_historical_data":
      return textBlock({
        candles: candles(args.instrument_token ?? 256265, args.interval ?? "day", args.from_date, args.to_date),
      });
    case "get_quotes":
      return textBlock(
        Object.fromEntries(
          (Array.isArray(args.instruments) ? args.instruments : String(args.instruments ?? "").split(","))
            .filter(Boolean)
            .map((key) => [
              key,
              {
                last_price: 21_345.6,
                volume: 1_234_567,
                ohlc: { open: 21_200, high: 21_400, low: 21_150, close: 21_280 },
                timestamp: "2026-08-07 15:29:59",
              },
            ])
        )
      );
    case "search_instruments": {
      const term = String(args.query ?? "").toUpperCase();
      return textBlock({
        instruments: INSTRUMENTS.filter(
          (row) => row.tradingsymbol.includes(term) || (row.name ?? "").includes(term)
        ).slice(0, args.limit ?? 20),
      });
    }
    default:
      return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}` }] };
  }
}

function handle(message, sessionId) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-kite-mcp", version: "1.0.0" },
        },
      };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const tool = TOOLS.find((entry) => entry.name === params?.name);
      if (!tool) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${params?.name}` } };
      }
      if (tool.name === "place_order") {
        // The provider is supposed to refuse before ever reaching here.
        console.error("!! place_order was called — the read-only guard failed");
        process.exitCode = 1;
      }
      return { jsonrpc: "2.0", id, result: callTool(tool.name, params?.arguments ?? {}) };
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } };
  }
}

createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    let sessionId = req.headers["mcp-session-id"];
    const headers = { "Content-Type": "text/event-stream" };

    if (message.method === "initialize") {
      sessionId = `mock-${Math.random().toString(36).slice(2, 10)}`;
      sessions.set(sessionId, { created: Date.now() });
      headers["Mcp-Session-Id"] = sessionId;
    }

    // Notifications carry no id and get an empty 202, as the transport requires.
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }

    const response = handle(message, sessionId);
    res.writeHead(200, headers);
    // SSE framing, including a comment line the client must skip.
    res.end(`: keep-alive\n\nevent: message\ndata: ${JSON.stringify(response)}\n\n`);
  });
}).listen(port, () => {
  console.log(`mock kite mcp on http://127.0.0.1:${port} (authorised: ${authorised})`);
});
