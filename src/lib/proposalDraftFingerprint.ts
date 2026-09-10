import type { RoadmapProposalSnapshot } from "./roadmapProposalSnapshot";

/** Fingerprint for dirty detection — omits review handoff fields. */
export function proposalSnapshotFingerprint(snapshot: RoadmapProposalSnapshot): string {
  const { reviewStatus: _reviewStatus, opsReview: _opsReview, ...rest } = snapshot;
  return JSON.stringify(rest);
}
