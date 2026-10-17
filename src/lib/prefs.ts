const AUTO_ADD = 'slowtcg-autoadd'

/** "Add automatically when sure" for single-card scans. On unless turned off. */
export function getAutoAdd(): boolean {
  try {
    return localStorage.getItem(AUTO_ADD) !== 'off'
  } catch {
    return true
  }
}

export function setAutoAdd(on: boolean) {
  try {
    localStorage.setItem(AUTO_ADD, on ? 'on' : 'off')
  } catch {
    /* the choice just won't persist */
  }
}
