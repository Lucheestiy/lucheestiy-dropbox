export function isDropprDebugEnabled(): boolean {
  try {
    return /(?:^|[?&])dropprDebug=1(?:&|$)/.test(
      String(window.location && window.location.search) || ""
    );
  } catch (e) {
    return false;
  }
}
