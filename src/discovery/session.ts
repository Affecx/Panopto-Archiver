export function parseLectureUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (!/\/Panopto\/Pages\/(Viewer|Embed)\.aspx$/i.test(u.pathname)) return;
    const id = u.searchParams.get("id");
    return id && /^[a-z0-9-]{1,80}$/i.test(id) ? id : undefined;
  } catch {
    return;
  }
}
export function metadata(doc: Document, url: string) {
  const id = parseLectureUrl(url);
  if (!id) throw new Error("Open a Panopto Viewer or Embed lecture first.");
  const duration = Number(
    doc.querySelector('meta[name="duration"]')?.getAttribute("content"),
  );
  return {
    id,
    title:
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.title ||
      "Lecture",
    duration: duration > 0 ? duration : undefined,
  };
}
