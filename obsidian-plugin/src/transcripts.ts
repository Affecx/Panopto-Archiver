import { evidenceFromText, type Evidence } from "./study";
/** Keep repeated statements at different times; remove duplicate panel snapshots. */
export function mergeTranscripts(
  entries: { text: string; source: string; panelSnapshot: boolean }[],
): {
  evidence: Evidence[];
  rawBytes: number;
  cleanBytes: number;
  duplicates: number;
} {
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  let rawBytes = 0,
    duplicates = 0;
  for (const entry of entries) {
    rawBytes += Buffer.byteLength(entry.text, "utf8");
    for (const item of evidenceFromText(
      entry.text,
      entry.source,
      entry.panelSnapshot,
    )) {
      const key =
        item.text.trim().replace(/\s+/g, " ") +
        "|" +
        item.source.split(" · ").slice(1).join(" · ");
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      evidence.push({ ...item, id: `E${evidence.length + 1}` });
    }
  }
  return {
    evidence,
    rawBytes,
    cleanBytes: Buffer.byteLength(
      JSON.stringify({ lecture_data: evidence.map((e) => [e.id, e.text]) }),
      "utf8",
    ),
    duplicates,
  };
}
