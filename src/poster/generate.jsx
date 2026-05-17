import React from 'react'
import { createRoot } from 'react-dom/client'
import Poster from '../components/Poster.jsx'

// Renders <Poster> off-screen, captures EACH <PageFrame> as its own canvas
// via html2canvas, then assembles them into a single multi-page PDF with
// jsPDF — one PDF page per source PageFrame, no auto-pagination on top of
// our explicit breaks. This is the only reliable way to avoid the blank-
// page bug that html2pdf hits when CSS page-breaks and canvas tiling fight.
//
// Sequence:
//   1. createRoot off-screen → render <Poster>
//   2. wait two RAFs + every <img> to settle
//   3. for each div[data-poster-page]: html2canvas → jsPDF.addImage
//   4. jsPDF.output('blob') → return
//   5. unmount + remove container in finally

function slugify(name) {
  return String(name || 'property')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'property'
}

export async function renderPosterToBlob(property, content, primaryUni = 'NUS') {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText = 'position:absolute; left:-99999px; top:0; pointer-events:none;'
  document.body.appendChild(container)

  const root = createRoot(container)

  try {
    root.render(<Poster property={property} content={content} primaryUni={primaryUni} />)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const imgs = container.querySelectorAll('img')
    await Promise.all(
      Array.from(imgs).map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener('load', res, { once: true })
              img.addEventListener('error', res, { once: true })
            }),
      ),
    )

    const pageNodes = container.querySelectorAll('[data-poster-page]')
    if (pageNodes.length === 0) throw new Error('Poster rendered no pages')

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
    // A4 in mm
    const PAGE_W_MM = 210
    const PAGE_H_MM = 297

    for (let i = 0; i < pageNodes.length; i++) {
      const pageNode = pageNodes[i]
      const canvas = await html2canvas(pageNode, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.85)
      if (i > 0) pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W_MM, PAGE_H_MM, undefined, 'FAST')

      // html2canvas rasterizes every <a> into pixels — links lose their
      // clickability. Re-add them as PDF link annotations on top of the
      // image. We measure each anchor's rect relative to the page node and
      // map px → mm before calling pdf.link().
      const pageRect = pageNode.getBoundingClientRect()
      const anchors = pageNode.querySelectorAll('a[href]')
      for (const a of anchors) {
        const href = a.getAttribute('href')
        if (!href || !/^https?:\/\//i.test(href)) continue
        const r = a.getBoundingClientRect()
        const x = ((r.left - pageRect.left) / pageRect.width) * PAGE_W_MM
        const y = ((r.top - pageRect.top) / pageRect.height) * PAGE_H_MM
        const w = (r.width / pageRect.width) * PAGE_W_MM
        const h = (r.height / pageRect.height) * PAGE_H_MM
        if (w <= 0 || h <= 0) continue
        pdf.link(x, y, w, h, { url: href })
      }
    }

    const blob = pdf.output('blob')
    const filename = `${slugify(property.condo)}-poster.pdf`
    return { blob, filename }
  } finally {
    try {
      root.unmount()
    } catch {
      // ignore double-unmount on hot reload
    }
    container.remove()
  }
}
