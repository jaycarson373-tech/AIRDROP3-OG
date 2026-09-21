"use client";

import { useEffect, useState } from "react";

export function AppPolish() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reveal = () => {
      setLeaving(true);
      window.setTimeout(() => setVisible(false), 360);
    };

    const timer = window.setTimeout(reveal, 1100);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const selector = ".section, .card, .coin-card, .stat, .history-card, .round-panel";
    const elements = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );

    const observe = () => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!elements.has(element)) {
          elements.add(element);
          observer.observe(element);
        }
      });
    };

    observe();
    const mutationObserver = new MutationObserver(observe);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`loading-screen${leaving ? " is-leaving" : ""}`}>
      <div className="loader-mascot">
        <img src="/logo.png" alt="" />
      </div>
      <div className="loader-text">Preparing the airdrop…</div>
      <div className="loader-line" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
