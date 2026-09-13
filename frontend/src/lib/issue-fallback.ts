import { GROUP_SEEDS, ITEMS } from "@/data/fixtures";
import { ISSUE_CONTENT } from "@/data/issue-content";
import { sampleIssueId } from "./issue-ids";
import type { IssueDetail, IssueMarker } from "./issue-types";

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * When Aurora DSQL can't be reached (for example an expired AWS login), the issue
 * dialog still shows the saved sample content: summary, pros and cons, facts and
 * map. Votes, results and reviews live only in the database, so they are left
 * out and `live` is false; the dialog keeps retrying until the database is back.
 */
export function fallbackIssueDetail(issueId: string, signedIn: boolean): IssueDetail | null {
  const item = ITEMS.find((i) => sampleIssueId(i.ref) === issueId && (i.status === "watching" || i.status === "approved"));
  if (!item) return null;
  const content = ISSUE_CONTENT.find((c) => c.itemId === item.id);
  if (!content) return null;
  const group = GROUP_SEEDS.find((g) => g.slug === item.groupSlug) ?? null;

  return {
    id: issueId,
    ref: item.ref,
    title: item.title,
    body: item.body,
    topic: item.topic,
    status: item.status,
    meetingAt: item.meetingAt,
    deadline: item.deadline,
    deadlineKind: item.deadlineKind,
    citation: item.citation,
    sourceUrl: null,
    surfacedAt: item.surfacedAt,
    location: content.location,
    affectedRadiusM: content.affectedRadiusM,
    group: group ? { slug: group.slug, name: group.name } : null,
    neighborhoods: content.neighborhoods.map((name) => ({ slug: slugOf(name), name })),
    analysis: { summary: content.summary, pros: content.pros, cons: content.cons, facts: content.facts, model: null, generatedAt: null },
    polls: [
      { id: `${issueId}-stance`, question: content.stanceQuestion, kind: "stance", options: [], passes: 0, total: 0, myChoice: null },
    ],
    trend: [],
    byNeighborhood: [],
    reviewCount: 0,
    reviews: null,
    viewer: { signedIn, canVote: false, closed: Date.parse(item.deadline) < Date.now(), hasVoted: false, votingAs: null },
    sample: { issue: true, analysis: true, activity: false },
    live: false,
  };
}

/** Map pins for the saved sample issues, without vote totals, when the database or API isn't available. */
export function fallbackIssueMarkers(): IssueMarker[] {
  return ITEMS.flatMap((item) => {
    if (item.status !== "watching" && item.status !== "approved") return [];
    const content = ISSUE_CONTENT.find((c) => c.itemId === item.id);
    if (!content) return [];
    const group = GROUP_SEEDS.find((g) => g.slug === item.groupSlug) ?? null;
    const marker: IssueMarker = {
      id: sampleIssueId(item.ref),
      ref: item.ref,
      title: item.title,
      topic: item.topic,
      status: item.status,
      deadline: item.deadline,
      deadlineKind: item.deadlineKind,
      location: content.location,
      affectedRadiusM: content.affectedRadiusM,
      neighborhoods: content.neighborhoods.map(slugOf),
      group: group ? { slug: group.slug, name: group.name } : null,
      votes: null,
      sample: true,
    };
    return [marker];
  }).sort((a, b) => Date.parse(a.deadline ?? "") - Date.parse(b.deadline ?? ""));
}
