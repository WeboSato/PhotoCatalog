// Grey-card calibration: a photo with a known colour cast gets corrected back
// to (near) the original colours, sync copies the calibration, reset restores.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/wb-test';
const JPEG_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19/untitled.jpeg';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); ok ? pass++ : fail++; };
const avg = async (sharp, file) => {
    const { data, info } = await sharp(file).resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0, n = info.width * info.height;
    for (let i = 0; i < n; i++) { r += data[i * info.channels]; g += data[i * info.channels + 1]; b += data[i * info.channels + 2]; }
    return { r: r / n, g: g / n, b: b / n };
};

app.whenReady().then(async () => {
    const catalogDb = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/database/Database.js').default;
    const thumbnailService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ThumbnailService.js').default;
    const importService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ImportService.js').default;
    const sharp = require('/Volumes/Seagate 4T/PhotoCatalog/node_modules/sharp');

    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(path.join(BASE, 'photos'), { recursive: true });

    // Two photos with a strong warm cast (R×1.35, B×0.72) — like bad indoor WB
    const neutral = path.join(BASE, 'neutral.jpeg');
    fs.copyFileSync(JPEG_SRC, neutral);
    const castA = path.join(BASE, 'photos', 'castA.jpeg');
    const castB = path.join(BASE, 'photos', 'castB.jpeg');
    await sharp(JPEG_SRC).linear([1.35, 1, 0.72], [0, 0, 0]).jpeg({ quality: 95 }).toFile(castA);
    await sharp(JPEG_SRC).linear([1.35, 1, 0.72], [0, 0, 0]).jpeg({ quality: 95 }).toFile(castB);

    catalogDb.initialize(path.join(BASE, 'catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));
    const imp = await importService.importFiles([castA, castB], { generateThumbnails: true, extractMetadata: false });
    const [idA, idB] = imp.importedIds;

    const target = await avg(sharp, neutral);
    const before = await avg(sharp, catalogDb.getPhoto(idA).thumbnail_path);
    check('dominante bien présente avant calibration', Math.abs(before.r - target.r) > 15 || Math.abs(before.b - target.b) > 15,
        `avant R${before.r.toFixed(0)}/B${before.b.toFixed(0)} vs neutre R${target.r.toFixed(0)}/B${target.b.toFixed(0)}`);

    // "Clic carte grise" : gains inverses de la dominante
    const gains = { r: 1 / 1.35, b: 1 / 0.72 };
    let ds = {}; ds.wb = gains;
    catalogDb.updatePhoto(idA, { develop_settings: JSON.stringify(ds) });
    const t = await thumbnailService.generateThumbnails(castA, { forceRegenerate: true });
    catalogDb.updatePhoto(idA, { thumbnail_path: t.thumbnailPath, preview_path: t.previewPath });

    const after = await avg(sharp, t.thumbnailPath);
    const dr = Math.abs(after.r - target.r), db = Math.abs(after.b - target.b);
    check('calibration ramène aux couleurs neutres', dr < 10 && db < 10,
        `après R${after.r.toFixed(0)}/G${after.g.toFixed(0)}/B${after.b.toFixed(0)} (Δr=${dr.toFixed(1)}, Δb=${db.toFixed(1)})`);

    // Sync sur B (même logique que l'IPC)
    let dsB = {}; dsB.wb = gains;
    catalogDb.updatePhoto(idB, { develop_settings: JSON.stringify(dsB) });
    const tB = await thumbnailService.generateThumbnails(castB, { forceRegenerate: true });
    const afterB = await avg(sharp, tB.thumbnailPath);
    check('sync: la 2e photo est calibrée pareil', Math.abs(afterB.r - after.r) < 4 && Math.abs(afterB.b - after.b) < 4);

    // Reset → dominante d'origine de retour
    catalogDb.updatePhoto(idA, { develop_settings: JSON.stringify({}) });
    const t2 = await thumbnailService.generateThumbnails(castA, { forceRegenerate: true, wb: null });
    const reset = await avg(sharp, t2.thumbnailPath);
    check('réinitialisation restaure les couleurs d\'origine', Math.abs(reset.r - before.r) < 6 && Math.abs(reset.b - before.b) < 6);
    check('fichier original jamais modifié', (await avg(sharp, castA)).r - before.r < 6);

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
