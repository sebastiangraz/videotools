import { useEffect, useState } from "react";
import styles from "./VideoToolUploader.module.css";

const REPO = "sebastiangraz/videotools";
// On Vercel the label is pinned to the commit this deployment was built from;
// locally there is no build SHA, so it tracks the branch tip instead
const REF = __GIT_SHA__ || "main";
const CACHE_KEY = `version-label-${REF}`;
const CACHE_TTL = 5 * 60 * 1000;

interface Version {
  label: string;
  message: string;
  date: string;
  sha: string;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return rtf.format(-Math.floor(seconds / size), unit);
    }
  }
  return "just now";
}

async function fetchLatestCommit(): Promise<Version | null> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) {
    const { fetchedAt, version } = JSON.parse(cached);
    if (Date.now() - fetchedAt < CACHE_TTL) return version;
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/commits?sha=${REF}&per_page=1`,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) return null;

  // With per_page=1 the "last" page number in the Link header equals the
  // total commit count; the header is absent when there is only one commit
  const lastPage = res.headers.get("Link")?.match(/[?&]page=(\d+)>; rel="last"/);
  const count = lastPage ? Number(lastPage[1]) : 1;

  const [latest] = await res.json();
  const version: Version = {
    label: `V${((count - 1) / 100).toFixed(2)}`,
    message: latest.commit.message.split("\n")[0],
    date: latest.commit.committer.date,
    sha: latest.sha.slice(0, 7),
  };
  sessionStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ fetchedAt: Date.now(), version })
  );
  return version;
}

export const VersionLabel = () => {
  const [version, setVersion] = useState<Version | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestCommit()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  return (
    <a
      className={styles.versionLabel}
      href={`https://github.com/${REPO}/commit/${version.sha}`}
      target="_blank"
      rel="noreferrer"
      title={`${version.sha} · ${new Date(version.date).toLocaleString()}`}
    >
      {version.label} ·
      <span className={styles.versionStack}>
        <span className={styles.versionTime}>{timeAgo(version.date)}</span>
        <span className={styles.versionMessage}>{version.message}</span>
      </span>
    </a>
  );
};
