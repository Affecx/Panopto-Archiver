import { metadata } from "./session";
import { links, media, chapters } from "./resources";
import type { Session } from "../types";
export function discover(doc: Document, url: string): Session {
  const resources = links(doc, url);
  return {
    ...metadata(doc, url),
    resources: [...resources, ...media(doc, url, resources), ...chapters(doc)],
    warnings: [
      "Only explicit HTML download links are supported. Institution-specific controls may require an adapter.",
    ],
  };
}
