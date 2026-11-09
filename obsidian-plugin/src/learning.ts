import { createHash } from "node:crypto";
import { qualityWarnings, type Evidence, type Study } from "./study";
export interface ReferenceMedia {
  version: number;
  feeds: {
    id: string;
    label: string;
    path: string;
    duration: number | null;
    hasAudio: boolean | null;
    role: string;
    alignment: string;
    recording?: string;
    recordingTitle?: string;
  }[];
  frames: {
    id: string;
    feed: string;
    time: number;
    path: string;
    origin: string;
    role: string;
    archiveRelative?: boolean;
  }[];
  warnings: string[];
  sampling: string;
}
export function sourceTime(e: Evidence): number | undefined {
  if (e.kind === "note") return undefined;
  const match = / · (\d{1,2}:\d{2}(?::\d{2})?)$/.exec(e.source);
  if (!match) return undefined;
  const parts = match[1]!.split(":").map(Number);
  if (parts.slice(1).some((n) => n >= 60)) return undefined;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}
export function localAsset(value: string): string {
  if (
    !value ||
    value.startsWith("/") ||
    /[\\:#?\x00-\x1f]/.test(value) ||
    value.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw new Error("Invalid local reference asset");
  return value.split("/").map(encodeURIComponent).join("/");
}
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
export function renderLearningPage(
  title: string,
  studies: Study[],
  evidence: Evidence[],
  media: ReferenceMedia,
  warnings: string[] = [],
): string {
  if (!evidence.length)
    throw new Error("Original lecture evidence is required");
  const allowed = new Set(evidence.map((e) => e.id));
  for (const study of studies)
    for (const item of [
      ...study.takeaways,
      ...study.examples,
      ...(study.lessons ?? []),
    ])
      if (!item.evidence.length || item.evidence.some((id) => !allowed.has(id)))
        throw new Error("Unknown lecture evidence");
  const data = {
    storageKey: createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          title,
          studies: studies.map(({ lessons, ...study }) => study),
          evidence,
        }),
      )
      .digest("hex"),
    title,
    studies,
    evidence: evidence.map((e) => ({ ...e, time: sourceTime(e) ?? null })),
    media: {
      ...media,
      feeds: media.feeds.map((f) => ({
        ...f,
        path: "../" + localAsset(f.path),
      })),
      frames: media.frames.map((f) => ({
        ...f,
        path: (f.archiveRelative ? "../" : "") + localAsset(f.path),
      })),
    },
    warnings: [
      ...warnings,
      ...media.warnings,
      ...studies.flatMap(qualityWarnings),
    ],
  };
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const script = `const DATA=${json};\n(${runtime.toString()})();`;
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const pageStyles = styles + guidedStyles;
  const styleHash = createHash("sha256").update(pageStyles).digest("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src 'self' file: data:; media-src 'self' file: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)} · Lecture lab</title><style>${pageStyles}</style></head><body><div id="app"></div><noscript>This learning page needs JavaScript for local interactions. Original media and captions remain in the archive.</noscript><script>${script}</script></body></html>`;
}
// This function is serialized into the local page. Never evaluate model-authored code.
declare const DATA: {
  storageKey: string;
  title: string;
  studies: Study[];
  evidence: (Evidence & { time: number | null })[];
  media: ReferenceMedia;
  warnings: string[];
};
function runtime() {
  const $ = (tag: string, text = "", cls = "") => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const app = document.getElementById("app")!;
  const time = (n: number) =>
    Math.floor(n / 60) +
    ":" +
    Math.floor(n % 60)
      .toString()
      .padStart(2, "0");
  const namespace = "lecture-lab:" + DATA.storageKey;
  let saved: Record<string, string> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(namespace) || "{}");
    if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        if (typeof v === "string") saved[k] = v;
  } catch {}
  const save = (key: string, value: string) => {
    saved[key] = value;
    try {
      localStorage.setItem(namespace, JSON.stringify(saved));
    } catch {}
    updateProgress();
  };
  const header = $("header");
  const theme = $("button", "", "theme-switch");
  const themeKey = "lecture-lab:theme";
  const setTheme = (light: boolean) => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    theme.textContent = light ? "Dark mode" : "Light mode";
  };
  try {
    setTheme(localStorage.getItem(themeKey) === "light");
  } catch {
    setTheme(false);
  }
  theme.addEventListener("click", () => {
    const light = document.documentElement.dataset.theme !== "light";
    setTheme(light);
    try {
      localStorage.setItem(themeKey, light ? "light" : "dark");
    } catch {}
  });
  header.append($("span", "LECTURE LAB", "eyebrow"), theme);
  app.append(header);
  const layout = $("div", "", "layout"),
    aside = $("aside"),
    main = $("main");
  app.append(layout);
  layout.append(aside, main);
  aside.append(
    $("p", "YOUR SESSION", "eyebrow"),
    $("h2", "Learn. Check. Recall."),
  );
  const progress = document.createElement("progress");
  progress.max = 1;
  aside.append(progress);
  const progressLabel = $("p", "", "muted");
  aside.append(progressLabel);
  const nav = $("nav");
  aside.append(nav);
  const guided = DATA.studies.some((study) =>
    study.lessons?.some((lesson) => lesson.practice),
  );
  const folderEvidence = DATA.evidence.some((e) => e.kind === "note");
  for (const [id, label] of [
    ["learn", guided ? "1. Learn and practise" : "1. Learn the concepts"],
    ...(guided ? [] : [["workshop", "2. Practise"]]),
    ["recall", guided ? "2. Recall and review" : "3. Review"],
    ["reference", folderEvidence ? "Source references" : "Original lecture"],
    ["transcript", folderEvidence ? "Source excerpts" : "Source transcript"],
  ]) {
    const a = document.createElement("a");
    a.href = "#" + id;
    a.textContent = label!;
    nav.append(a);
  }
  const exportButton = $("button", "Export my progress");
  aside.append(exportButton);
  exportButton.addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify({ lecture: DATA.title, answers: saved }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lecture-progress.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  aside.append(
    $(
      "p",
      "Your answers stay in this browser. Export them to keep a copy. Nothing is sent to a model while studying.",
      "small muted",
    ),
  );
  main.append(
    $("p", "FROM THE RECORDING, INTO PRACTICE", "eyebrow"),
    $("h1", DATA.title),
    ...(guided && DATA.studies.length === 1
      ? [$("p", DATA.studies[0]!.summary, "lead")]
      : []),
    $(
      "p",
      guided
        ? "Follow a worked example, try a variation, then check what you can recall from memory."
        : "Explore the original moments. Work through examples. Test your understanding.",
      "lead",
    ),
  );
  const learn = $("section");
  learn.id = "learn";
  learn.append($("h2", guided ? "Learn and practise" : "Learn the concepts"));
  main.append(learn);
  const notice = $("details", "", "notice");
  notice.append(
    $("summary", "About the evidence and its limits"),
    $(
      "p",
      folderEvidence
        ? "References distinguish folder notes from archived lecture captions. AI explanations and exercises are drafts. Recorded frames and feed alignment may need review."
        : "Caption excerpts and recorded frames are the references. AI explanations and exercises are drafts. Visual meaning and feed synchronization are unverified. A frame may show slides, code, a website, handwriting, a camera or an object demonstration; none is assumed to be a slide.",
    ),
  );
  for (const warning of DATA.warnings) notice.append($("p", warning));
  notice.append(
    $(
      "p",
      DATA.media.sampling ||
        "Sampled frames can miss short actions; watch the recordings.",
    ),
  );

  const reference = $("section");
  reference.id = "reference";
  main.append(reference);
  reference.append(
    $("h2", folderEvidence ? "Source references" : "Original lecture"),
  );
  const status = $(
    "p",
    "Choose a cited source or search the source excerpts.",
    "status",
  );
  status.setAttribute("aria-live", "polite");
  reference.append(status, notice);
  const recordings = new Map(
    DATA.media.feeds.flatMap((feed) =>
      feed.recording
        ? [[feed.recording, feed.recordingTitle || feed.label] as const]
        : [],
    ),
  );
  let currentRecording = DATA.media.feeds[0]?.recording;
  const recordingSelect = document.createElement("select");
  if (recordings.size > 1) {
    const label = $("label", "Recording ");
    for (const [id, title] of recordings) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = title;
      recordingSelect.append(option);
    }
    recordingSelect.addEventListener("change", () =>
      seek(0, recordingSelect.value),
    );
    label.append(recordingSelect);
    reference.append(label);
  }
  const videos = $("div", "", "videos");
  reference.append(videos);
  const players: {
    video: HTMLVideoElement;
    offset: HTMLInputElement;
    card: HTMLElement;
    recording?: string;
  }[] = [];
  const audioGroups = new Set<string | undefined>();
  for (const feed of DATA.media.feeds) {
    const card = $("article", "", "feed");
    card.hidden = feed.recording !== currentRecording;
    videos.append(card);
    card.append(
      $("h3", feed.label + (feed.hasAudio === false ? " · no audio" : "")),
    );
    const video = document.createElement("video");
    video.src = feed.path;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = feed.hasAudio === false || audioGroups.has(feed.recording);
    if (feed.hasAudio !== false) audioGroups.add(feed.recording);
    card.append(video);
    const playbackStatus = $("p", "", "small");
    playbackStatus.setAttribute("role", "status");
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "video/mp4,video/webm,.mp4,.webm";
    const pickLabel = $(
      "label",
      "Choose local video for " + feed.label,
      "small",
    );
    pickLabel.append(picker);
    const recovery = document.createElement("details");
    recovery.append(
      $("summary", "Video troubleshooting"),
      pickLabel,
      $(
        "p",
        "Choose the matching file from the lecture’s media folder. This loads the file directly in this tab.",
      ),
    );
    card.append(playbackStatus, recovery);
    video.addEventListener("error", () => {
      playbackStatus.textContent =
        "This browser could not load " +
        decodeURIComponent(feed.path.split("/").pop() || "the recording") +
        ". Choose the local video below or open the recording separately.";
      recovery.open = true;
    });
    let localVideo: string | undefined;
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (localVideo) URL.revokeObjectURL(localVideo);
      localVideo = URL.createObjectURL(file);
      video.src = localVideo;
      video.load();
    });
    video.addEventListener("loadedmetadata", () => {
      playbackStatus.textContent = "";
      const target = currentTime + (Number(offset.value) || 0);
      if (
        feed.recording === currentRecording &&
        target >= 0 &&
        target < video.duration
      )
        video.currentTime = target;
    });
    const label = $("label", "Timing offset (seconds, unverified): ", "small");
    const offset = document.createElement("input");
    offset.type = "number";
    offset.step = "0.1";
    offset.value = saved["offset:" + feed.id] || "0";
    offset.addEventListener("change", () =>
      save("offset:" + feed.id, offset.value),
    );
    label.append(offset);
    card.append(label);
    players.push({ video, offset, card, recording: feed.recording });
    const fallback = document.createElement("a");
    fallback.href = feed.path;
    fallback.textContent = "Open original recording";
    fallback.target = "_blank";
    fallback.rel = "noopener";
    card.append(fallback);
  }
  if (!players.length)
    videos.append(
      $(
        "p",
        "No local recording available. Visual examples cannot be checked here. Import authorised media to add it.",
        "notice",
      ),
    );
  let currentTime = 0;
  const controls = $("div", "", "row");
  reference.append(controls);
  const play = $("button", "Play this moment"),
    pause = $("button", "Pause all");
  controls.append(play, pause);
  play.addEventListener("click", () => {
    void Promise.allSettled(
      players.filter((p) => !p.card.hidden).map((p) => p.video.play()),
    ).then((results) => {
      if (results.some((r) => r.status === "rejected"))
        status.textContent =
          "Some feeds could not play here. Use Open original recording.";
    });
  });
  pause.addEventListener("click", () =>
    players.forEach((p) => p.video.pause()),
  );
  const selected = $("blockquote", "", "selected-source");
  reference.append(selected);
  const frames = $("div", "", "frames");
  reference.append(frames);
  const annotation = $("details", "", "annotation"),
    summary = $("summary", "Observe this visual example"),
    kind = document.createElement("select"),
    observation = document.createElement("textarea");
  annotation.append(summary);
  reference.append(annotation);
  for (const [v, t] of [
    ["unreviewed", "Unreviewed"],
    ["slides", "Slide / presentation"],
    ["desktop", "Desktop app / code"],
    ["website", "Website"],
    ["handwriting", "Handwriting / overhead camera"],
    ["physical", "Physical object demonstration"],
    ["other", "Other / mixed view"],
  ]) {
    const o = document.createElement("option");
    o.value = v!;
    o.textContent = t!;
    kind.append(o);
  }
  const kindLabel = $("label", "What is shown? ");
  kindLabel.append(kind);
  annotation.append(kindLabel);
  observation.placeholder =
    "Describe what you actually see. For a physical example, note which object represents which concept. These observations are yours, not model-verified.";
  observation.setAttribute("aria-label", "Your visual observation");
  annotation.append(observation);
  const annotationKey = () =>
    "visual:" +
    (currentRecording ? currentRecording + ":" : "") +
    Math.round(currentTime);
  kind.addEventListener("change", () =>
    save(annotationKey() + ":kind", kind.value),
  );
  observation.addEventListener("input", () =>
    save(annotationKey() + ":note", observation.value),
  );
  function seek(at: number, recording = currentRecording) {
    if (recording !== currentRecording && recordings.has(recording ?? "")) {
      currentRecording = recording;
      recordingSelect.value = recording ?? "";
      for (const p of players) {
        p.card.hidden = p.recording !== recording;
        if (p.card.hidden) p.video.pause();
      }
    }
    currentTime = at;
    status.textContent =
      "Original reference · " + time(at) + " · feed alignment unverified";
    for (const p of players) {
      if (p.card.hidden) continue;
      const t = at + (Number(p.offset.value) || 0);
      if (
        t >= 0 &&
        (!Number.isFinite(p.video.duration) || t < p.video.duration)
      ) {
        try {
          p.video.currentTime = t;
        } catch {}
      }
    }
    kind.value = saved[annotationKey() + ":kind"] || "unreviewed";
    observation.value = saved[annotationKey() + ":note"] || "";
    frames.replaceChildren();
    for (const feed of DATA.media.feeds) {
      if (feed.recording !== currentRecording) continue;
      const nearest = DATA.media.frames
        .filter((f) => f.feed === feed.id)
        .sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))
        .slice(0, 3)
        .sort((a, b) => a.time - b.time);
      for (const frame of nearest) {
        const figure = document.createElement("figure"),
          img = document.createElement("img"),
          button = $("button", feed.label + " · " + time(frame.time));
        img.src = frame.path;
        img.alt =
          "Actual recording frame, " +
          feed.label +
          ", " +
          time(frame.time) +
          ". Visual content unclassified.";
        img.loading = "lazy";
        const zoom = document.createElement("a");
        zoom.href = frame.path;
        zoom.target = "_blank";
        zoom.rel = "noopener";
        zoom.setAttribute(
          "aria-label",
          "Open reference frame at " + time(frame.time),
        );
        zoom.append(img);
        figure.append(
          zoom,
          $(
            "figcaption",
            Math.abs(frame.time - at) > 10
              ? "Nearby frame; use video for the exact moment"
              : "Recorded reference frame",
          ),
          button,
        );
        button.addEventListener("click", () => seek(frame.time));
        frames.append(figure);
      }
    }
  }
  const byId = new Map(DATA.evidence.map((e) => [e.id, e]));
  const returnToTask = $("button", "Back to the exercise");
  returnToTask.hidden = true;
  reference.prepend(returnToTask);
  let sourceTrigger: HTMLElement | undefined;
  returnToTask.addEventListener("click", () => sourceTrigger?.focus());
  function showSource(id: string, scroll = true) {
    const e = byId.get(id);
    if (!e) return;
    selected.textContent = e.text + " — " + e.id + " · " + e.source;
    if (e.kind === "note") status.textContent = "Folder note · " + e.source;
    else if (e.recording && !recordings.has(e.recording))
      status.textContent = "No local recording is available for this caption.";
    else if (e.time !== null) seek(e.time, e.recording);
    else {
      if (e.recording && e.recording !== currentRecording) seek(0, e.recording);
      status.textContent =
        "This excerpt has no verified timestamp. Search the recording manually.";
    }
    if (scroll)
      reference.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function citations(ids: string[]) {
    const row = $("div", "", "citations");
    for (const id of ids) {
      const e = byId.get(id);
      const b = $(
        "button",
        id +
          (e?.time !== null && e?.time !== undefined
            ? " · " + time(e.time)
            : ""),
      );
      b.addEventListener("click", () => {
        sourceTrigger = b;
        returnToTask.hidden = false;
        showSource(id);
        returnToTask.focus({ preventScroll: true });
      });
      row.append(b);
    }
    return row;
  }
  const topics = $("ol", "", "study-path");
  if (guided) {
    const topicNav = $("nav", "", "topic-nav");
    topicNav.setAttribute("aria-label", "Jump to a topic");
    topicNav.append(topics);
    learn.append(topicNav);
  }
  // Render only fenced code as code. All model and lecture text stays inert.
  function appendContent(target: HTMLElement, content: string, trace = false) {
    const fences =
      /^`{3}(python|py|bash|sh|shell|console)?[ \t]*\r?\n([\s\S]*?)^`{3}[ \t]*(?:\r?\n|$)/gm;
    const names: Record<string, string> = {
      python: "Python",
      py: "Python",
      bash: "Shell",
      sh: "Shell",
      shell: "Shell",
      console: "Terminal output",
    };
    const prose = (text: string) => {
      if (text.trim()) target.append($("p", text.trim(), "lesson-text"));
    };
    let end = 0;
    for (const block of content.matchAll(fences)) {
      prose(content.slice(end, block.index));
      const pre = $("pre", "", "code-block");
      pre.append($("code", block[2]!.replace(/\r?\n$/, "")));
      target.append(
        $("span", names[block[1] || ""] ?? "Code", "code-language"),
        pre,
      );
      end = block.index! + block[0].length;
    }
    if (end || !trace) prose(content.slice(end));
    else target.append($("pre", content));
  }
  const review = $("div");
  let lessonNumber = 0;
  const totalLessons = DATA.studies.reduce(
    (total, study) => total + (study.lessons?.length ?? 0),
    0,
  );
  const guidedKeys: string[] = [];
  for (const study of DATA.studies) {
    if (!study.lessons?.length) {
      learn.append($("p", study.summary, "lead"));
      const list = $("ul");
      for (const takeaway of study.takeaways) {
        const item = $("li", takeaway.text);
        item.append(citations(takeaway.evidence));
        list.append(item);
      }
      learn.append(list);
      continue;
    }
    for (const lesson of study.lessons) {
      const card = $("article", "", "exercise");
      const title = $("h3", ++lessonNumber + ". " + lesson.title);
      card.id = "lesson-" + lessonNumber;
      const link = $("a", lesson.title) as HTMLAnchorElement;
      link.href = "#" + card.id;
      const topic = $("li");
      topic.append(link);
      topics.append(topic);
      card.append(title);
      if (lesson.practice) card.append($("p", lesson.practice.goal, "goal"));
      card.append($("p", lesson.explanation, "lesson-text"));
      const example = $("div", "", "worked-example");
      example.append($("h4", "Follow the example"));
      appendContent(example, lesson.walkthrough, true);
      card.append(example);
      if (lesson.practice) {
        const practice = lesson.practice;
        const key = "guided:" + lessonNumber;
        guidedKeys.push(key);
        const task = $("div", "", "guided-task");
        const attempt = document.createElement("textarea");
        attempt.id = "answer-" + lessonNumber;
        const answerLabel = $("label", "Your answer", "answer-label");
        answerLabel.setAttribute("for", attempt.id);
        attempt.placeholder = "Write your answer and reasoning…";
        attempt.value = saved[key + ":answer"] || "";
        attempt.addEventListener("input", () =>
          save(key + ":answer", attempt.value),
        );
        const hint = document.createElement("details");
        hint.append($("summary", "Show a hint"), $("p", practice.hint));
        const solution = document.createElement("details");
        solution.append($("summary", "Compare with the worked answer"));
        appendContent(solution, lesson.answer);
        solution.append($("p", lesson.misconception, "lesson-text"));
        const setup = $("div", "", "task-setup");
        setup.append($("h5", "Starting point"));
        appendContent(setup, practice.setup);
        const question = $("p", lesson.question, "task-question");
        question.id = "question-" + lessonNumber;
        attempt.setAttribute("aria-describedby", question.id);
        task.append(
          $("h4", "Try a variation"),
          setup,
          $("h5", "What to do"),
          question,
          answerLabel,
          attempt,
          hint,
          solution,
        );
        const label = $("label", "", "check");
        const done = document.createElement("input");
        done.type = "checkbox";
        done.checked = saved[key] === "yes";
        done.addEventListener("change", () =>
          save(key, done.checked ? "yes" : "no"),
        );
        label.append(done, document.createTextNode(" I checked my reasoning"));
        task.append(label);
        const actions = $("div", "", "lesson-actions");
        const indexLink = document.createElement("a");
        indexLink.href = "#learn";
        indexLink.textContent = "All topics";
        const next = document.createElement("a");
        const last = lessonNumber === totalLessons;
        next.href = last ? "#recall" : "#lesson-" + (lessonNumber + 1);
        next.textContent = last ? "Go to review →" : "Next topic →";
        actions.append(indexLink, next);
        card.append(task, citations(lesson.evidence), actions);
        const recallCard = document.createElement("details");
        recallCard.append(
          $("summary", practice.recallQuestion),
          $("p", practice.recallAnswer, "lesson-text"),
        );
        const back = $("a", "Revisit " + lesson.title) as HTMLAnchorElement;
        back.href = "#" + card.id;
        recallCard.append(back);
        review.append(recallCard);
        learn.append(card);
        continue;
      }
      card.append($("h4", "Common mistake"), $("p", lesson.misconception));
      const check = document.createElement("details");
      check.append(
        $("summary", "Check your understanding"),
        $("p", lesson.question),
      );
      const solution = document.createElement("details");
      solution.append(
        $("summary", "Show the reasoning"),
        $("p", lesson.answer),
      );
      check.append(solution);
      card.append(check, citations(lesson.evidence));
      learn.append(card);
    }
  }
  const workshop = guided ? document.createElement("details") : $("section");
  workshop.id = "workshop";
  main.append(workshop);
  workshop.append(
    guided ? $("summary", "Extra worked practice") : $("h2", "Worked practice"),
  );
  let practiceCount = 0;
  for (const study of DATA.studies) {
    for (const ex of study.examples) {
      const n = practiceCount++,
        card = $("article", "", "exercise");
      workshop.append(card);
      card.append(
        $("span", "CONSTRUCTED EXERCISE · CHECK THE RECORDING", "eyebrow"),
        $("h3", ex.title),
        $("p", ex.problem),
        citations(ex.evidence),
      );
      const attempt = document.createElement("textarea");
      attempt.placeholder = "Try it before revealing the solution…";
      attempt.setAttribute("aria-label", "Your attempt: " + ex.title);
      attempt.value = saved["attempt:" + n] || "";
      attempt.addEventListener("input", () =>
        save("attempt:" + n, attempt.value),
      );
      card.append(attempt);
      ex.steps.forEach((step, i) => {
        const detail = document.createElement("details");
        detail.append($("summary", "Step " + (i + 1)), $("pre", step));
        card.append(detail);
      });
      const answer = document.createElement("details");
      answer.append(
        $("summary", "Reveal answer and check"),
        $("pre", ex.answer),
        $("p", ex.check),
      );
      card.append(answer);
      const label = $("label", "", "check");
      const done = document.createElement("input");
      done.type = "checkbox";
      done.checked = saved["done:" + n] === "yes";
      done.addEventListener("change", () =>
        save("done:" + n, done.checked ? "yes" : "no"),
      );
      label.append(
        done,
        document.createTextNode(" I checked my reasoning against the source"),
      );
      card.append(label);
    }
  }
  const recall = $("section");
  if (guided && practiceCount === 0) workshop.remove();
  recall.id = "recall";
  main.append(recall);
  recall.append($("h2", "Recall & review"));
  if (guided) {
    recall.append(
      $(
        "p",
        "Answer each question before opening it. Revisit any concept you hesitated on, then try the questions again tomorrow.",
      ),
      review,
    );
  }
  for (const s of DATA.studies.filter((study) => !study.lessons?.length))
    for (const t of s.takeaways) {
      const d = document.createElement("details");
      d.className = "takeaway";
      d.append(
        $(
          "summary",
          "Recall the idea at " +
            t.evidence
              .map((id) => {
                const e = byId.get(id);
                return e?.time !== null && e?.time !== undefined
                  ? time(e.time)
                  : id;
              })
              .join(", "),
        ),
        $("p", t.text),
        citations(t.evidence),
      );
      recall.append(d);
    }
  const captionPractice = document.createElement("details");
  captionPractice.append(
    $("summary", "Optional caption recall"),
    $(
      "p",
      "Fill the missing word from an actual caption excerpt. This checks recall of the transcript, not conceptual correctness.",
      "muted",
    ),
  );
  let quizCount = 0;
  const quizIds = [
    ...new Set(
      DATA.studies.flatMap((s) => s.takeaways.flatMap((t) => t.evidence)),
    ),
  ].slice(0, 10);
  for (const id of quizIds) {
    const e = byId.get(id);
    if (!e || e.kind === "note") continue;
    const word = e.text.match(/\b[a-zA-Z]{7,}\b/)?.[0];
    if (!word) continue;
    const n = quizCount++,
      card = $("article", "", "quiz");
    card.append($("p", e.text.replace(word, "________")), citations([id]));
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Missing caption word " + (n + 1));
    input.value = saved["quiz-answer:" + n] || "";
    const check = $("button", "Check word"),
      feedback = $("p", "", "feedback");
    feedback.setAttribute("aria-live", "polite");
    card.append(input, check, feedback);
    const checkAnswer = () => {
      const correct =
        input.value.trim().toLocaleLowerCase() === word.toLocaleLowerCase();
      feedback.textContent = correct
        ? "Matches the recorded caption."
        : "Not an exact caption match. Open the source and try again.";
      save("quiz-answer:" + n, input.value);
      save("quiz:" + n, correct ? "yes" : "no");
    };
    check.addEventListener("click", checkAnswer);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") checkAnswer();
    });
    captionPractice.append(card);
  }
  for (const s of DATA.studies.filter(
    (study) => !study.lessons?.some((lesson) => lesson.practice),
  ))
    for (const q of s.questions) {
      const d = document.createElement("details");
      d.append(
        $("summary", q),
        $(
          "p",
          "Use the original transcript and recordings to form your own answer. This prompt has no automatically verified answer key.",
        ),
      );
      recall.append(d);
    }
  if (quizCount) recall.append(captionPractice);
  main.append(reference);
  const transcript = $("section");
  transcript.id = "transcript";
  main.append(transcript);
  transcript.append(
    $("h2", folderEvidence ? "Source excerpts" : "Source transcript"),
  );
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = folderEvidence
    ? "Search notes and captions…"
    : "Search the actual captions…";
  search.setAttribute(
    "aria-label",
    folderEvidence ? "Search notes and captions" : "Search original captions",
  );
  transcript.append(search);
  const list = $("div", "", "transcript-list");
  transcript.append(list);
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    for (const e of DATA.evidence.filter(
      (e) => !query || e.text.toLocaleLowerCase().includes(query),
    )) {
      const row = $("article", "", "excerpt"),
        button = $("button", e.time !== null ? time(e.time) : e.id);
      button.addEventListener("click", () => showSource(e.id));
      row.append(button, $("p", e.text), $("small", e.id + " · " + e.source));
      list.append(row);
    }
  }
  search.addEventListener("input", filter);
  filter();
  function updateProgress() {
    if (guided) {
      const done = guidedKeys.filter((key) => saved[key] === "yes").length;
      progress.max = guidedKeys.length;
      progress.value = done;
      progressLabel.textContent =
        done + " / " + guidedKeys.length + " exercises self-checked";
      return;
    }
    const total = practiceCount + quizCount;
    const done = Object.entries(saved).filter(
      ([k, v]) =>
        (k.startsWith("done:") || k.startsWith("quiz:")) && v === "yes",
    ).length;
    progress.max = total || 1;
    progress.value = Math.min(done, total);
    progressLabel.textContent =
      Math.min(done, total) +
      " / " +
      total +
      " completed (self-check + caption recall)";
  }
  updateProgress();
  if (DATA.evidence[0]) showSource(DATA.evidence[0].id, false);
}
const styles = `.lesson-text{white-space:pre-line}.feed details{color:var(--ink)}.feed details label{color:var(--ink)}.feed input[type=file]{display:block;max-width:100%}/* The light palette also keeps printed worksheets legible. */
:root {
  color-scheme: dark;
  --ink: #e7eef2; --muted: #a7b8c2; --line: #3e525e; --paper: #10171e;
  --surface: #18232d; --panel: #1c3039; --code: #111e26; --hover: #2a4450;
  --accent: #8cddc6; --accent-ink: #0a201b; --focus: #ffc17a;
}
:root[data-theme="light"] {
  color-scheme: light;
  --ink: #132c35; --muted: #4c6269; --line: #aabfbd; --paper: #f3f6f1;
  --surface: #fff; --panel: #e5eee6; --code: #eef4ef; --hover: #e3f0ea;
  --accent: #106f65; --accent-ink: #fff; --focus: #995410;
}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,sans-serif}header{display:flex;justify-content:space-between;align-items:center;padding:22px 4vw;background:#102c34;color:#edf5ef;gap:16px}header .muted{color:#bfd3cf}.eyebrow{font-size:11px;letter-spacing:.17em;font-weight:800;color:var(--accent)}header .eyebrow{color:#87d5bf}.layout{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1600px;margin:auto}aside{position:sticky;top:0;align-self:start;padding:38px 24px;height:100vh;overflow:auto;border-right:1px solid var(--line)}aside h2{font-size:24px;line-height:1.25}nav{display:grid;gap:12px;margin:28px 0}a{color:var(--accent);text-underline-offset:4px}nav a{text-decoration:none;font-size:14px}main{padding:44px clamp(20px,4vw,64px);min-width:0;width:100%;max-width:1120px}h1{font-size:clamp(30px,4vw,52px);line-height:1.1;letter-spacing:-.04em;overflow-wrap:anywhere;margin:12px 0 20px}h2{font-size:30px;line-height:1.2}h3{font-size:20px;line-height:1.35}.lead{font-size:18px;color:var(--muted);max-width:80ch}.muted,.small,small{color:var(--muted)}.small,small{font-size:12px}section{margin-top:54px;scroll-margin-top:24px;border-top:1px solid var(--line);padding-top:28px}button,input,textarea,select{font:inherit}button{border:1px solid var(--line);background:var(--surface);color:var(--accent);border-radius:7px;padding:9px 14px;cursor:pointer}button:hover{background:var(--hover)}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--focus);outline-offset:3px}input,textarea,select{padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}textarea{display:block;width:100%;min-height:110px;resize:vertical;margin:18px 0}input[type=number]{width:90px}input[type=search]{width:100%;margin-bottom:18px}progress{accent-color:var(--accent);width:100%;height:8px}details{border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:12px 0;background:var(--surface)}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace;background:var(--code);padding:16px;border-radius:7px}.notice{background:var(--panel);font-size:14px}.videos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}.feed{background:#102c34;color:#fff;padding:16px;border-radius:12px;min-width:0}.feed h3{margin:0 0 12px;font-size:15px}.feed video{width:100%;max-height:390px;background:#000;display:block;margin-bottom:12px}.feed a,.feed label{color:#c0ded5}.feed a{display:block;font-size:12px;margin-top:8px}.row,.citations{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.row button:first-child{background:var(--accent);color:var(--accent-ink)}.status{font-size:13px;color:var(--muted)}.selected-source{border-left:3px solid var(--accent);background:var(--surface);margin:20px 0;padding:20px;font-size:17px}.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px}figure{margin:0;background:var(--surface);padding:10px;border:1px solid var(--line);border-radius:8px;min-width:0}figure img{width:100%;aspect-ratio:16/9;object-fit:contain;background:#e5e9e4}figure button{font-size:11px;width:100%;margin-top:8px}figcaption{font-size:11px;color:var(--muted)}.exercise{padding:26px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin:22px 0}.check{display:flex;gap:10px;align-items:center}.citations button{font-size:12px;padding:5px 10px}.quiz{padding:20px;border-bottom:1px solid var(--line)}.quiz input{max-width:100%;margin-right:8px}.feedback{font-size:13px}.transcript-list{max-height:650px;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px}.excerpt{display:grid;grid-template-columns:65px 1fr;gap:8px 16px;padding:16px;border-bottom:1px solid var(--line)}.excerpt p{margin:0}.excerpt small{grid-column:2}.excerpt button{align-self:start;font-size:12px;padding:5px} .coverage{padding:12px 16px;border-left:3px solid #b78b43;border-radius:4px}@media(max-width:850px){.layout{grid-template-columns:1fr}aside{position:static;height:auto;overflow:visible;border-right:0;border-bottom:1px solid var(--line);padding:20px}aside h2{display:none}nav{display:flex;flex-wrap:wrap;margin:12px 0;gap:12px}main{padding:28px 18px}header{font-size:12px}.exercise{padding:18px}}@media print{aside,header,video,button,input,textarea,.frames,.annotation{display:none}main{padding:0}.layout{display:block}details{break-inside:avoid}section{margin-top:24px}}`;

const guidedStyles = `
.theme-switch { background: #193c47; color: #d2eee7; border-color: #57717a; font-size: 14px }
.theme-switch:hover { background: #274b55 }
.topic-nav { display: block; margin: 18px 0 24px }
.study-path a:hover, nav a:focus-visible { text-decoration: underline }
.worked-example, .task-setup, .task-question, .exercise .lesson-text { max-width: 76ch }
.exercise h3 { margin-top: 0 }
.worked-example h4, .guided-task h4 { margin-bottom: 8px }
.guided-task h5, .answer-label, .code-language { display: block; font-size: 13px; font-weight: 700; color: var(--muted); margin: 14px 0 4px }
.task-setup p, .task-question { margin: 4px 0 14px }
.task-question { font-size: 17px; font-weight: 650 }
.answer-label { color: var(--ink) }
.code-language { color: var(--accent); margin-bottom: 0 }
.code-block { white-space: pre; overflow-x: auto; margin-top: 4px; border: 1px solid var(--line) }
.lesson-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px }
@media print {
  :root, :root[data-theme="light"] {
    color-scheme: light; --ink: #161616; --muted: #4c4c4c; --line: #aaa; --paper: #fff;
    --surface: #fff; --panel: #fff; --code: #fff; --accent: #183f36;
  }
}
.study-path { columns: 2; padding: 16px 24px 16px 42px; background: var(--panel); border-radius: 8px }
.study-path li { break-inside: avoid; padding: 4px 12px 4px 0 }
.exercise[id] { scroll-margin-top: 20px }
.exercise .goal { font-weight: 650; color: var(--accent) }
.guided-task { margin-top: 24px; padding: 14px clamp(12px, 3vw, 24px); background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px }
.guided-task h4 { margin-top: 0 }
.guided-task textarea { margin: 12px 0; min-height: 76px }
@media (max-width: 580px) { .study-path { columns: 1 } }
`;
