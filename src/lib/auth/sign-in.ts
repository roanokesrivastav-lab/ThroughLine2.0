/** Keep return destinations within this app, including after email-link sign-in. */
export function signInDestination(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  return value;
}

export function signInError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not sign in. Please try again.";
  if (/fetch|network|load failed/i.test(message)) {
    return "Cannot reach the sign-in service. Check your connection and that your Supabase project is running, then try again.";
  }
  return message;
}
