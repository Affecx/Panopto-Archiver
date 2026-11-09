export type Kind =
  "video" | "audio" | "captions" | "slides" | "attachment" | "chapters";
export interface Resource {
  id: string;
  kind: Kind;
  name: string;
  format: string;
  url?: string;
  data?: string;
  language?: string;
  size?: number;
  status: "available" | "restricted" | "unsupported";
  reason?: string;
}
export interface Session {
  id: string;
  title: string;
  duration?: number;
  resources: Resource[];
  warnings: string[];
}
export interface Outcome {
  id: string;
  status: "success" | "failed" | "skipped";
  files: string[];
  error?: string;
}
