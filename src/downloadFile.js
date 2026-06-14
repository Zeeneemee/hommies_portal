// Force a real file download in the browser.
//
// The plain `<a href download>` trick is IGNORED by browsers when the href is
// cross-origin — and Convex storage URLs live on a different origin than the
// app, so on mobile the poster just opens in the viewer instead of saving.
// Fetching the file as a blob and downloading a same-origin object URL makes
// the `download` attribute work (incl. iOS Safari 13+ → Files app). Falls back
// to opening the URL in a new tab if the fetch is blocked.
export async function downloadFile(url, filename) {
  if (!url) return
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename || 'download'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}
