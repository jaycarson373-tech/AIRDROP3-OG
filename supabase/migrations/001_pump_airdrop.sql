create table if not exists epochs (
  epoch_id text primary key,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  eligible_count integer not null default 0,
  reward_bought numeric not null default 0,
  reward_distributed numeric not null default 0,
  golden_winner_wallet text,
  golden_base_reward numeric not null default 0,
  golden_base_reward_raw text not null default '0',
  golden_bonus_reward numeric not null default 0,
  golden_bonus_reward_raw text not null default '0',
  golden_multiplier integer not null default 10,
  golden_capped boolean not null default false,
  golden_snapshot_hash text,
  golden_tx_sig text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create table if not exists claims (
  epoch_id text primary key references epochs(epoch_id) on delete cascade,
  amount_claimed numeric not null default 0,
  tx_sig text,
  created_at timestamptz not null default now()
);

create table if not exists buys (
  epoch_id text primary key references epochs(epoch_id) on delete cascade,
  base_spent_lamports text not null,
  reward_received_raw text not null,
  reward_received numeric not null default 0,
  tx_sig text,
  created_at timestamptz not null default now()
);

create table if not exists snapshots (
  epoch_id text not null references epochs(epoch_id) on delete cascade,
  wallet text not null,
  source_balance numeric not null,
  source_balance_raw text not null,
  holder_pct numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (epoch_id, wallet)
);

create table if not exists payouts (
  epoch_id text not null references epochs(epoch_id) on delete cascade,
  wallet text not null,
  reward_amount numeric not null,
  reward_amount_raw text not null,
  normal_reward_amount numeric not null default 0,
  normal_reward_amount_raw text not null default '0',
  golden_bonus_reward numeric not null default 0,
  golden_bonus_reward_raw text not null default '0',
  golden_multiplier integer not null default 1,
  is_golden boolean not null default false,
  golden_capped boolean not null default false,
  idempotency_key text not null unique,
  status text not null check (status in ('planned', 'settled', 'failed', 'dry_run')),
  tx_sig text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (epoch_id, wallet)
);

create index if not exists epochs_started_at_idx on epochs(started_at desc);
create index if not exists snapshots_epoch_balance_idx on snapshots(epoch_id, source_balance desc);
create index if not exists payouts_epoch_status_idx on payouts(epoch_id, status);
create index if not exists payouts_epoch_golden_idx on payouts(epoch_id, is_golden);

alter table epochs enable row level security;
alter table claims enable row level security;
alter table buys enable row level security;
alter table snapshots enable row level security;
alter table payouts enable row level security;

drop policy if exists "public read epochs" on epochs;
drop policy if exists "public read buys" on buys;
drop policy if exists "public read snapshots" on snapshots;
drop policy if exists "public read settled payouts" on payouts;

create policy "public read epochs" on epochs
  for select using (true);

create policy "public read buys" on buys
  for select using (true);

create policy "public read snapshots" on snapshots
  for select using (true);

create policy "public read settled payouts" on payouts
  for select using (status in ('settled', 'dry_run'));
