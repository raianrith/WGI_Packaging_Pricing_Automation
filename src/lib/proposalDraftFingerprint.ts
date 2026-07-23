import type { RoadmapProposalSnapshot } from "./roadmapProposalSnapshot";

/** Fingerprint for dirty detection — omits review handoff status. */
export function proposalSnapshotFingerprint(snapshot: RoadmapProposalSnapshot): string {
  const { reviewStatus: _reviewStatus, ...rest } = snapshot;
  return JSON.stringify(rest);
}
