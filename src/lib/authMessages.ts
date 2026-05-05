/** Map common Supabase Auth error text to friendlier copy for the UI. */
export function friendlyAuthMessage(message: string): string {
  const m = message.trim();
  const low = m.toLowerCase();
  if (/invalid login credentials|invalid email or password/i.test(m)) {
    return "We couldn’t sign you in with that email and password. Check for typos or reset your password.";
  }
  if (/user already registered|already been registered/i.test(low)) {
    return (
      "Supabase Auth already has this email (see Authentication → Users). " +
      "Removing a row from public.profiles doesn’t remove the login — delete the user there (or from auth.users), " +
      "or sign in instead."
    );
  }
  if (/password should be at least/i.test(low)) {
    return "Choose a stronger password (Supabase requires at least the minimum length shown in their message).";
  }
  if (/email rate limit|too many requests/i.test(low)) {
    return "Too many attempts — wait a moment and try again.";
  }
  if (/email not confirmed|confirm your email/i.test(low)) {
    return "Check your inbox and confirm your email before signing in.";
  }
  return m;
}
