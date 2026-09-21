"use client";

import { useEffect, useMemo, useState } from "react";

const EPOCH_MS = 5 * 60 * 1000;
const DISTRIBUTION_WINDOW_MS = 60 * 1000;
const FIRST_AIRDROP_AT = Date.parse(process.env.NEXT_PUBLIC_FIRST_AIRDROP_AT ?? "2026-06-27T23:55:00.000Z");

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RewardRoundPanel() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const state = useMemo(() => {
    if (now < FIRST_AIRDROP_AT) {
      return {
        label: "Epoch 1",
        title: formatCountdown(FIRST_AIRDROP_AT - now),
        description: "Until epoch 1 begins.",
        progress: 0
      };
    }

    const elapsedSinceLaunch = now - FIRST_AIRDROP_AT;
    const completedEpochs = Math.floor(elapsedSinceLaunch / EPOCH_MS);
    const epoch = completedEpochs + 1;
    const epochStart = FIRST_AIRDROP_AT + completedEpochs * EPOCH_MS;
    const nextEpochStart = epochStart + EPOCH_MS;
    const elapsedInEpoch = now - epochStart;
    const distributing = elapsedInEpoch < DISTRIBUTION_WINDOW_MS;

    if (distributing) {
      return {
        label: `Epoch ${epoch}`,
        title: `Distributing epoch ${epoch}`,
        description: "Rewards are being sent to eligible holders.",
        progress: (elapsedInEpoch / DISTRIBUTION_WINDOW_MS) * 100
      };
    }

    return {
      label: `Epoch ${epoch + 1}`,
      countdown: formatCountdown(nextEpochStart - now),
      title: formatCountdown(nextEpochStart - now),
      description: `Until epoch ${epoch + 1} begins.`,
      progress: (elapsedInEpoch / EPOCH_MS) * 100
    };
  }, [now]);

  return (
    <div className="round-panel" aria-live="polite">
      <div className="round-label">{state.label}</div>
      <div className="round-ring" aria-hidden="true">
        <span />
      </div>
      <strong>{state.title}</strong>
      <p>{state.description}</p>
      <div className="round-progress" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, state.progress))}%` }} />
      </div>
    </div>
  );
}
