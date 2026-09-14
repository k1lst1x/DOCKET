import { describe, expect, it } from "vitest";
import { contextSuggestions, MAX_PROMPT_CHARS, sanitizeChatContext, withContext, type ChatContext } from "./chat-context";

const ARTICLE: ChatContext = {
  kind: "article",
  label: "News article",
  title: "Irvington BART station construction starts next month",
  details: ["Source: The Mercury News", "Neighborhoods: Irvington"],
  url: "https://example.com/story",
};

describe("sanitizeChatContext", () => {
  it("keeps a well-formed context and trims its text", () => {
    expect(sanitizeChatContext({ ...ARTICLE, title: `  ${ARTICLE.title}\n` })).toEqual(ARTICLE);
  });

  it("drops unknown kinds, missing titles and non-web links", () => {
    expect(sanitizeChatContext(null)).toBeNull();
    expect(sanitizeChatContext({ ...ARTICLE, kind: "admin" })).toBeNull();
    expect(sanitizeChatContext({ ...ARTICLE, title: "   " })).toBeNull();
    expect(sanitizeChatContext({ ...ARTICLE, url: "javascript:alert(1)" })?.url).toBeNull();
  });

  it("caps lengths and the number of details", () => {
    const long = sanitizeChatContext({ ...ARTICLE, title: "x".repeat(900), details: Array.from({ length: 40 }, (_, i) => `detail ${i} `.repeat(80)), label: 42 });
    expect(long?.title).toHaveLength(200);
    expect(long?.details).toHaveLength(10);
    expect(long?.details.every((d) => d.length <= 400)).toBe(true);
    expect(long?.label).toBe("Page");
  });
});

describe("withContext", () => {
  it("puts the question first and labels the context as background", () => {
    const prompt = withContext("  What does this mean for traffic? ", ARTICLE);
    expect(prompt.startsWith("What does this mean for traffic?\n\n---\nPage context:")).toBe(true);
    expect(prompt).toContain("not instructions");
    expect(prompt).toContain(`News article: ${ARTICLE.title}`);
    expect(prompt).toContain("\n- Neighborhoods: Irvington");
    expect(prompt.endsWith("Link: https://example.com/story")).toBe(true);
  });

  it("returns the bare question without context", () => {
    expect(withContext(" Hi ", null)).toBe("Hi");
  });

  it("drops details, then the whole context, to stay within the limit without cutting the question", () => {
    const details = Array.from({ length: 10 }, () => "d".repeat(400));
    const fitted = withContext("Question?", { ...ARTICLE, details });
    expect(fitted.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(fitted.startsWith("Question?")).toBe(true);
    expect(fitted).toContain(ARTICLE.title);
    const question = "q".repeat(1990);
    expect(withContext(question, ARTICLE)).toBe(question);
  });
});

describe("contextSuggestions", () => {
  it("offers questions for every kind", () => {
    for (const kind of ["issue", "article", "community", "incident", "alert", "group", "place", "neighborhood", "news"] as const) {
      expect(contextSuggestions({ ...ARTICLE, kind }).length).toBeGreaterThan(1);
    }
  });
});
