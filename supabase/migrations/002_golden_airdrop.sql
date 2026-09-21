alter table epochs
  add column if not exists golden_winner_wallet text,
  add column if not exists golden_base_reward numeric not null default 0,
  add column if not exists golden_base_reward_raw text not null default '0',
  add column if not exists golden_bonus_reward numeric not null default 0,
  add column if not exists golden_bonus_reward_raw text not null default '0',
  add column if not exists golden_multiplier integer not null default 10,
  add column if not exists golden_capped boolean not null default false,
  add column if not exists golden_snapshot_hash text,
  add column if not exists golden_tx_sig text;

alter table payouts
  add column if not exists normal_reward_amount numeric not null default 0,
  add column if not exists normal_reward_amount_raw text not null default '0',
  add column if not exists golden_bonus_reward numeric not null default 0,
  add column if not exists golden_bonus_reward_raw text not null default '0',
  add column if not exists golden_multiplier integer not null default 1,
  add column if not exists is_golden boolean not null default false,
  add column if not exists golden_capped boolean not null default false;

create index if not exists payouts_epoch_golden_idx on payouts(epoch_id, is_golden);
