# TradingView MCP with Claude

A step-by-step guide to connecting and using the TradingView MCP server.

| | |
|---|---|
| **Endpoint** | `https://mcp.tradingview.com/mcp` |
| **Transport** | Streamable HTTP |
| **Config file** | [`.mcp.json`](../.mcp.json) at the repository root |

There is a formatted Word version of this guide at
[`TradingView-MCP-Guide.docx`](TradingView-MCP-Guide.docx) — same content, nicer
to hand to someone who is not going to read it in a terminal.

> **Read this first.** The connection and verification steps below are standard
> Claude Code procedure and are reliable. The **catalogue of tools the
> TradingView server exposes has not been verified** — the environment this
> guide was written in cannot reach the endpoint. [Section 7](#7-verify-the-connection-then-discover-what-it-can-do)
> shows you how to list the real tools in under a minute. Treat any capability
> not printed by that listing as unconfirmed.

---

## 1. What you are connecting

MCP (Model Context Protocol) is a standard way for an AI client to call tools
that live on a server. Claude does not embed TradingView; it speaks MCP to a
server TradingView operates, and that server decides which tools to offer.

Three things have to be true before Claude can call a single one of those tools:

1. **Configured** — Claude knows the server's URL and transport.
2. **Reachable** — your network can open an HTTPS connection to that URL.
3. **Authorized** — you have completed the server's OAuth sign-in in a browser.

Most failures are one of these three, and they fail in distinguishable ways.
[Section 9](#9-troubleshooting) maps symptoms back to the cause.

### Where the configuration lives

| Scope | Stored in | Who gets it |
|-------|-----------|-------------|
| `local` (default) | Your user settings, keyed to this project | Only you, only in this project |
| `user` | Your user settings, global | Only you, in every project |
| `project` | `.mcp.json` in the repo, committed to git | Everyone who clones the repo |

This repository already carries a `project`-scope entry for the TradingView
server, so most people can skip straight to [Section 3](#3-route-a--use-the-configuration-already-in-this-repository).

**Credentials are never in the config.** `.mcp.json` holds the URL and nothing
else. Your TradingView sign-in is stored separately in your own machine's
credential store, so committing this file shares the *server*, never your access
to it. Every teammate authorizes individually.

---

## 2. Before you start

| Requirement | Why it matters | How to check |
|-------------|----------------|--------------|
| Claude Code installed | Provides `/mcp` and the `claude mcp` CLI | `claude --version` |
| **An interactive session** | OAuth needs a browser and a localhost callback. Non-interactive and cloud sessions cannot complete it. | Run Claude from your own terminal or IDE |
| A TradingView account | The server authenticates you as a TradingView user | Sign in at tradingview.com first |
| Direct network access | Corporate proxies and VPNs frequently block it | `curl -I https://mcp.tradingview.com/mcp` |

> **The single most common mistake** is trying to authorize from a cloud or
> headless session. It will not work and the error is unhelpful. The sign-in
> **must** happen on a machine where Claude can open your browser. Once
> authorized there, that machine stays authorized.

---

## 3. Route A — use the configuration already in this repository

The shortest path, and the one to prefer: it puts the whole team on an identical
server definition.

### Step 1 — Get the branch

```bash
cd /path/to/IC-admin
git pull
```

Confirm the config is present:

```bash
cat .mcp.json
```

```json
{
  "mcpServers": {
    "tradingview": {
      "type": "http",
      "url": "https://mcp.tradingview.com/mcp"
    }
  }
}
```

### Step 2 — Start Claude in that directory

```bash
claude
```

On the first start after a new or changed `.mcp.json`, Claude Code asks whether
you trust this project's MCP servers. Approve it. This prompt exists because a
project config can point at any server, so Claude will not silently connect to
one just because it appeared in a `git pull`.

Declined by accident? Reset the choice with `claude mcp reset-project-choices`,
then restart Claude.

Now continue to [Section 6, Authorizing](#6-authorizing-the-server).

---

## 4. Route B — add the server yourself

Use this if you are not working from this repository, or you want the server
available across all your projects.

```bash
claude mcp add --transport http tradingview https://mcp.tradingview.com/mcp
```

The three positional pieces are the transport (`http`), the name you will refer
to it by (`tradingview`), and the endpoint URL.

Pick a scope with `--scope`:

```bash
claude mcp add --transport http --scope user    tradingview https://mcp.tradingview.com/mcp
claude mcp add --transport http --scope project tradingview https://mcp.tradingview.com/mcp
```

`--scope user` makes it available in every project on your machine.
`--scope project` writes it into `.mcp.json` for the team — which is exactly
what is already committed here, so you would only run it to recreate that file.

---

## 5. Route C — Claude Desktop or claude.ai

If you are not using Claude Code at all, the server is added as a custom
connector:

1. Open **Settings**.
2. Go to **Connectors**.
3. Choose **Add custom connector**.
4. Paste `https://mcp.tradingview.com/mcp` as the URL, and give it a name.
5. Click **Connect**, and complete the TradingView sign-in when the browser opens.

Custom connectors on claude.ai are not available on every plan tier. If the
option is missing from your Connectors settings entirely, that is a plan
limitation rather than a misconfiguration — Claude Code has no such restriction.

---

## 6. Authorizing the server

Configuration alone gets you nothing. Until you sign in, the server reports that
it requires authentication and Claude loads *zero* of its tools.

### The sign-in flow

1. In an interactive Claude Code session, type `/mcp`.
2. Select `tradingview` from the list. Its status will read something like
   *needs authentication*.
3. Choose **Authenticate**.
4. Your default browser opens a TradingView sign-in and consent page. Sign in
   and grant access.
5. The browser redirects to a local callback and the CLI picks it up. Status
   changes to **connected**.

> **Never hand the codes to anyone.** The OAuth callback URL and any
> authorization code in it are credentials in transit. Claude Code consumes them
> automatically. No person and no AI assistant ever needs you to paste them into
> a chat — if something asks you to, that is the signal to stop.

### Re-authorizing

Access expires, and a revoked TradingView session invalidates it early. When the
server drops back to an unauthenticated state:

1. `/mcp` → select `tradingview`
2. Choose **Clear authentication**
3. Choose **Authenticate** and sign in again

Clearing first matters. Re-authenticating on top of stale credentials is the
usual reason a server appears to authorize successfully and then immediately
fails again.

---

## 7. Verify the connection, then discover what it can do

### Verify

```bash
/mcp                        # in-session: status and tool list
claude mcp list             # all configured servers, with status
claude mcp get tradingview  # detail for this one
```

A healthy result shows `tradingview` as connected, with a non-empty list of
tools beneath it.

### Discover the real tool list

This is the step that turns this guide from generic into specific to your setup.
**Do it before you plan any workflow around this server.**

Run `/mcp` and select the server to see its published tools. Each entry carries
a name and a description of what it accepts and returns. Write down the ones you
care about — everything in the next section depends on what you find here.

You can also just ask:

```
What TradingView MCP tools do you have available, and what
does each one take as input?
```

**Why this guide does not list the tools.** The environment this document was
prepared in is behind a proxy that returns `403 CONNECT tunnel failed` for this
endpoint, so the server's tool catalogue was never retrieved. Listing
plausible-sounding tool names here would have meant guessing, and a guide that
invents capabilities is worse than one that admits the gap. The listing above
takes ten seconds and is authoritative.

### Sanity-check what you found

- **Scope** — does it read public market data, or does it reach into *your*
  TradingView account (your charts, layouts, watchlists, alerts)? The answer
  changes what you should be comfortable asking for.
- **Direction** — is every tool read-only, or can something write, place or
  modify anything? Read the descriptions rather than assuming.

---

## 8. Using the server day to day

### How to phrase requests

You do not call MCP tools by name. You describe what you want and Claude chooses
the tool. Being concrete about the instrument, the timeframe and the exchange is
what makes the difference between a good answer and a clarifying question.

| Instead of | Ask |
|------------|-----|
| "What stock is being traded?" | "Using the TradingView tools, look up NSE:RELIANCE and give me the last price and today's range." |
| "Show me the chart." | "Fetch daily candles for NSE:NIFTY for the last 60 sessions via TradingView." |
| "Is it bullish?" | "Pull the weekly bars for NSE:HDFCBANK, then describe the trend structure over the last 12 weeks." |

> **A server cannot see your screen.** Asking "which stock am I looking at?" only
> works if the server publishes a tool that exposes your active chart or layout —
> and many market-data servers do not. If no such tool appears in your `/mcp`
> listing, no amount of rephrasing will get that answer. Name the symbol yourself.

### Symbol format

TradingView identifies instruments as `EXCHANGE:SYMBOL`. Supplying the exchange
prefix removes a whole class of ambiguity, particularly for symbols listed on
more than one venue.

| Market | Example |
|--------|---------|
| NSE equity | `NSE:RELIANCE`, `NSE:TCS` |
| NSE index | `NSE:NIFTY`, `NSE:BANKNIFTY` |
| BSE equity | `BSE:SENSEX` |
| US equity | `NASDAQ:AAPL`, `NYSE:JPM` |

### Permission prompts

The first time Claude calls a given TradingView tool, it asks your approval. You
can allow the single call, or allow that tool for the rest of the session.
Approving one tool does not approve the others.

To pre-approve read-only tools you use constantly, add them to
`.claude/settings.local.json` under `permissions.allow`, using the tool names
exactly as `/mcp` printed them:

```json
{
  "permissions": {
    "allow": [
      "mcp__tradingview__<tool_name_from_the_listing>"
    ]
  }
}
```

Pre-approving a tool removes the confirmation step permanently for that session
type. That is a reasonable trade for a quote lookup and a poor one for anything
that modifies state. Keep the allowlist to tools you have confirmed are
read-only.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No TradingView tools available at all | Not authorized, or config not loaded | `/mcp` — check the server is listed and shows connected |
| Stuck on "needs authentication" | Stale or partial credentials | `/mcp` → Clear authentication → Authenticate |
| Browser never opens during sign-in | No default browser, or a headless session | The CLI prints the URL — open it manually. If nothing prints, you are not in an interactive session. |
| `403 CONNECT tunnel failed` | Proxy, VPN or firewall blocking the host | Test with `curl -I https://mcp.tradingview.com/mcp`. If that fails, it is a network problem, not a Claude one. |
| Server missing from `/mcp` entirely | Config never loaded, or project trust declined | `claude mcp list` to confirm; `claude mcp reset-project-choices` then restart |
| Connects, but tools are not what you expected | The server publishes a different set than assumed | Re-read the `/mcp` listing. It is the authority, not this guide. |
| Worked yesterday, fails today | Access expired, or TradingView session revoked | Clear authentication and sign in again |

### Command reference

| Command | Does |
|---------|------|
| `/mcp` | In-session: status, tool listing, authenticate, clear authentication |
| `claude mcp list` | List every configured server with its connection status |
| `claude mcp get tradingview` | Show detail for this one server |
| `claude mcp add --transport http tradingview <url>` | Add the server |
| `claude mcp remove tradingview` | Remove it |
| `claude mcp reset-project-choices` | Reset the trust decision for project-scope servers |

---

## 10. Known limitations

- **Cloud and headless sessions cannot authorize.** The OAuth flow needs a
  browser and a localhost callback. Use a local interactive session. This is a
  property of OAuth, not a bug to work around.
- **Restricted networks block the endpoint.** Some proxies refuse the host
  outright. Verify with `curl` before debugging anything else.
- **The tool catalogue in this guide is unverified.** Section 7 is how you get
  the real one. Nothing here should be read as a promise that a particular
  TradingView capability exists.
- **Data is TradingView's, with TradingView's caveats.** Delays, coverage and
  redistribution terms are set by them and by your plan. Anything time-sensitive
  should be confirmed against your broker or exchange feed before you act on it.
- **This is developer tooling, separate from the application.** The IC-admin app
  does not read `.mcp.json`. Wave Lab's in-app market data is configured
  independently through `MARKET_PROVIDER` and `KITE_MCP_URL` — see
  [`.env.example`](../.env.example). Connecting this server does not change what
  the application serves to users.
