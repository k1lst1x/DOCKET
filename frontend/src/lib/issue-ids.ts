/** Sample issues are stored under "sample-<official ref>" so they never collide with real ones. */
export const sampleIssueId = (ref: string) =>
  `sample-${ref.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
