import type { RoadmapProposalSnapshot } from "./roadmapProposalSnapshot";

export function proposalSnapshotFingerprint(snapshot: RoadmapProposalSnapshot): string {
  return JSON.stringify(snapshot);
}
