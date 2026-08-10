import { describe, expect, it } from "vitest";
import {
  isForbiddenTool,
  looksLikeAuthFailure,
  normaliseCallResult,
  parseSseFrames,
} from "@/lib/wave-lab/mcp/client";

/**
 * §12.8 — refusing order-shaped tools is a check in the call path with a test,
 * not a convention. This is the test.
 */
describe("forbidden tools", () => {
  it.each([
    "place_order",
    "modify_order",
    "cancel_order",
    "placeOrder",
    "kite.place_order",
    "exit_position",
    "square_off_position",
    "squareoff_order",
    "place_gtt_order",
    "cancel_gtt",
    "buy",
    "SELL",
  ])("refuses %s", (name) => {
    expect(isForbiddenTool(name)).toBe(true);
  });

  it.each([
    "get_historical_data",
    "search_instruments",
    "get_quotes",
    "get_ltp",
    "login",
    "get_orders",
    "get_positions",
    "get_holdings",
    "get_order_history",
  ])("allows read-only tool %s", (name) => {
    expect(isForbiddenTool(name)).toBe(false);
  });
});

describe("SSE framing", () => {
  it("parses a single frame", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    const frames = parseSseFrames(body);
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe(1);
  });

  it("parses multiple frames and keeps their order", () => {
    const body =
      'event: message\nid: a\ndata: {"jsonrpc":"2.0","id":1,"result":1}\n\n' +
      'event: message\nid: b\ndata: {"jsonrpc":"2.0","id":2,"result":2}\n\n';
    const frames = parseSseFrames(body);
    expect(frames.map((f) => f.id)).toEqual([1, 2]);
  });

  it("joins multi-line data within one frame, per the SSE spec", () => {
    const body = 'data: {"jsonrpc":"2.0",\ndata: "id":7,\ndata: "result":{"a":1}}\n\n';
    const frames = parseSseFrames(body);
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe(7);
  });

  it("survives CRLF line endings", () => {
    const body = 'event: message\r\ndata: {"jsonrpc":"2.0","id":3,"result":{}}\r\n\r\n';
    expect(parseSseFrames(body)[0].id).toBe(3);
  });

  it("skips heartbeats and comment frames without throwing", () => {
    const body =
      ': keep-alive\n\n' +
      'data: [DONE]\n\n' +
      'data: {"jsonrpc":"2.0","id":9,"result":{}}\n\n';
    const frames = parseSseFrames(body);
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe(9);
  });

  it("returns nothing for an empty body rather than throwing", () => {
    expect(parseSseFrames("")).toEqual([]);
  });
});

describe("call-result normalisation", () => {
  it("concatenates text blocks", () => {
    const r = normaliseCallResult({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    expect(r.text).toBe("first\nsecond");
    expect(r.isError).toBe(false);
  });

  it("carries the error flag through", () => {
    const r = normaliseCallResult({ isError: true, content: [{ type: "text", text: "nope" }] });
    expect(r.isError).toBe(true);
  });

  it("tolerates a missing content array", () => {
    expect(normaliseCallResult({}).text).toBe("");
    expect(normaliseCallResult(undefined).text).toBe("");
  });
});

describe("auth-failure detection", () => {
  it.each([
    "Please log in first using the login tool",
    "session expired",
    "Unauthorized",
    "could not authenticate the request",
    "user is not logged in",
  ])("recognises %s", (text) => {
    expect(looksLikeAuthFailure(text)).toBe(true);
  });

  it("does not fire on an ordinary data error", () => {
    expect(looksLikeAuthFailure("no candles for this instrument in the given range")).toBe(false);
    expect(looksLikeAuthFailure("rate limit exceeded")).toBe(false);
  });
});
