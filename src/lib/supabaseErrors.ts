/** Add actionable hints for known constraint errors. */
export function friendlyMutationMessage(message: string): string {
  if (
    /package_id/i.test(message) &&
    /not-null|null value in column/i.test(message)
  ) {
    return `${message} Package links live on public.package_solution_tiers (package_id + solution_tier_id), not on solutions. Ensure the migration supabase/package_solution_tiers.sql has been applied.`;
  }
  return message;
}
