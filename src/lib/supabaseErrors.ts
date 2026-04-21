/** Add actionable hints for known constraint errors. */
export function friendlyMutationMessage(message: string): string {
  if (
    /package_id/i.test(message) &&
    /not-null|null value in column/i.test(message)
  ) {
    return `${message} To allow standalone solutions, run this in Supabase → SQL Editor: alter table public.solutions alter column package_id drop not null; then: notify pgrst, 'reload schema'; (full script: supabase/solutions_package_optional.sql).`;
  }
  return message;
}
