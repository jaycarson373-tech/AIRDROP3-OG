# Pump Airdrop

Ticker: `$AIRDROP`  
Name: `Pump Airdrop`

One repo for:

- Vercel landing page and dashboard in `app/`
- Railway airdrop worker in `worker/`
- Supabase proof tables in `supabase/migrations/001_pump_airdrop.sql`

## Flow

Every epoch:

1. Claim Pump creator fees to the treasury wallet.
2. Swap available SOL to the reward token, normally PUMP, through Jupiter.
3. Snapshot `$AIRDROP` holders with at least `ELIGIBILITY_MIN`.
4. Exclude treasury, Pump curve/pool addresses, `EXCLUDE_WALLETS`, and holders above `MAX_HOLDER_PCT`.
5. Airdrop the treasury reward-token balance proportionally to the top `MAX_WALLETS_PER_EPOCH`.
6. Pick one deterministic random eligible holder as the Golden Airdrop winner and boost that wallet to 10x its normal reward when balance allows.
7. Store epochs, buys, snapshots, claims, Golden fields, and payouts in Supabase for the dashboard.

## Supabase

Run:

```sql
-- supabase/migrations/001_pump_airdrop.sql
```

If the first migration already exists in your project, also run:

```sql
-- supabase/migrations/002_golden_airdrop.sql
```

The migration enables public read policies for dashboard tables. The worker still uses the service-role key for writes.

## Vercel Env

Required:

```bash
NEXT_PUBLIC_PROJECT_NAME="Pump Airdrop"
NEXT_PUBLIC_SOURCE_SYMBOL=AIRDROP
NEXT_PUBLIC_REWARD_SYMBOL=PUMP
NEXT_PUBLIC_SOURCE_TOKEN_MINT=A2B9eBUYmXbgrMFDjMa1QPzBWJ5pgxWBBEtkMQm5pump
NEXT_PUBLIC_REWARD_TOKEN_MINT=pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
NEXT_PUBLIC_X_URL=https://x.com/AirdropPumpFun_
NEXT_PUBLIC_FIRST_AIRDROP_AT=2026-06-27T23:55:00.000Z
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

Recommended server-only Vercel env for dashboard API reads:

```bash
SUPABASE_URL=<SUPABASE_URL>
SUPABASE_SERVICE_ROLE=<SUPABASE_SERVICE_ROLE_KEY>
```

Never prefix the service-role key with `NEXT_PUBLIC_`.

## Railway Env

Required:

```bash
HELIUS_RPC_URL=<HELIUS_RPC_URL>
SOURCE_TOKEN_MINT=A2B9eBUYmXbgrMFDjMa1QPzBWJ5pgxWBBEtkMQm5pump
REWARD_TOKEN_MINT=pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
TREASURY_WALLET_SECRET=<BASE58_OR_JSON_SECRET_KEY>
SUPABASE_URL=<SUPABASE_URL>
SUPABASE_SERVICE_ROLE=<SUPABASE_SERVICE_ROLE_KEY>
```

Launch gates:

```bash
CLAIM_ENABLED=false
BUY_ENABLED=false
AIRDROP_ENABLED=false
```

Turn those to `true` only when live.

Reward settings:

```bash
EPOCH_MINUTES=5
ELIGIBILITY_MIN=1000000
MAX_WALLETS_PER_EPOCH=50
MAX_HOLDER_PCT=5
EXCLUDE_WALLETS=
SWAP_BALANCE_BPS=9000
MIN_SOL_RESERVE=0.125
AIRDROP_SOL_RESERVE=0.125
AIRDROP_BATCH_SIZE=4
SWAP_SLIPPAGE_BPS=300
PRIORITY_FEE_SOL=0.000001
MIN_REWARD_RAW_TO_AIRDROP=1
```

`SWAP_BALANCE_BPS=9000` spends up to 90% of SOL while also respecting `MIN_SOL_RESERVE`, so the treasury keeps SOL for airdrop fees.

## Commands

```bash
npm install
npm run dev
npm run build
npm run worker:build
npm run worker:dev
```

Railway should use:

```bash
npm run worker:start
```

The included `railway.json` builds and starts the worker service.

## Safety Notes

- All live money movement defaults off.
- A failed claim logs and continues; it does not crash-loop the worker.
- Epochs are idempotent by `epoch_id`.
- Payouts are idempotent by `epoch_id:wallet`.
- Dashboard reads Supabase; it does not need wallet secrets.
