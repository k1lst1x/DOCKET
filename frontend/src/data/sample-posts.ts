// SAMPLE neighborhood posts for the home feed. Loaded into DSQL by scripts/dsql-seed.ts (authored
// by the sample members, is_sample = true) and shown read-only when the database or API isn't
// available. Authors are indexes into the 100 sample members the seed creates.
// No imports: the seed runs this file directly with Node's type stripping.

export interface SampleReply {
  author: number;
  minutesAfter: number;
  body: string;
}

export interface SamplePost {
  author: number;
  /** Neighborhood slug, or null for All of Fremont. */
  neighborhood: string | null;
  hoursAgo: number;
  body: string;
  likes: number;
  replies: SampleReply[];
}

export const samplePostId = (index: number) => `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`;
export const sampleReplyId = (index: number, reply: number) => `00000000-0000-4000-a000-${String(index * 10 + reply + 1).padStart(12, "0")}`;

export const SAMPLE_POSTS: SamplePost[] = [
  {
    author: 0,
    neighborhood: "niles",
    hoursAgo: 1,
    likes: 14,
    body: "Anyone else going to the HARB meeting Thursday about the Second Street bungalow? Written comments are due Sunday at 5. I'm asking them to keep the porch and roofline.",
    replies: [
      { author: 12, minutesAfter: 25, body: "I'll be there. The staff report says the rear addition really is failing, so keeping the facade might be the realistic ask." },
      { author: 30, minutesAfter: 50, body: "Sent my comment this morning. It took five minutes through the city's eComment page." },
    ],
  },
  {
    author: 41,
    neighborhood: "irvington",
    hoursAgo: 1.2,
    likes: 22,
    body: "Heads up: BART construction trucks start staging on Osgood Road next month. The traffic plan is on Tuesday's council agenda if you want to weigh in on school pickup hours.",
    replies: [{ author: 6, minutesAfter: 30, body: "Good catch. Blacow at 3pm is already rough, so please ask them to avoid pickup time." }],
  },
  {
    author: 7,
    neighborhood: null,
    hoursAgo: 2,
    likes: 31,
    body: "Red flag conditions are forecast for the hills this week. Worth clearing dry brush and checking your go-bag, especially up near Mission Peak.",
    replies: [{ author: 22, minutesAfter: 40, body: "AC Alert texts are a good way to get evacuation notices too. Takes a minute to sign up." }],
  },
  {
    author: 18,
    neighborhood: "centerville",
    hoursAgo: 3.5,
    likes: 18,
    body: "Tried the new bakery on Fremont Blvd near the depot. The pandan croissant alone is worth the parking hunt. What else should I try around Centerville?",
    replies: [
      { author: 3, minutesAfter: 20, body: "The egg tarts across from the train station, every time." },
      { author: 53, minutesAfter: 65, body: "The Saturday farmers market at the depot is back too." },
    ],
  },
  {
    author: 24,
    neighborhood: "warm-springs",
    hoursAgo: 5,
    likes: 9,
    body: "The streetlight on Warm Springs Blvd by the BART plaza entrance has been out for a week. I reported it in the city's 311 app. More reports usually get it fixed faster.",
    replies: [],
  },
  {
    author: 2,
    neighborhood: "mission-san-jose",
    hoursAgo: 7,
    likes: 40,
    body: "Lost dog near Ohlone College: small brown terrier mix named Biscuit, blue collar. Please message me if you see him. He's friendly but shy.",
    replies: [
      { author: 62, minutesAfter: 45, body: "Shared with the Mission Hills parents' chat. Hope he turns up soon." },
      { author: 17, minutesAfter: 120, body: "Saw a small brown dog near Palm Avenue about an hour ago, heading toward the school." },
    ],
  },
  {
    author: 11,
    neighborhood: "irvington",
    hoursAgo: 9,
    likes: 12,
    body: "The Five Corners farmers market moves to Sundays starting in October. Same spot, 9 to 1.",
    replies: [],
  },
  {
    author: 35,
    neighborhood: "glenmoor",
    hoursAgo: 11,
    likes: 16,
    body: "Kids' bike swap at the Glenmoor park this Saturday morning. Bring a bike they've outgrown, take one that fits.",
    replies: [],
  },
  {
    author: 50,
    neighborhood: "niles",
    hoursAgo: 14,
    likes: 11,
    body: "Niles Canyon Railway is running the evening train again this weekend. A great way to see the canyon if you've never done it.",
    replies: [],
  },
  {
    author: 28,
    neighborhood: null,
    hoursAgo: 18,
    likes: 25,
    body: "Reminder: public comment on the short-term rental ordinance update closes on the 24th. Whatever your view, the council does read these.",
    replies: [{ author: 87, minutesAfter: 60, body: "Posted mine. A cap seems fair to me, and the local-contact rule makes sense." }],
  },
  {
    author: 64,
    neighborhood: "ardenwood",
    hoursAgo: 22,
    likes: 19,
    body: "Coyote sighting on the Ardenwood trail near the historic farm around dusk. Keep small pets leashed out there.",
    replies: [],
  },
  {
    author: 15,
    neighborhood: "centerville",
    hoursAgo: 26,
    likes: 8,
    body: "Fremont Blvd lane changes: has anyone biked the new protected section yet? Curious how the loading zones work in practice.",
    replies: [{ author: 76, minutesAfter: 90, body: "Rode it yesterday. Smooth, but delivery vans still stop in the buffer near the shops." }],
  },
  {
    author: 44,
    neighborhood: "warm-springs",
    hoursAgo: 30,
    likes: 13,
    body: "The wildfire readiness workshop at the fire station was really useful. They're doing free home assessments if you sign up.",
    replies: [],
  },
  {
    author: 57,
    neighborhood: "mission-san-jose",
    hoursAgo: 36,
    likes: 27,
    body: "The crosswalk upgrades near the elementary school are a big yes from me. My kids cross Mission Blvd there every day.",
    replies: [],
  },
  {
    author: 71,
    neighborhood: "kimber-gomes",
    hoursAgo: 44,
    likes: 6,
    body: "Power flickered twice on Gomes Road tonight. The PG&E outage map shows a small outage east of Mission Blvd.",
    replies: [],
  },
  {
    author: 9,
    neighborhood: null,
    hoursAgo: 52,
    likes: 34,
    body: "Library tip: the Fremont Main Library lends free museum passes. We used one for The Tech Interactive last weekend.",
    replies: [],
  },
  {
    author: 33,
    neighborhood: "irvington",
    hoursAgo: 60,
    likes: 15,
    body: "Six-story apartments at Fremont and Washington: I'm for more housing near BART, but I want to see the parking and traffic numbers first.",
    replies: [{ author: 14, minutesAfter: 80, body: "Same. The traffic study should be in the planning commission packet." }],
  },
  {
    author: 80,
    neighborhood: "niles",
    hoursAgo: 70,
    likes: 21,
    body: "Found a set of keys with a Honda fob by the Niles Town Plaza gazebo. I left them with the coffee shop on Niles Blvd.",
    replies: [],
  },
];
