-- Allow signed-in users to delete solution requests (matches insert/update).
-- The app still gates the Delete button to admins, Chelsea, and the requester.

drop policy if exists "Allow delete solution_requests" on public.solution_requests;

create policy "Allow delete solution_requests"
  on public.solution_requests for delete to authenticated using (true);
