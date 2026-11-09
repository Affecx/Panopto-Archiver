export function studySchema(user: string): Record<string, unknown> {
  let teaching = false;
  let ids: string[] = [];
  try {
    const request = JSON.parse(user);
    teaching = request.teaching === true;
    ids = (request.lecture_data as unknown[])
      .map((item) => (Array.isArray(item) ? item[0] : undefined))
      .filter((id): id is string => typeof id === "string");
  } catch {}
  const text = { type: "string" };
  const evidence = {
    type: "array",
    items:
      ids.length > 64
        ? { type: "string", pattern: "^E[1-9][0-9]*$" }
        : ids.length
          ? { type: "string", enum: ids }
          : text,
    minItems: 1,
    maxItems: 4,
  };
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  });
  return object({
    ...(teaching
      ? {
          lessons: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: object({
              title: text,
              explanation: text,
              walkthrough: text,
              misconception: text,
              question: text,
              answer: text,
              evidence,
              practice: object({
                goal: text,
                setup: text,
                hint: text,
                recallQuestion: text,
                recallAnswer: text,
              }),
            }),
          },
        }
      : {}),
    summary: text,
    takeaways: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: object({ text, evidence }),
    },
    examples: {
      type: "array",
      minItems: 1,
      maxItems: teaching ? 1 : 2,
      items: object({
        title: text,
        problem: text,
        steps: { type: "array", minItems: 1, maxItems: 8, items: text },
        answer: text,
        check: text,
        evidence,
      }),
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: teaching ? 1 : 5,
      items: text,
    },
  });
}
