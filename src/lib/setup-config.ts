/** True for requests whose Host is the local machine (no LAN / no deployment). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  // IPv6 hosts arrive bracketed ("[::1]:3000") - the address is inside the
  // brackets and contains colons, so it can't be split on ":" like IPv4.
  const bare = h.startsWith("[") && h.includes("]")
    ? h.slice(1, h.indexOf("]"))
    : h.split(":")[0];
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}
