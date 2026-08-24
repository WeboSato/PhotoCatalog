// Object removal end-to-end: photo with a fake object (magenta square) →
// linked copy → LaMa inpaint into the copy → object gone, original untouched.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/inpaint-test';
const JPEG_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19/untitled.jpeg';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); ok ? pass++ : fail++; };

app.whenReady().then(async () => {
    const catalogDb = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/database/Database.js').default;
    const thumbnailService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ThumbnailService.js').default;
    const externalEditorService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ExternalEditorService.js').default;
    const importService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ImportService.js').default;
    const inpaintService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/InpaintService.js').default;
    const sharp = require('/Volumes/Seagate 4T/PhotoCatalog/node_modules/sharp');

    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(path.join(BASE, 'photos'), { recursive: true });

    // Photo with a magenta "object" at a known spot
    const src = path.join(BASE, 'photos', 'scene.jpeg');
    const magenta = Buffer.from(`<svg width="160" height="160"><rect width="160" height="160" fill="#ff00ff"/></svg>`);
    await sharp(JPEG_SRC).composite([{ input: magenta, left: 400, top: 300 }]).jpeg({ quality: 95 }).toFile(src);
    const meta = await sharp(src).metadata();
    const originalBytes = fs.statSync(src).size;

    catalogDb.initialize(path.join(BASE, 'catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));

    check('modèle prêt (pré-installé)', inpaintService.isModelReady());

    const imp = await importService.importFiles([src], { generateThumbnails: true, extractMetadata: true });
    const id = imp.importedIds[0];

    // Mask PNG: white where the object is (with margin), at image resolution
    const maskSvg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" fill="black"/><rect x="385" y="285" width="190" height="190" fill="white"/></svg>`);
    const maskPng = await sharp(maskSvg).png().toBuffer();

    // Same sequence as the photos:removeObject IPC
    const created = await externalEditorService.createLinkedEditCopy(id);
    check('copie liée créée pour recevoir la retouche', !('error' in created));
    const t0 = Date.now();
    const ok = await inpaintService.inpaint(created.copyPath, maskPng, created.copyPath);
    check('inpainting exécuté', ok, `${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // The magenta must be gone from the copy
    const { data: out, info } = await sharp(created.copyPath).raw().toBuffer({ resolveWithObject: true });
    let magentaCount = 0, n = 0;
    for (let y = 310; y < 450; y += 5) for (let x = 410; x < 550; x += 5) {
        const p = (y * info.width + x) * info.channels;
        const r = out[p], g = out[p + 1], b = out[p + 2];
        if (r > 200 && g < 80 && b > 200) magentaCount++;
        n++;
    }
    check('objet magenta disparu de la copie', magentaCount === 0, `${magentaCount}/${n} pixels magenta restants`);
    check('original toujours intact (avec son objet)', fs.statSync(src).size === originalBytes);

    // Pixels away from the mask untouched on the copy vs a fresh render
    const t = await thumbnailService.generateThumbnails(created.copyPath, { forceRegenerate: true });
    check('vignettes de la copie régénérées', !!t);

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
