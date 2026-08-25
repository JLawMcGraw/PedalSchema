const DEFAULT_AUTH_DESTINATION = '/dashboard';

/** Accept only an application-local path for post-authentication navigation. */
export function safeAuthDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_AUTH_DESTINATION;
  }

  try {
    const base = new URL('https://pedalschema.invalid');
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return DEFAULT_AUTH_DESTINATION;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}
