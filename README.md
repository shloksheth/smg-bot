# Free GitHub runner setup

The Cloudflare Worker returned error 1102, a platform resource-limit failure. This alternative runs the same trading logic on a GitHub-hosted Ubuntu virtual machine, with Chrome, while preserving the existing Cloudflare D1 journal. It does not depend on your home computer staying on. The Worker should remain disabled.

## Current status

39 automated tests pass. Login, holdings, and two exit previews succeeded in a remote run. Several game quote selections and actual order acceptance remain integration work. Live trading remains disabled. No promised profit or exact start time is implied.

## Create the private repository

1. Extract this ZIP. Its files belong at the root of a new **private** GitHub repository named `smg-bot`. Include `.github/workflows/smg.yml`, `package.json`, `package-lock.json`, `src`, `runner` and `test`. Do not upload `node_modules` or any credentials.
2. Keep the repository private because diagnostic reports contain your game portfolio.
3. Keep GitHub Actions spending at $0, using only the included free minutes. Standard private-repository runners consume included minutes; your other workflows share that allowance. This workflow has an eight-minute job ceiling. Delayed schedules can miss the execution window and safely skip that day's trading.

## Add private repository secrets

In the repository's Settings → Secrets and variables → Actions → Repository secrets, add:

| Name | Value |
|---|---|
| `SMG_USERNAME` | Your game team login |
| `SMG_PASSWORD` | Your game password |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID, not the database UUID |
| `CLOUDFLARE_D1_TOKEN` | A scoped Cloudflare API token granting D1 write access for your account |

The existing database UUID is already in the workflow. A scoped API token must permit querying/writing that D1 database; do not use your global API key or the bot's ADMIN_TOKEN. Create it in your own Cloudflare account's API token settings, granting the D1 permission for your own account only. GitHub receives the game credentials and D1 token, and the runner sends them only to the respective services. Never place them in files, messages or screenshots.

Optional secrets `MARKET_DATA_KEY` and `MARKET_DATA_SECRET` activate the Alpaca IEX data adapter. No brokerage operations are used. Without them, game prices and locally collected history remain the only data sources; immediate trend entries are not ready until sufficient history exists.

## First read-only test

1. Open the repository's Actions tab.
2. Select **Stock Market Game**.
3. Select **Run workflow**, leave `action=preview`, then start it.
4. Open the **Run bot** step and copy its JSON report, or download the `smg-report` artifact containing `report.json`.

The manual choices are observe, preview and status. None submits orders while configured observation mode is retained. Unlike the Worker request, this execution has a full Node.js process rather than a ten-millisecond CPU allowance. It still respects the browser wall-time budget and game verification blocks.

## Schedule and activation

Leave repository variables unset initially: defaults are `BOT_MODE=observe`, `BOT_ENABLED=false`, `ADAPTER_VALIDATED=false`. No schedule runs until enabled. A manual preview is allowed after hours for validation, and has a separate preview fence. Crashed read-only diagnostics older than ten minutes can be retried; execution fences are never reset by this runner.

After read-only operation has passed, `BOT_ENABLED=true` with `BOT_MODE=observe` enables daily observation. Normal target is 2:30 p.m. Eastern, with a 2:20–2:45 execution window. Early-close target November 27 is 11:30 a.m. Eastern. UTC triggers cover DST and the half-day, but GitHub may delay or drop schedules. A late run skips trading. The game end is December 4, 2026.

Do not enable `BOT_MODE=live` or `ADAPTER_VALIDATED=true` until real preview checks and a deliberately reviewed accepted-order reconciliation have passed. This artifact does not establish that the submission adapter works. Pending orders are treated as non-cancellable and block conflicting trades. Unknown submissions pause without retry.

## Documentation

* https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/
* https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
* https://docs.github.com/en/actions/concepts/billing-and-usage
* https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
* https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md

## External trend data

Add `MARKET_DATA_KEY` and `MARKET_DATA_SECRET` as GitHub Actions repository secrets using an Alpaca paper account's API key and secret. Only data.alpaca.markets is contacted by the adapter; it has no brokerage operations. Keep both values out of chat and source files. The free IEX feed covers one exchange, not the consolidated market.

The report's `marketAnalysis` includes 1-day, 5-session, 21-session (approximately one month), 63-session and 126-session returns, 5/20/50-session moving averages, prior daily closing prices and today's completed regular-session five-minute OHLC candles. Insufficient history produces null metrics. Daily returns use the verified current price against completed historical sessions. Today's price is not a final closing price. Intraday candles are chart data; this update does not add a graphical dashboard.

Entry decisions retain the existing 20-session momentum and moving-average conditions and now require five-session momentum in the same direction. Three- and six-month returns and intraday candles are diagnostic context, not additional trading rules. This strategy is not backtested or optimized. Missing keys leave external analysis disabled. Preview must confirm `externalDataConfigured: true` and usable `marketAnalysis` before external integration is considered working.

## Latest hardening

Daily and five-minute data responses are separated and tested with distinct payloads. Ticker lookup clears the input and uses exact ticker matching; company verification tolerates explicit security suffixes but rejects a different company. Live-path tests simulate accepted, ambiguous and interrupted submissions and confirm durable journaling before the click. These tests do not verify that the website accepts real orders. Unfunded covers are skipped; sales can continue, and their unfilled proceeds are never used to fund covers in the same run.

Repository updates are performed through the signed-in GitHub browser because the connector rejects writes. The workflow runs a read-only preview on pushes to main; manual diagnostics use the latest trading session on weekends and before the open. Real submission acceptance and external-data integration remain unverified. External credentials are absent in the supplied run. External credentials must be present in repository secrets to activate the configured adapter. No real order has been submitted by this session. Public reports omit account balances, position sizes, preview budgets and confirmations; full reports are retained in D1. Keep live flags disabled until the website adapter is validated against the deployed code. Pending order cancellation is excluded because the game returns an error, as reported by the account owner.
