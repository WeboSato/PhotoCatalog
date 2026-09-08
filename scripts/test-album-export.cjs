// Standalone Electron harness that exercises AlbumExportService end-to-end
// (sharp pre-resample -> offscreen decode-gated printToPDF) WITHOUT the UI.
// Run:  ./node_modules/.bin/electron scripts/test-album-export.cjs
const { app, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const MIME = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', tiff: 'image/tiff', tif: 'image/tiff' };

protocol.registerSchemesAsPrivileged([
    { scheme: 'local-image', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
]);

app.whenReady().then(async () => {
    protocol.handle('local-image', async (request) => {
        const raw = request.url.replace('local-image://', '');
        const filePath = raw.split('/').map(p => decodeURIComponent(p)).join('/');
        try {
            const stat = await fs.promises.stat(filePath);
            const ext = filePath.split('.').pop()?.toLowerCase();
            const webStream = Readable.toWeb(fs.createReadStream(filePath));
            return new Response(webStream, { status: 200, headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=3600', 'ETag': `"${stat.size}-${Math.round(stat.mtimeMs)}"` } });
        } catch (e) {
            return new Response('not found', { status: 404 });
        }
    });

    const { albumExportService } = require(path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'AlbumExportService.js'));

    // 3 real photos (originals are .psd/.NEF -> not sharp-decodable -> use previews).
    const photos = [
        { preview: '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/32/ce/32ceaaaf8adec7eb9ae229aee7301bb4.webp' },
        { preview: '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/73/1e/731e02278af6c4f9fa7993870c8f9a27.webp' },
        { preview: '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/5d/07/5d07b7fc72d7287b0966341d80eba8f8.webp' },
    ];

    const trimWmm = 3.937 * 25.4, trimHmm = 5.906 * 25.4;
    const spec = {
        pageFormat: '4x6', targetType: 'book',
        trimInW: 3.937, trimInH: 5.906, bleedMm: 3, dpi: 300, cropMarks: true, backgroundColor: '#ffffff',
        pages: photos.map((p, i) => ({
            index: i, kind: 'photo',
            slots: [{ sourcePath: p.preview, isRaw: true, slotWidthMm: trimWmm, slotHeightMm: trimHmm, rect: { x: 0, y: 0, w: 1, h: 1 } }],
        })),
    };

    const out = path.join(app.getPath('temp'), 'album-test.pdf');
    console.log('[test] exporting to', out);
    const t0 = Date.now();
    const result = await albumExportService.exportPdf(spec, out, p => console.log('[progress]', JSON.stringify(p)));
    console.log('[test] result:', JSON.stringify(result));
    console.log('[test] took', Date.now() - t0, 'ms');

    if (result.ok && fs.existsSync(out)) {
        const buf = fs.readFileSync(out);
        const header = buf.slice(0, 5).toString('latin1');
        console.log('[test] PDF size:', buf.length, 'bytes, header:', header, header === '%PDF-' ? 'VALID' : 'INVALID');
        // copy to scratchpad for inspection
        const dest = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/album-test.pdf';
        try { fs.copyFileSync(out, dest); console.log('[test] copied to', dest); } catch (e) { console.log('[test] copy failed', e.message); }
    } else {
        console.log('[test] EXPORT FAILED');
    }

    app.quit();
}).catch(e => { console.error('[test] fatal', e); app.quit(); });
