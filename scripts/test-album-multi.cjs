// Verifies the export handles MULTI-SLOT (grid) pages correctly.
const { app, protocol } = require('electron');
const path = require('path'); const fs = require('fs'); const { Readable } = require('stream');
const MIME = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
protocol.registerSchemesAsPrivileged([{ scheme: 'local-image', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }]);

app.whenReady().then(async () => {
    protocol.handle('local-image', async (req) => {
        const fp = req.url.replace('local-image://', '').split('/').map(p => decodeURIComponent(p)).join('/');
        try { const st = await fs.promises.stat(fp); return new Response(Readable.toWeb(fs.createReadStream(fp)), { status: 200, headers: { 'Content-Type': MIME[fp.split('.').pop().toLowerCase()] || 'application/octet-stream' } }); }
        catch { return new Response('nf', { status: 404 }); }
    });
    const { albumExportService } = require(path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'AlbumExportService.js'));
    const P = [
        '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/32/ce/32ceaaaf8adec7eb9ae229aee7301bb4.webp',
        '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/73/1e/731e02278af6c4f9fa7993870c8f9a27.webp',
        '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/thumbnails/previews/5d/07/5d07b7fc72d7287b0966341d80eba8f8.webp',
    ];
    const tW = 3.937 * 25.4, tH = 5.906 * 25.4;
    const slot = (src, r) => ({ sourcePath: src, isRaw: true, slotWidthMm: r.w * tW, slotHeightMm: r.h * tH, rect: r });
    const G = 0.02;
    const spec = {
        pageFormat: '4x6', targetType: 'book', trimInW: 3.937, trimInH: 5.906, bleedMm: 3, dpi: 300, cropMarks: false, backgroundColor: '#ffffff',
        pages: [
            { index: 0, kind: 'photo', slots: [slot(P[0], { x: 0, y: 0, w: 1, h: 1 })] },                       // full-bleed
            { index: 1, kind: 'photo', slots: [slot(P[0], { x: 0, y: 0, w: (1 - G) / 2, h: 1 }), slot(P[1], { x: (1 + G) / 2, y: 0, w: (1 - G) / 2, h: 1 })] }, // 2 cols
            { index: 2, kind: 'photo', slots: [                                                                  // 2x2
                slot(P[0], { x: 0, y: 0, w: (1 - G) / 2, h: (1 - G) / 2 }), slot(P[1], { x: (1 + G) / 2, y: 0, w: (1 - G) / 2, h: (1 - G) / 2 }),
                slot(P[2], { x: 0, y: (1 + G) / 2, w: (1 - G) / 2, h: (1 - G) / 2 }), slot(P[0], { x: (1 + G) / 2, y: (1 + G) / 2, w: (1 - G) / 2, h: (1 - G) / 2 }),
            ] },
        ],
    };
    const out = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/album-multi.pdf';
    const r = await albumExportService.exportPdf(spec, out, () => {});
    console.log('[multi-test] result:', JSON.stringify(r));
    if (r.ok && fs.existsSync(out)) { const b = fs.readFileSync(out); console.log('[multi-test] size', b.length, 'header', b.slice(0, 5).toString('latin1')); fs.copyFileSync(out, require('os').homedir() + '/Desktop/album-multi-test.pdf'); console.log('[multi-test] copied to Desktop'); }
    app.quit();
}).catch(e => { console.error('[multi-test] fatal', e); app.quit(); });
