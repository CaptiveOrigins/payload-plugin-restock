/**
 * The try-out signs anyone in, so it may only ever run on the throwaway database `npm run dev`
 * starts: one MongoDB on 127.0.0.1, a port, a database name and options. No user name or password
 * (`127.0.0.1:x@example.com` reaches another host), no second host, no other address. Anything else
 * is refused.
 */
export function isThrowawayDatabase(url: unknown): url is string {
  return typeof url === 'string' && /^mongodb:\/\/127\.0\.0\.1:\d{1,5}(\/[\w-]*)?(\?[\w=&.-]*)?$/.test(url)
}
