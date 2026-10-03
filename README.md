# Stock Market Game bot

Runs on GitHub-hosted Ubuntu and Chrome, using Cloudflare D1 for private state and an order journal. It manages a simulated Stock Market Game account. The Cloudflare Worker remains disabled because its free execution limit was exceeded.

## Verified behavior

The deployed runner has completed login, the complete paginated holdings read and reconciliation, pending-order checks, and a sell preview. Automated tests cover strategy calculations, session dates, pricing validation, pagination, public-report privacy, and simulated accepted, ambiguous and interrupted submissions. Actual website order acceptance is not yet verified. Live execution remains disabled while integration testing continues.

## Market data

Without API keys, the runner requests personal-use public Yahoo chart data for one year of daily closes and regular-session five-minute candles. Requests are bounded, require matching ticker, USD and exchange timezone, and stop on rejection. No proxy, cookies or fingerprint changes are used. This is an unofficial data interface; availability and freshness are checked on each run. Optional Alpaca keys select its free IEX feed instead.

Analysis includes 1-day, 5-session, 21-session, 63-session and 126-session returns, 5/20/50-session moving averages and chart candles. Insufficient history returns null. Delayed or stale external quotes cannot authorize trades. Current game prices are checked against external prices when both are available. End-of-day game fills can differ from intraday reference prices.

Entry signals require 20-session momentum, moving-average alignment and five-session momentum in the same direction. Exits use loss and concentration thresholds. This strategy has not been backtested or optimized and cannot promise profits.

## Execution

Normal target is 2:30 p.m. Eastern, with a 2:20–2:45 p.m. window. November 27 targets 11:30 a.m. because of the early close. UTC schedules cover daylight-saving changes. Runs outside the window skip execution; GitHub may delay or drop schedules. The verified game ends December 4, 2026. Pushes and manual diagnostics are read-only previews; weekend diagnostics use the latest trading session.

Pending orders are non-cancellable and block conflicting orders. A durable journal records submission intent before confirmation. A new matching server confirmation must be found before the order counts as accepted. An uncertain submission pauses the bot without retry. Unfilled sales never fund other orders. The game preview must show adequate buying power, including for short covers.

## Private configuration

Existing GitHub secrets contain the game login, Cloudflare account ID and scoped D1 token. Credentials are sent only to their respective services. Optional `MARKET_DATA_KEY` and `MARKET_DATA_SECRET` activate Alpaca data; no brokerage operations exist in either adapter. `BOT_ENABLED`, `BOT_MODE` and `ADAPTER_VALIDATED` control scheduled operation. Live flags remain disabled pending integration validation.

Public workflow logs and artifacts exclude balances, holdings sizes, pending confirmations, order quantities and preview budgets. Full reports remain in D1. The repository must never contain credentials.

## Testing

`npm ci` and `npm test` run in the workflow before every preview. Local verification currently passes 42 tests. A green preview confirms the exercised read-only flow, not actual order acceptance or future trading performance.
