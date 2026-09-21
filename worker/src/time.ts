import { config } from "./config.js";

export function currentEpochId(date = new Date()) {
  const sizeMs = config.epochMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / sizeMs) * sizeMs).toISOString();
}

export function msUntilNextEpoch(date = new Date()) {
  const sizeMs = config.epochMinutes * 60_000;
  return sizeMs - (date.getTime() % sizeMs);
}
