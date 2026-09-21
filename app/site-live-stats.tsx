"use client";

import { useEffect, useState } from "react";

type StatsResponse = {
  totalEpochs: number;
  totalRewardAirdropped: number;
  latestEligibleHolders: number;
};

const fallbackStats: StatsResponse = {
  totalEpochs: 0,
  totalRewardAirdropped: 0,
  latestEligibleHolders: 0
};

async function getStats() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) return fallbackStats;
    return (await response.json()) as StatsResponse;
  } catch {
    return fallbackStats;
  }
}

function displayNumber(value: number, empty = "–") {
  if (!value) return empty;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function SiteLiveStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const nextStats = await getStats();
      if (active) setStats(nextStats);
    };

    load();
    const timer = window.setInterval(load, 12_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="container stats">
      <div className="stat">
        <strong>{stats ? displayNumber(stats.totalEpochs) : "–"}</strong>
        <span>Total epochs</span>
      </div>
      <div className="stat">
        <strong>{stats ? displayNumber(stats.totalRewardAirdropped, "Awaiting first drop") : "–"}</strong>
        <span>Total PUMP airdropped</span>
      </div>
      <div className="stat">
        <strong>{stats ? displayNumber(stats.latestEligibleHolders) : "–"}</strong>
        <span>Total holders</span>
      </div>
    </div>
  );
}
