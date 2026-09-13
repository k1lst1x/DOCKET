// Chart colors, checked with the dataviz palette validator on a white surface:
// support/oppose pass colorblind separation (CVD ΔE 24.7). "Pass" is a neutral
// gray, never a series hue. Ratings use one blue ramp, light (1) to dark (5).

export const VOTE_COLORS = {
  support: "#2a78d6",
  oppose: "#eb6834",
  pass: "#b9b7ae",
} as const;

export const RATING_RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"] as const;

export const CHART_INK = {
  grid: "#E6E8EB",
  track: "#EEF1F4",
  axis: "#5F6368",
} as const;
