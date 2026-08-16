import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import thumbnailService from '../../services/ThumbnailService';
import type { AlbumRenderSpec, AlbumRenderPage, AlbumProgress, AlbumExportResult } from '../../shared/albumTypes';

const MM_PER_IN = 25.4;

type ProgressFn = (p: AlbumProgress) => void;

/**
 * Renders an album to a print-ready PDF (or a 16:9 slideshow PDF) using Electron's
 * built-in webContents.printToPDF — sharp cannot emit PDF, and printToPDF is the
 * only dependency-free path.
 *
 * The invariant: every placed photo is pre-resampled with sharp to the EXACT pixel
 * count its printed slot needs at the target DPI, into a temp file, BEFORE Chromium
 * ever sees it. Full-resolution originals are never pushed into the renderer (that
 * would OOM and would also upscale-blur). resizeImage() bakes EXIF rotation and
 * refuses to enlarge, so sources that can't reach the target resolution are reported
 * honestly as warnings rather than silently upscaled.
 */
class AlbumExportService {
    private nextJob = 1;

    async exportPdf(spec: AlbumRenderSpec, savePath: string, onProgress?: ProgressFn): Promise<AlbumExportResult> {
        return this.render(spec, savePath, false, onProgress);
    }

    async exportSlideshow(spec: AlbumRenderSpec, savePath: string, onProgress?: ProgressFn): Promise<AlbumExportResult> {
        return this.render(spec, savePath, true, onProgress);
    }

    private async render(spec: AlbumRenderSpec, savePath: string, slideshow: boolean, onProgress?: ProgressFn): Promise<AlbumExportResult> {
        const jobId = `${Date.now()}-${this.nextJob++}`;
        const tempDir = path.join(app.getPath('temp'), 'album-export', jobId);
        fs.mkdirSync(tempDir, { recursive: true });
        const warnings: string[] = [];

        try {
            const bleedMm = slideshow ? 0 : (spec.bleedMm || 0);
            const dpi = slideshow ? 96 : (spec.dpi || 300);

            // Count slots for progress.
            const totalSlots = spec.pages.reduce((n, pg) => n + pg.slots.length, 0);
            let done = 0;

            // ---- Stage 1: pre-resample every slot to exact print pixels ----
            // resampled[pageIndex][slotIndex] = temp file path (or '' if it failed)
            const resampled: string[][] = [];
            for (const page of spec.pages) {
                const row: string[] = [];
                for (let s = 0; s < page.slots.length; s++) {
                    const slot = page.slots[s];
                    const targetW = Math.max(1, Math.ceil((slot.slotWidthMm / MM_PER_IN) * dpi * 1.1));
                    const targetH = Math.max(1, Math.ceil((slot.slotHeightMm / MM_PER_IN) * dpi * 1.1));
                    const out = path.join(tempDir, `p${page.index}_s${s}.jpg`);

                    try {
                        // Honesty gate: does the source have enough real pixels?
                        try {
                            const meta = await sharp(slot.sourcePath).metadata();
                            const srcLong = Math.max(meta.width || 0, meta.height || 0);
                            const targetLong = Math.max(targetW, targetH);
                            if (srcLong > 0 && srcLong < targetLong * 0.9) {
                                warnings.push(`${path.basename(slot.sourcePath)} : source ${srcLong}px, imprimé à ~${Math.round(srcLong / (Math.max(slot.slotWidthMm, slot.slotHeightMm) / MM_PER_IN))} DPI (sous ${dpi}).`);
                            }
                        } catch { /* metadata read failed — resize will still try */ }

                        await thumbnailService.resizeImage(slot.sourcePath, out, {
                            width: targetW,
                            height: targetH,
                            fit: slideshow ? 'inside' : 'cover',
                            quality: 92,
                            format: 'jpeg'
                        });
                        row.push(out);
                    } catch (e) {
                        warnings.push(`Impossible de traiter ${path.basename(slot.sourcePath)}.`);
                        row.push('');
                    }
                    done++;
                    onProgress?.({ phase: 'resample', current: done, total: totalSlots });
                }
                resampled.push(row);
            }

            // ---- Stage 2: build print HTML ----
            onProgress?.({ phase: 'render' });
            const html = this.buildHtml(spec, resampled, slideshow, bleedMm);
            const htmlPath = path.join(tempDir, 'album.html');
            fs.writeFileSync(htmlPath, html, 'utf-8');

            // ---- Stage 3: offscreen render, gate on image decode, then printToPDF ----
            const win = new BrowserWindow({
                show: false,
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    webSecurity: true,
                    offscreen: true
                }
            });

            try {
                await win.loadFile(htmlPath);
                await this.waitForImages(win, totalSlots);

                const pageWIn = (slideshow ? spec.trimInW : spec.trimInW) + (bleedMm * 2) / MM_PER_IN;
                const pageHIn = (slideshow ? spec.trimInH : spec.trimInH) + (bleedMm * 2) / MM_PER_IN;

                const pdf = await win.webContents.printToPDF({
                    margins: { top: 0, bottom: 0, left: 0, right: 0 },
                    printBackground: true,
                    preferCSSPageSize: true,
                    landscape: slideshow,
                    pageSize: { width: pageWIn, height: pageHIn } // inches; fallback if CSS @page is ignored
                });

                onProgress?.({ phase: 'write' });
                fs.writeFileSync(savePath, pdf);
            } finally {
                win.destroy();
            }

            onProgress?.({ phase: 'done' });
            return { ok: true, path: savePath, warnings };
        } catch (e: any) {
            return { ok: false, error: e?.message || String(e), warnings };
        } finally {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    /** Poll the offscreen page until every image has decoded (or a timeout). */
    private async waitForImages(win: BrowserWindow, expected: number): Promise<void> {
        const deadline = Date.now() + 30000;
        // The page sets window.__albumReady once all <img> have decoded.
        while (Date.now() < deadline) {
            const ready = await win.webContents.executeJavaScript('window.__albumReady === true').catch(() => false);
            if (ready) return;
            await new Promise(r => setTimeout(r, 120));
        }
        // Timed out — proceed anyway (some images may be blank), better than hanging.
    }

    private mmToCss(mm: number): string {
        return `${mm.toFixed(3)}mm`;
    }

    private buildHtml(spec: AlbumRenderSpec, resampled: string[][], slideshow: boolean, bleedMm: number): string {
        const trimWmm = spec.trimInW * MM_PER_IN;
        const trimHmm = spec.trimInH * MM_PER_IN;
        const pageWmm = trimWmm + bleedMm * 2;
        const pageHmm = trimHmm + bleedMm * 2;
        const bg = spec.backgroundColor || '#ffffff';

        const encode = (p: string) => p.split('/').map(part => encodeURIComponent(part)).join('/');

        const pagesHtml = spec.pages.map((page: AlbumRenderPage, pi) => {
            const slotsHtml = page.slots.map((slot, si) => {
                const file = resampled[pi]?.[si];
                if (!file) return '';
                const r = slot.rect;
                // Map the 0..1 rect (within trim) to mm, offset by the bleed margin.
                // Edge-touching sides extend into the bleed so the image runs off the cut.
                let left = bleedMm + r.x * trimWmm;
                let top = bleedMm + r.y * trimHmm;
                let w = r.w * trimWmm;
                let h = r.h * trimHmm;
                if (!slideshow && bleedMm > 0) {
                    if (r.x <= 0.0001) { left = 0; w += bleedMm; }
                    if (r.y <= 0.0001) { top = 0; h += bleedMm; }
                    if (r.x + r.w >= 0.9999) { w += bleedMm; }
                    if (r.y + r.h >= 0.9999) { h += bleedMm; }
                }
                // Full-bleed single-photo pages: "contain" shows portrait AND landscape
                // photos in full (portrait fills, landscape letterboxes) instead of cropping.
                const fit = (slideshow || page.slots.length === 1) ? 'contain' : 'cover';
                const c = slot.cropData || {};
                const transform = (c.scale || c.offsetX || c.offsetY)
                    ? `transform:translate(${(c.offsetX || 0) * 100}%, ${(c.offsetY || 0) * 100}%) scale(${c.scale || 1});`
                    : '';
                const objectPosition = (c.focalX != null || c.focalY != null)
                    ? `object-position:${(c.focalX ?? 0.5) * 100}% ${(c.focalY ?? 0.5) * 100}%;`
                    : '';
                return `<div class="slot" style="left:${this.mmToCss(left)};top:${this.mmToCss(top)};width:${this.mmToCss(w)};height:${this.mmToCss(h)};">
                    <img src="local-image://${encode(file)}" style="object-fit:${fit};${objectPosition}${transform}"/>
                </div>`;
            }).join('');

            const cropMarks = (!slideshow && spec.cropMarks && bleedMm > 0) ? this.cropMarksSvg(pageWmm, pageHmm, bleedMm) : '';
            return `<div class="page">${slotsHtml}${cropMarks}</div>`;
        }).join('');

        return `<!doctype html><html><head><meta charset="utf-8"/><style>
            @page { size: ${this.mmToCss(pageWmm)} ${this.mmToCss(pageHmm)}; margin: 0; }
            * { margin:0; padding:0; box-sizing:border-box; }
            html,body { background:${bg}; }
            .page { position:relative; width:${this.mmToCss(pageWmm)}; height:${this.mmToCss(pageHmm)}; background:${bg}; overflow:hidden; page-break-after:always; break-after:page; }
            .page:last-child { page-break-after:auto; }
            .slot { position:absolute; overflow:hidden; }
            .slot img { width:100%; height:100%; display:block; }
        </style></head><body>
            ${pagesHtml}
            <script>
                window.__albumReady = false;
                (async () => {
                    const imgs = Array.from(document.images);
                    try { await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(()=>{}) : Promise.resolve()))); } catch (e) {}
                    // give layout one more frame
                    requestAnimationFrame(() => requestAnimationFrame(() => { window.__albumReady = true; }));
                })();
            </script>
        </body></html>`;
    }

    private cropMarksSvg(pageWmm: number, pageHmm: number, bleedMm: number): string {
        const L = bleedMm; // mark length = bleed
        const lines: string[] = [];
        const stroke = `stroke="#000" stroke-width="0.2"`;
        // four corners, at the trim box (bleedMm in from each edge)
        const corners = [
            [bleedMm, bleedMm], [pageWmm - bleedMm, bleedMm],
            [bleedMm, pageHmm - bleedMm], [pageWmm - bleedMm, pageHmm - bleedMm]
        ];
        for (const [x, y] of corners) {
            const hx1 = x < pageWmm / 2 ? x - L : x + L;
            const vy1 = y < pageHmm / 2 ? y - L : y + L;
            lines.push(`<line x1="${hx1}" y1="${y}" x2="${x}" y2="${y}" ${stroke}/>`);
            lines.push(`<line x1="${x}" y1="${vy1}" x2="${x}" y2="${y}" ${stroke}/>`);
        }
        return `<svg style="position:absolute;left:0;top:0;pointer-events:none;" width="${pageWmm}mm" height="${pageHmm}mm" viewBox="0 0 ${pageWmm} ${pageHmm}">${lines.join('')}</svg>`;
    }
}

export const albumExportService = new AlbumExportService();
export default albumExportService;
