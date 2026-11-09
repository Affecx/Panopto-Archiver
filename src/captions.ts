export interface Cue {
  start: number;
  end: number;
  text: string;
}
export function seconds(time: string): number {
  const p = time.replace(",", ".").split(":").map(Number);
  if (
    p.length < 2 ||
    p.length > 3 ||
    p.some((n) => !Number.isFinite(n) || n < 0) ||
    p.slice(-2).some((n) => n >= 60)
  )
    throw new Error("Invalid caption timestamp");
  return p.reduce((a, n) => a * 60 + n, 0);
}
export function parseCaptions(raw: string): Cue[] {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n");
      const index = lines.findIndex((l) => l.includes("-->"));
      if (index < 0) return [];
      const times = lines[index]!.split("-->").map(
        (s) => s.trim().split(/\s/)[0]!,
      );
      const start = seconds(times[0]!),
        end = seconds(times[1]!);
      if (end < start) throw new Error("Caption ends before it starts");
      return [
        {
          start,
          end,
          text: lines
            .slice(index + 1)
            .join("\n")
            .replace(/<[^>]*>/g, "")
            .trim(),
        },
      ];
    });
}
export function timestamp(n: number, comma = false): string {
  const ms = Math.round(n * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${comma ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
}
export function srt(cues: Cue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.start, true)} --> ${timestamp(c.end, true)}\n${c.text}\n`,
    )
    .join("\n");
}
