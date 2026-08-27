export const MIX_LINK_ERROR = 'Enter a valid http:// or https:// URL, or leave Mix Link blank.'

/** Keep shared/private-link query strings intact; never fetch or embed the URL. */
export function normalizeMixUrl(value?: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  try {
    if (!/^https?:\/\/[^/]/i.test(trimmed) || /[\s\u0000-\u001f\u007f\\]/.test(trimmed)) throw new Error()
    const url = new URL(trimmed)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error()
    return trimmed
  } catch {
    throw new Error(MIX_LINK_ERROR)
  }
}

/** Stored values are checked too, so an invalid legacy/API value is never clickable. */
export function mixLinkDetails(value?: string | null): { url: string; hostname: string } | null {
  try {
    const url = normalizeMixUrl(value)
    return url ? { url, hostname: new URL(url).hostname } : null
  } catch {
    return null
  }
}
