/** Add actionable hints for known constraint errors. */
export function friendlyMutationMessage(message: string): string {
  if (
    /duplicate key/i.test(message) &&
    (/solutions_pkey/i.test(message) || /\bsolution_id\b/i.test(message))
  ) {
    return `${message} The chosen solution id (2-n) already exists—refresh Admin and retry, or inspect public.solutions for duplicate or overlapping ids outside the usual 2-1, 2-2 pattern.`;
  }
  if (
    /package_id/i.test(message) &&
    /not-null|null value in column/i.test(message)
  ) {
    return `${message} Package links live on public.package_solution_tiers (package_id + solution_tier_id), not on solutions. Ensure the migration supabase/package_solution_tiers.sql has been applied.`;
  }
  return message;
}
