"use client";

import { useEffect, useRef, useState } from "react";

const TWEET_URL = "https://x.com/pumpfun/status/1942947267436056740";
const SOON_DATE_MS = Date.UTC(2025, 6, 9, 14, 1, 41, 428);
const DAY_MS = 24 * 60 * 60 * 1000;

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement | null) => void;
      };
    };
  }
}

function daysSinceSoon(now: number) {
  return Math.max(0, Math.floor((now - SOON_DATE_MS) / DAY_MS));
}

export function BrokenPromise() {
  const tweetRef = useRef<HTMLDivElement>(null);
  const lastTarget = useRef(0);
  const [now, setNow] = useState<number | null>(null);
  const [displayDays, setDisplayDays] = useState(0);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadTweet = () => window.twttr?.widgets?.load(tweetRef.current);

    if (window.twttr?.widgets) {
      loadTweet();
      return;
    }

    let script = document.getElementById("twitter-wjs") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "twitter-wjs";
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      script.onload = loadTweet;
      document.body.appendChild(script);
      return;
    }

    script.addEventListener("load", loadTweet, { once: true });
    return () => script?.removeEventListener("load", loadTweet);
  }, []);

  useEffect(() => {
    if (now === null) return;

    const target = daysSinceSoon(now);
    const from = lastTarget.current;
    lastTarget.current = target;

    if (from === target) {
      setDisplayDays(target);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const duration = 900;

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayDays(Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [now]);

  return (
    <section className="section broken-promise" id="broken-promise">
      <div className="container">
        <div className="broken-promise-card">
          <div>
            <div className="eyebrow">
              <span className="pulse" />
              Days since soon
            </div>
            <h2>The Broken Promise</h2>
            <div className="promise-copy">
              <p>PumpFun said the airdrop was soon.</p>
              <p>The trenches waited.</p>
              <p>So we built one.</p>
              <p>
                Hold $AIRDROP. Earn real <span>$PUMP</span> automatically.
              </p>
            </div>
          </div>

          <div className="promise-proof">
            <div className="tweet-shell" ref={tweetRef}>
              <blockquote className="twitter-tweet" data-theme="dark" data-dnt="true" data-cards="hidden" data-width="360">
                <a href={TWEET_URL}>PumpFun tweet from July 9, 2025</a>
              </blockquote>
            </div>

            <div className="soon-counter">
              <span>Days Since "Soon"</span>
              <strong>{now === null ? "–" : displayDays.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
