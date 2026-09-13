import { describe, expect, it } from "vitest";
import { ITEMS } from "../data/fixtures";
import { ISSUE_CONTENT } from "../data/issue-content";
import { SAMPLE_ACTIVITY } from "../data/sample-activity";
import { moderateText } from "./moderation";

const blocked = (text: string) => !moderateText(text).ok;

describe("moderateText blocks offensive language", () => {
  it.each([
    "This is shit",
    "what the fuck is this",
    "You bitch",
    "fucking ridiculous",
    "Bullshit.",
    "damn it",
    "what an asshole",
    "piss off",
    "you're a dick",
    "go to hell",
    "stfu",
    "wtf",
  ])("plain: %s", (text) => expect(blocked(text)).toBe(true));

  it.each([
    ["masked with asterisks", "f*ck this"],
    ["two asterisks", "f**k"],
    ["masked vowel", "sh*t plan"],
    ["hash mask", "s#it"],
    ["masked middle of a long word", "b***h"],
    ["masked short word", "c**t"],
    ["mixed masks", "f#@k"],
    ["leetspeak", "5h1t"],
    ["dollar signs", "a$$hole"],
    ["at sign", "@ss"],
    ["exclamation for i", "b!tch"],
    ["digit for i", "b1tch"],
    ["digits for letters", "n1gg3r"],
    ["leet with suffix", "sh1tty"],
    ["dots between letters", "f.u.c.k"],
    ["dashes between letters", "b-i-t-c-h"],
    ["underscores", "f_u_c_k"],
    ["spaced letters", "f u c k"],
    ["spaced with dots", "s. h. i. t."],
    ["split word", "fu ck"],
    ["split word with ending", "fu cking"],
    ["split compound", "as shole"],
    ["stretched letters", "fuuuuuck"],
    ["stretched short word", "asssss"],
    ["upper and mixed case", "MoThErFuCkEr"],
    ["full-width letters", "ｆｕｃｋ"],
    ["math bold letters", "𝐟𝐮𝐜𝐤"],
    ["circled letters", "ⓕⓤⓒⓚ"],
    ["regional indicator letters", "🇫🇺🇨🇰"],
    ["small caps", "ꜰᴜᴄᴋ"],
    ["zero-width space", "fu\u200Bck"],
    ["soft hyphen", "sh\u00ADit"],
    ["accents", "fúçk"],
    ["combining strike-through", "f̶u̶c̶k̶"],
    ["Cyrillic look-alike c", "fuсk"],
    ["Cyrillic look-alike i", "shіt"],
    ["Greek look-alike", "αss"],
    ["v for u", "fvck"],
    ["ph for f", "phuck"],
    ["k for ck", "fuk"],
    ["no vowels", "fck"],
    ["emoji inside", "sh💩t"],
    ["apostrophe mask", "f'ck"],
    ["wrapped in punctuation", "(ass)"],
    ["possessive", "shit's"],
    ["hyphenated", "hell-bent"],
    ["slur", "that faggot"],
    ["slur whole word", "spics"],
    ["Spanish", "pendejo"],
    ["Hindi", "bhenchod"],
    ["digit for the first letter", "4uck"],
    ["mask for the first letter", "*uck this"],
    ["hash for the first letter", "#hit"],
    ["mask for the last letter", "fuc*"],
    ["masks at both leetspeak and edge", "sh!*"],
    ["hash for the last letter of a long word", "b1tc#"],
    ["masked sensitive word", "s*x"],
    ["leetspeak sensitive word", "s3x"],
    ["dollar sign sensitive word", "$exy"],
    ["spaced sensitive word", "s e x"],
    ["zero for o", "p0rn"],
    ["at sign for a", "n@ked"],
    ["Cyrillic look-alike in a sensitive word", "ѕex"],
  ])("evasion: %s (%s)", (_label, text) => expect(blocked(text)).toBe(true));

  it.each(["kill yourself", "k1ll y0urself", "kys", "I'll kill you", "hope you die"])("threat: %s", (text) =>
    expect(blocked(text)).toBe(true),
  );

  it("reports the words as the writer typed them", () => {
    expect(moderateText("That plan is f*cking absurd").matches).toEqual(["f*cking"]);
    expect(moderateText("f u c k this").matches).toEqual(["f u c k"]);
    expect(moderateText("sh it").matches).toEqual(["sh it"]);
    expect(moderateText("The builder is a jack@ss.").matches).toEqual(["jack@ss"]);
  });
});

describe("moderateText allows everyday writing", () => {
  it.each([
    "Scunthorpe", "cocktail", "peacock", "Hancock", "Hitchcock", "cockpit", "shuttlecock", "assessment", "assistant",
    "classic", "compass", "passage", "Essex", "Sussex", "Assam", "bassoon", "embarrass", "harass", "title",
    "constitution", "petition", "document", "cucumber", "cumulative", "Cumberland", "Dickens", "Dickinson", "shell",
    "hello", "Hellenic", "Michelle", "analysis", "canal", "grape", "therapist", "scrap", "skyscraper", "crappie",
    "spicy", "spices", "raccoon", "coonhound", "tycoon", "cocoon", "homogeneous", "fire retardant", "Pakistan",
    "Japan", "Arsenal", "arsenic", "pussycat", "Puss in Boots", "computation", "reputation", "Fukuoka", "fuchsia",
    "Shih Tzu", "shiitake", "shitake mushrooms", "niggling", "niggardly", "sniggering", "Mitsubishi", "damnation",
    "bastardized", "prickly", "Dagobah", "whoever", "cook", "kook", "booby trap", "tit for tat", "push it",
    "this hit", "class clown", "he'll", "she'll", "we'll", "it'll", "who're", "don't", "can't",
    "a chink in the armor", "spick and span", "summa cum laude", "Homo sapiens", "Dick Van Dyke",
    "Dick's Sporting Goods", "Moby Dick", "Hell's Kitchen",
    "I-880", "455 Mission Blvd", "$5M", "10am", "4th of July", "(510) 555-0199", "39550 Liberty St.", "B2B", "e.g.",
    "who re-elected the mayor", "Warm Springs BART", "Lake Elizabeth", "Mission Peak",
    "the sex offender registry", "same-sex marriage", "sex education", "Nazi Germany", "rape kit backlog", "Li Shi.",
    "Is that Shi?", "Shi!", "#1 priority", "4th", "grapes", "Essex", "unisex", "sextant", "naked eye",
  ])("%s", (text) => expect(moderateText(text)).toEqual({ ok: true, matches: [] }));

  it("passes every sample review, summary, pro, con and title", () => {
    const texts = [
      ...Object.values(SAMPLE_ACTIVITY).flatMap((a) => a.reviews.map((r) => r.body)),
      ...ISSUE_CONTENT.flatMap((c) => [
        c.summary,
        c.stanceQuestion,
        c.location.label,
        ...c.pros.map((p) => p.text),
        ...c.cons.map((p) => p.text),
        ...c.facts.map((f) => `${f.label} ${f.value}`),
        ...c.choicePolls.flatMap((p) => [p.question, ...p.options.map((o) => o.label)]),
      ]),
      ...ITEMS.flatMap((i) => [i.title, i.body]),
    ];
    expect(texts.length).toBeGreaterThan(50);
    for (const text of texts) expect({ text, ...moderateText(text) }).toEqual({ text, ok: true, matches: [] });
  });

  it("checks a full-length review quickly", () => {
    const body = "Traffic on Mowry Avenue backs up past the BART station every weekday evening, and the plan doesn't fix it. ".repeat(19);
    const start = performance.now();
    expect(moderateText(body).ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
