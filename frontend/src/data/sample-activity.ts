// SAMPLE community activity for the demo issues: how sample neighbors lean,
// how many take part, how they answer follow-up polls, and a few reviews.
// Loaded into DSQL by scripts/dsql-seed.ts, marked is_sample on every member.

export interface SampleReview {
  stance: "support" | "oppose" | "pass";
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
}

export interface SampleActivity {
  /** Share of voters who support, among those who don't pass. */
  support: number;
  passRate: number;
  turnout: number;
  /** Weights per option, in poll option order, keyed by choice poll id. */
  choiceWeights: Record<string, number[]>;
  reviews: SampleReview[];
}

export const SAMPLE_ACTIVITY: Record<string, SampleActivity> = {
  itm_niles_1: {
    support: 0.38,
    passRate: 0.1,
    turnout: 0.8,
    choiceWeights: { "niles-1-facade": [3, 5, 2, 2] },
    reviews: [
      { stance: "oppose", rating: 2, body: "Second Street has already lost two cottages in ten years. Keeping a facade is not the same as keeping the house." },
      { stance: "support", rating: 4, body: "The rear addition really is falling apart. Two homes near the depot beats a boarded-up lot, as long as the porch stays." },
      { stance: "pass", rating: 3, body: "I went to the site visit. I'd like to see the elevation drawings before I pick a side." },
    ],
  },
  itm_niles_2: {
    support: 0.64,
    passRate: 0.06,
    turnout: 0.75,
    choiceWeights: { "niles-2-detour": [6, 2, 3, 2] },
    reviews: [
      { stance: "support", rating: 5, body: "The fair is the best weekend of the year for the shops on Niles Boulevard. Two days of detours is worth it." },
      { stance: "oppose", rating: 2, body: "I live on the detour route. Thirteen hours of through-traffic on both days, with no parking permits, is a lot to ask." },
      { stance: "support", rating: 4, body: "Fine with the closure, but please add residential parking permits for Second Street." },
    ],
  },
  itm_niles_3: {
    support: 0.55,
    passRate: 0.15,
    turnout: 0.7,
    choiceWeights: { "niles-3-cap": [5, 2, 2] },
    reviews: [
      { stance: "support", rating: 4, body: "The house next to ours turns over every weekend. A local contact who actually answers would change everything." },
      { stance: "oppose", rating: 2, body: "We rent my late parents' home part-time to cover the taxes. Complaint-only enforcement invites neighbor feuds." },
      { stance: "pass", rating: 3, body: "Sounds reasonable, but I want to know how many complaints the city actually gets today." },
    ],
  },
  itm_irvington_1: {
    support: 0.58,
    passRate: 0.08,
    turnout: 0.85,
    choiceWeights: { "irvington-1-priority": [5, 4, 2, 3] },
    reviews: [
      { stance: "support", rating: 5, body: "Five Corners needs people living there to keep the shops open. Eleven affordable homes is a real start." },
      { stance: "oppose", rating: 2, body: "0.8 parking spaces per home on streets that already fill up after 6 p.m. will push cars onto Bay Street." },
      { stance: "support", rating: 4, body: "Support, but the plaza should be bigger than the small corner shown in the plans." },
    ],
  },
  itm_irvington_2: {
    support: 0.35,
    passRate: 0.12,
    turnout: 0.8,
    choiceWeights: { "irvington-2-mitigation": [7, 3, 2, 2] },
    reviews: [
      { stance: "oppose", rating: 1, body: "140 trucks a day on Osgood for fourteen months, right along the walk to school. There has to be a second route." },
      { stance: "support", rating: 3, body: "The station matters for the whole neighborhood. The noise monitors and the hotline are more than I expected." },
      { stance: "oppose", rating: 2, body: "Forty nights of night work is too many for homes that back onto the tracks." },
    ],
  },
  itm_msj_1: {
    support: 0.22,
    passRate: 0.1,
    turnout: 0.8,
    choiceWeights: { "msj-1-condition": [6, 3, 2, 4] },
    reviews: [
      { stance: "oppose", rating: 1, body: "Eighteen mature oaks can't be replaced by saplings in our lifetime." },
      { stance: "oppose", rating: 2, body: "The Hillside Initiative exists for exactly this kind of slope. A lower roofline doesn't fix the grading." },
      { stance: "support", rating: 3, body: "Three new trees for every one removed is generous. If the house sits lower, I could live with it." },
    ],
  },
  itm_msj_2: {
    support: 0.82,
    passRate: 0.05,
    turnout: 0.7,
    choiceWeights: { "msj-2-study": [5, 3, 2] },
    reviews: [
      { stance: "support", rating: 5, body: "My kids cross Mission every morning. Free beacons are an easy yes." },
      { stance: "support", rating: 4, body: "Take the grant. Study the road diet separately and let us weigh in before any lanes change." },
      { stance: "oppose", rating: 2, body: "Beacons without enforcement won't slow anyone down on Mission." },
    ],
  },
  itm_centerville_1: {
    support: 0.6,
    passRate: 0.08,
    turnout: 0.8,
    choiceWeights: { "centerville-1-feature": [3, 4, 2, 3] },
    reviews: [
      { stance: "support", rating: 5, body: "Wider sidewalks through old Centerville would finally make it a place to walk." },
      { stance: "oppose", rating: 2, body: "Ninety extra seconds at rush hour will send traffic down Thornton Avenue." },
      { stance: "support", rating: 4, body: "The protected bike lanes are overdue, but keep loading zones for the shops." },
    ],
  },
};

export const SAMPLE_FIRST_NAMES = [
  "Priya", "Marcus", "Elena", "David", "Aisha", "Tom", "Mei", "Carlos", "Nadia", "Ben",
  "Grace", "Omar", "Lucia", "Kevin", "Fatima", "Sam", "Hana", "Luis", "Rachel", "Arjun",
];
export const SAMPLE_LAST_INITIALS = "ABCDEFGHJKLMNPRSTVWY".split("");
