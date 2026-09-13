// SAMPLE issue analyses and polls, written by hand in the shape the reading
// agent will produce (see supabase/migrations). Pros and cons mark whether a
// claim comes from the source document or is inference, per docs/architecture.md.

export interface Claim {
  text: string;
  basis: "source" | "inference";
  citation: string | null;
}

export interface IssueContent {
  itemId: string;
  location: { lat: number; lng: number; label: string };
  affectedRadiusM: number | null;
  neighborhoods: string[];
  summary: string;
  pros: Claim[];
  cons: Claim[];
  facts: { label: string; value: string }[];
  stanceQuestion: string;
  choicePolls: { id: string; question: string; options: { id: string; label: string }[] }[];
}

const ALL_FIVE = ["Niles", "Irvington", "Mission San Jose", "Centerville", "Warm Springs"];

export const ISSUE_CONTENT: IssueContent[] = [
  {
    itemId: "itm_niles_1",
    location: { lat: 37.57743, lng: -121.98114, label: "Second Street near Niles Blvd and G St" },
    affectedRadiusM: 400,
    neighborhoods: ["Niles"],
    summary:
      "The owner of a 1912 bungalow on Second Street is asking to demolish it and build two attached townhomes. The house is listed as a contributing building in the Niles historic overlay, so the Historical Architectural Review Board has to approve the demolition first.\n\nStaff recommend approval on the condition that the new building keeps the original porch, roofline and street-facing facade. Written comments received by the deadline go into the board's packet; comments at the meeting are limited to three minutes each.",
    pros: [
      { text: "Adds one net new home within walking distance of Niles Town Plaza and the train depot.", basis: "source", citation: "HARB packet, p. 16" },
      { text: "Staff conditions would keep the street-facing facade, porch and roofline.", basis: "source", citation: "HARB packet, p. 22" },
      { text: "The structural report describes the rear addition as unsound, so repairs would be costly for any owner.", basis: "source", citation: "HARB packet, pp. 31–34" },
    ],
    cons: [
      { text: "Removes a contributing building; each loss weakens the case for the district's historic status.", basis: "inference", citation: null },
      { text: "The townhomes are 9 feet taller than the neighboring cottages.", basis: "source", citation: "HARB packet, p. 19" },
      { text: "Approving this could set a precedent for similar requests on Second and Third Streets.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Built", value: "1912" },
      { label: "Proposed", value: "2 townhomes" },
      { label: "Height change", value: "+9 ft" },
      { label: "Packet pages", value: "28" },
    ],
    stanceQuestion: "Should the board approve the demolition with the facade conditions?",
    choicePolls: [
      {
        id: "niles-1-facade",
        question: "If it is approved, what matters most to keep?",
        options: [
          { id: "porch", label: "The front porch" },
          { id: "roofline", label: "The roofline and height" },
          { id: "materials", label: "Original materials and windows" },
          { id: "trees", label: "The street trees" },
        ],
      },
    ],
  },
  {
    itemId: "itm_niles_2",
    location: { lat: 37.578, lng: -121.979, label: "Niles Blvd between G St and J St" },
    affectedRadiusM: 600,
    neighborhoods: ["Niles"],
    summary:
      "A consent item would close Niles Boulevard between G and J Streets for the fall street fair on September 26 and 27. Consent items pass in one vote without discussion unless a councilmember or a member of the public asks for them to be pulled.\n\nThe traffic control plan detours through-traffic onto Second Street, a residential street, from 7 a.m. to 8 p.m. both days. Residents on the detour route would get door hangers a week ahead.",
    pros: [
      { text: "The fair brought an estimated 18,000 visitors to Niles businesses last year.", basis: "source", citation: "Council packet, p. 90" },
      { text: "The event organizer pays for traffic control and cleanup.", basis: "source", citation: "Council packet, p. 92" },
    ],
    cons: [
      { text: "Second Street carries the detour for 13 hours a day on both days.", basis: "source", citation: "Council packet, p. 95" },
      { text: "No residential parking permits are planned for the detour blocks.", basis: "source", citation: "Council packet, p. 96" },
      { text: "Emergency access to homes on the closed blocks depends on staffed barricades.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Closure", value: "2 days" },
      { label: "Hours", value: "7 a.m.–8 p.m." },
      { label: "Blocks closed", value: "3" },
      { label: "Visitors last year", value: "~18,000" },
    ],
    stanceQuestion: "Should council approve the street closure as planned?",
    choicePolls: [
      {
        id: "niles-2-detour",
        question: "Which change would make the detour work better?",
        options: [
          { id: "permits", label: "Residential parking permits" },
          { id: "shorter", label: "Shorter closure hours" },
          { id: "shuttle", label: "Shuttle from the train depot" },
          { id: "none", label: "No change needed" },
        ],
      },
    ],
  },
  {
    itemId: "itm_niles_3",
    location: { lat: 37.5485, lng: -121.9886, label: "Citywide" },
    affectedRadiusM: null,
    neighborhoods: ALL_FIVE,
    summary:
      "The Planning Commission is reviewing an update to Fremont's short-term rental rules. Whole-home rentals would be capped at one per owner, hosts would have to register a local contact who can respond within an hour, and the city could suspend a permit after three verified complaints in a year.\n\nThe commission makes a recommendation; City Council takes the final vote later this year.",
    pros: [
      { text: "A local contact requirement gives neighbors someone to call about noise or parking.", basis: "source", citation: "Planning Commission packet, p. 211" },
      { text: "A one-per-owner cap targets investors running several homes as rentals.", basis: "source", citation: "Planning Commission packet, p. 214" },
    ],
    cons: [
      { text: "Owners who rent out a second home to cover costs would have to choose one.", basis: "inference", citation: null },
      { text: "Enforcement relies on complaints, which puts the burden on neighbors.", basis: "source", citation: "Planning Commission packet, p. 238" },
    ],
    facts: [
      { label: "Registered rentals", value: "412" },
      { label: "Owners with 2+", value: "57" },
      { label: "Complaint limit", value: "3 per year" },
      { label: "Final vote", value: "City Council" },
    ],
    stanceQuestion: "Should the commission recommend the new short-term rental rules?",
    choicePolls: [
      {
        id: "niles-3-cap",
        question: "What cap on whole-home rentals feels right?",
        options: [
          { id: "one", label: "One per owner" },
          { id: "two", label: "Two per owner" },
          { id: "none", label: "No cap, just enforce rules" },
        ],
      },
    ],
  },
  {
    itemId: "itm_irvington_1",
    location: { lat: 37.53293, lng: -121.95909, label: "Fremont Blvd and Washington Blvd, Five Corners" },
    affectedRadiusM: 800,
    neighborhoods: ["Irvington"],
    summary:
      "A developer proposes a six-story building at Five Corners with 212 apartments above ground-floor shops. Staff recommend approval with 11 homes set aside as affordable to very-low-income households and a parking ratio of 0.8 spaces per home, lower than usual because the Irvington BART station will be a 10-minute walk.\n\nThe project also includes a public plaza on the corner and pays traffic impact fees toward signal upgrades on Washington Boulevard.",
    pros: [
      { text: "Adds 212 homes, including 11 for very-low-income households.", basis: "source", citation: "Planning Commission packet, p. 14" },
      { text: "Brings ground-floor shops and a public plaza to Five Corners.", basis: "source", citation: "Planning Commission packet, p. 22" },
      { text: "Places homes within a 10-minute walk of the future BART station.", basis: "source", citation: "Planning Commission packet, p. 31" },
    ],
    cons: [
      { text: "0.8 parking spaces per home could push cars onto nearby residential streets.", basis: "inference", citation: null },
      { text: "Six stories is taller than anything else currently at Five Corners.", basis: "source", citation: "Planning Commission packet, p. 40" },
      { text: "Construction would overlap with BART station work for about a year.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Homes", value: "212" },
      { label: "Affordable", value: "11" },
      { label: "Height", value: "6 stories" },
      { label: "Parking", value: "0.8 per home" },
    ],
    stanceQuestion: "Should the Planning Commission approve the Five Corners apartments?",
    choicePolls: [
      {
        id: "irvington-1-priority",
        question: "What should the group push for in its letter?",
        options: [
          { id: "affordable", label: "More affordable homes" },
          { id: "parking", label: "More parking" },
          { id: "height", label: "Lower height" },
          { id: "plaza", label: "A bigger public plaza" },
        ],
      },
    ],
  },
  {
    itemId: "itm_irvington_2",
    location: { lat: 37.527, lng: -121.9585, label: "Irvington BART site on Osgood Rd" },
    affectedRadiusM: 1200,
    neighborhoods: ["Irvington", "Mission San Jose"],
    summary:
      "Council will adopt the construction traffic plan for the Irvington BART station. Most haul trucks would use Osgood Road between Washington Boulevard and I-680, about 140 truck trips a day for 14 months. Night work would be allowed on up to 40 nights for track and utility connections.\n\nThe plan requires noise monitoring at three homes on Osgood Road and a hotline that answers around the clock.",
    pros: [
      { text: "Keeps haul trucks off residential streets west of Osgood Road.", basis: "source", citation: "Traffic study, p. 211" },
      { text: "Caps night work at 40 nights with advance notice to residents.", basis: "source", citation: "Traffic study, p. 226" },
    ],
    cons: [
      { text: "About 140 truck trips a day on Osgood Road for more than a year.", basis: "source", citation: "Traffic study, p. 214" },
      { text: "Night work on up to 40 nights could disturb homes near the tracks.", basis: "source", citation: "Traffic study, p. 226" },
      { text: "Morning school traffic on Blacow Road may back up at the Osgood intersection.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Truck trips", value: "~140/day" },
      { label: "Duration", value: "14 months" },
      { label: "Night work", value: "≤40 nights" },
      { label: "Noise monitors", value: "3" },
    ],
    stanceQuestion: "Should council adopt the construction traffic plan?",
    choicePolls: [
      {
        id: "irvington-2-mitigation",
        question: "Which safeguard matters most to you?",
        options: [
          { id: "school-hours", label: "No trucks during school drop-off" },
          { id: "night-cap", label: "Fewer night-work nights" },
          { id: "noise", label: "More noise monitoring" },
          { id: "cleaning", label: "Daily street cleaning" },
        ],
      },
    ],
  },
  {
    itemId: "itm_msj_1",
    location: { lat: 37.5355, lng: -121.912, label: "Hillside lot above Mission Blvd" },
    affectedRadiusM: 700,
    neighborhoods: ["Mission San Jose"],
    summary:
      "An owner wants to build a 6,800-square-foot house on a hillside lot with a 30% slope above Mission Boulevard, removing 18 coast live oaks. Under Fremont's Hillside Initiative, the commission must find that the house will not be prominently visible from Mission Boulevard and that grading is kept to a minimum.\n\nThe applicant offers to plant 54 replacement oaks and use earth-toned materials. Staff say the visibility finding can be made with a lower roofline.",
    pros: [
      { text: "54 replacement oaks would be planted, three for each one removed.", basis: "source", citation: "Planning Commission packet, p. 140" },
      { text: "Staff say a lower roofline would keep the house from being prominent from Mission Blvd.", basis: "source", citation: "Planning Commission packet, p. 162" },
    ],
    cons: [
      { text: "Replacement saplings take decades to match 18 mature oaks.", basis: "inference", citation: null },
      { text: "Grading on a 30% slope raises erosion risk for homes downhill.", basis: "inference", citation: null },
      { text: "The house would be twice the size of the average home on the street.", basis: "source", citation: "Planning Commission packet, p. 128" },
    ],
    facts: [
      { label: "Oaks removed", value: "18" },
      { label: "Replacements", value: "54" },
      { label: "Slope", value: "30%" },
      { label: "House size", value: "6,800 sq ft" },
    ],
    stanceQuestion: "Should the commission approve the hillside house?",
    choicePolls: [
      {
        id: "msj-1-condition",
        question: "Which condition should the group ask for?",
        options: [
          { id: "fewer-trees", label: "Remove fewer oaks" },
          { id: "smaller", label: "A smaller house" },
          { id: "roofline", label: "A lower roofline" },
          { id: "drainage", label: "A drainage and erosion plan" },
        ],
      },
    ],
  },
  {
    itemId: "itm_msj_2",
    location: { lat: 37.53341, lng: -121.92012, label: "Mission Blvd and Washington Blvd" },
    affectedRadiusM: 500,
    neighborhoods: ["Mission San Jose"],
    summary:
      "Council is asked to accept a $740,000 state Active Transportation grant for rapid flashing beacons at two Mission Boulevard crossings near the elementary school, and for a study of a road diet between Washington Boulevard and Pine Street.\n\nThe grant requires acceptance this month. The study would come back to council before any lanes change.",
    pros: [
      { text: "Flashing beacons at two crossings used by students walking to school.", basis: "source", citation: "Council staff report, p. 43" },
      { text: "The state grant covers the full cost; no local match is required.", basis: "source", citation: "Council staff report, p. 45" },
    ],
    cons: [
      { text: "A later road diet could slow commute traffic on Mission Blvd.", basis: "inference", citation: null },
      { text: "Beacons alone may not slow drivers without enforcement.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Grant", value: "$740,000" },
      { label: "Crossings", value: "2" },
      { label: "Local match", value: "$0" },
      { label: "Deadline", value: "This month" },
    ],
    stanceQuestion: "Should council accept the crosswalk grant?",
    choicePolls: [
      {
        id: "msj-2-study",
        question: "Should the road-diet study go ahead?",
        options: [
          { id: "yes", label: "Yes, study it" },
          { id: "beacons-only", label: "Beacons only, no study" },
          { id: "undecided", label: "Not sure yet" },
        ],
      },
    ],
  },
  {
    itemId: "itm_centerville_1",
    location: { lat: 37.55818, lng: -122.0068, label: "Fremont Blvd and Peralta Blvd" },
    affectedRadiusM: 900,
    neighborhoods: ["Centerville"],
    summary:
      "The final design for Centerville Complete Streets removes one travel lane in each direction on Fremont Boulevard through old Centerville. The space goes to protected bike lanes, wider sidewalks and 40 new street trees. Left-turn pockets stay at every signal.\n\nThe traffic study projects peak-hour travel time through the corridor rising by about 90 seconds.",
    pros: [
      { text: "Protected bike lanes and wider sidewalks through the Centerville business district.", basis: "source", citation: "Mobility Commission packet, p. 24" },
      { text: "40 new street trees and shorter crossings at five intersections.", basis: "source", citation: "Mobility Commission packet, p. 30" },
    ],
    cons: [
      { text: "Peak-hour travel time through the corridor rises by about 90 seconds.", basis: "source", citation: "Mobility Commission packet, p. 58" },
      { text: "Delivery trucks lose curbside loading on two blocks.", basis: "source", citation: "Mobility Commission packet, p. 62" },
      { text: "Cut-through traffic may shift onto Thornton Avenue.", basis: "inference", citation: null },
    ],
    facts: [
      { label: "Lanes removed", value: "1 each way" },
      { label: "New trees", value: "40" },
      { label: "Peak delay", value: "+90 s" },
      { label: "Crossings shortened", value: "5" },
    ],
    stanceQuestion: "Should council approve the Fremont Blvd lane changes?",
    choicePolls: [
      {
        id: "centerville-1-feature",
        question: "Which part matters most to you?",
        options: [
          { id: "bikes", label: "Protected bike lanes" },
          { id: "sidewalks", label: "Wider sidewalks" },
          { id: "trees", label: "Street trees" },
          { id: "traffic", label: "Keeping traffic moving" },
        ],
      },
    ],
  },
];
