// Non-destructive crop: apply → thumbnails baked with crop; clear → full frame
// restored; original file NEVER touched. Scratch catalog only.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/crop-test';
const JPEG_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19/untitled.jpeg';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); ok ? pass++ : fail++; };

app.whenReady().then(async () => {
    const catalogDb = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/database/Database.js').default;
    const thumbnailService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ThumbnailService.js').default;
    const importService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ImportService.js').default;
    const sharp = require('/Volumes/Seagate 4T/PhotoCatalog/node_modules/sharp');

    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(path.join(BASE, 'photos'), { recursive: true });
    const src = path.join(BASE, 'photos', 'photo.jpeg');
    fs.copyFileSync(JPEG_SRC, src);
    const originalBytes = fs.statSync(src).size;

    catalogDb.initialize(path.join(BASE, 'catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));

    const imp = await importService.importFiles([src], { generateThumbnails: true, extractMetadata: true });
    const id = imp.importedIds[0];
    const before = catalogDb.getPhoto(id);
    const fullMeta = await sharp(before.thumbnail_path).metadata();
    const fullAspect = fullMeta.width / fullMeta.height;

    // Apply a square center crop (like the applyCrop IPC does)
    const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.5 };
    let ds = {}; try { ds = before.develop_settings ? JSON.parse(before.develop_settings) : {}; } catch {}
    ds.crop = crop;
    catalogDb.updatePhoto(id, { develop_settings: JSON.stringify(ds) });
    const t = await thumbnailService.generateThumbnails(before.file_path, { forceRegenerate: true, crop });
    check('vignettes régénérées avec crop', !!t);
    catalogDb.updatePhoto(id, { thumbnail_path: t.thumbnailPath, preview_path: t.previewPath, width: t.width, height: t.height });

    const cm = await sharp(t.thumbnailPath).metadata();
    const srcFullMeta = await sharp(src).metadata();
    const expectedAspect = (crop.w * srcFullMeta.width) / (crop.h * srcFullMeta.height);
    check('ratio de la vignette = ratio du crop', Math.abs(cm.width / cm.height - expectedAspect) < 0.03,
        `${cm.width}x${cm.height} (ratio ${(cm.width / cm.height).toFixed(2)}, attendu ${expectedAspect.toFixed(2)})`);
    check('dimensions en base = zone recadrée', catalogDb.getPhoto(id).width === t.width && t.width === Math.round(crop.w * srcFullMeta.width));
    check('fichier ORIGINAL jamais modifié', fs.statSync(src).size === originalBytes);

    // Regeneration WITHOUT passing crop (e.g. startup path) keeps the stored crop
    const t2 = await thumbnailService.generateThumbnails(before.file_path, { forceRegenerate: true });
    const cm2 = await sharp(t2.thumbnailPath).metadata();
    check('toute régénération conserve le crop stocké (auto-lookup)', Math.abs(cm2.width / cm2.height - expectedAspect) < 0.03);

    // Clear the crop → full frame back
    delete ds.crop;
    catalogDb.updatePhoto(id, { develop_settings: JSON.stringify(ds) });
    const t3 = await thumbnailService.generateThumbnails(before.file_path, { forceRegenerate: true, crop: null });
    const cm3 = await sharp(t3.thumbnailPath).metadata();
    check('retour arrière: image complète restaurée', Math.abs(cm3.width / cm3.height - fullAspect) < 0.03,
        `${cm3.width}x${cm3.height}`);
    check('fichier original toujours intact', fs.statSync(src).size === originalBytes);

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
