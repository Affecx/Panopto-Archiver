import { fileURLToPath } from "node:url";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync(new URL("./media/", import.meta.url), { recursive: true });
const out = fileURLToPath(new URL("./media/", import.meta.url));
const result = spawnSync(
  ffmpeg.path,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "10",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    `${out}part%02d.ts`,
    `${out}video.m3u8`,
  ],
  { encoding: "utf8" },
);
if (result.error || result.status !== 0)
  throw new Error(result.stderr || String(result.error));
const audio = spawnSync(
  ffmpeg.path,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "4",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    `${out}audio%02d.ts`,
    `${out}audio.m3u8`,
  ],
  { encoding: "utf8" },
);
if (audio.error || audio.status !== 0)
  throw new Error(audio.stderr || String(audio.error));
const directAudio = spawnSync(
  ffmpeg.path,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "4",
    "-c:a",
    "aac",
    `${out}audio.m4a`,
  ],
  { encoding: "utf8" },
);
if (directAudio.error || directAudio.status !== 0)
  throw new Error(directAudio.stderr || String(directAudio.error));
