import { NextResponse } from "next/server";

type EpochRow = { epoch_id: string };
type SnapshotRow = {
  wallet: string;
  source_balance: string | number | null;
};

function supabaseConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function getJson<T>(url: string, key: string) {
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Supabase error ${response.status}`);
  return (await response.json()) as T;
}

export async function GET() {
  const config = supabaseConfig();
  if (!config) return NextResponse.json({ topHolders: [], totalSupply: 0, uniqueHolders: 0 });

  try {
    const epochs = await getJson<EpochRow[]>(
      `${config.url}/rest/v1/epochs?select=epoch_id&order=started_at.desc&limit=1`,
      config.key
    );
    const epochId = epochs[0]?.epoch_id;
    if (!epochId) return NextResponse.json({ topHolders: [], totalSupply: 0, uniqueHolders: 0 });

    const snapshots = await getJson<SnapshotRow[]>(
      `${config.url}/rest/v1/snapshots?select=wallet,source_balance&epoch_id=eq.${encodeURIComponent(epochId)}&order=source_balance.desc&limit=50`,
      config.key
    );

    const totalSupply = snapshots.reduce((sum, row) => sum + toNumber(row.source_balance), 0);
    const topHolders = snapshots.map((row, index) => {
      const balance = toNumber(row.source_balance);
      return {
        rank: index + 1,
        address: row.wallet,
        balance,
        percentage: totalSupply > 0 ? ((balance / totalSupply) * 100).toFixed(2) : "0.00"
      };
    });

    return NextResponse.json({ topHolders, totalSupply, uniqueHolders: snapshots.length });
  } catch (error) {
    console.error("holders route failed", error);
    return NextResponse.json({ topHolders: [], totalSupply: 0, uniqueHolders: 0 });
  }
}
