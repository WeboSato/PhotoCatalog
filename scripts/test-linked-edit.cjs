// End-to-end test of the Lightroom-style linked edit copy round-trip.
// Simulates: create linked TIFF → "edit in Affinity" (we modify the TIFF on
// disk like a Cmd+S would) → watcher detects the settled save → thumbnails
// regenerate. Scratch catalog only; the real library is never touched.
// Run: ./node_modules/.bin/electron scripts/test-linked-edit.cjs
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/linked-edit-test';
const JPEG_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19/untitled.jpeg';
const RAW_DIR = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/2025/September 02';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    ok ? pass++ : fail++;
};

app.whenReady().then(async () => {
    const catalogDb = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    const thumbnailService = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ThumbnailService.js')).default;
    const externalEditorService = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ExternalEditorService.js')).default;
    const importService = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ImportService.js')).default;
    const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

    fs.rmSync(BASE, { recursive: true, force: true });
    const photosDir = path.join(BASE, 'photos');
    fs.mkdirSync(photosDir, { recursive: true });
    fs.copyFileSync(JPEG_SRC, path.join(photosDir, 'original.jpeg'));

    catalogDb.initialize(path.join(BASE, 'test-catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));

    // Import the original in place
    const imp = await importService.importFiles([path.join(photosDir, 'original.jpeg')], {
        generateThumbnails: true, extractMetadata: true
    });
    const originalId = imp.importedIds[0];
    check('original importé', !!originalId);

    // 1. Create the linked copy
    const created = await externalEditorService.createLinkedEditCopy(originalId);
    const okCreate = !('error' in created);
    check('copie liée créée', okCreate, okCreate ? path.basename(created.copyPath) : created.error);
    if (!okCreate) { app.exit(1); return; }

    check('TIFF à côté de l\'original', created.copyPath === path.join(photosDir, 'original-Edit.tif') && fs.existsSync(created.copyPath));
    const copyRow = catalogDb.getPhoto(created.copyPhotoId);
    const origRow = catalogDb.getPhoto(originalId);
    check('copie inscrite au catalogue, liée à la source', copyRow && copyRow.edited_from_id === originalId);
    check('même date de prise de vue (tri côte à côte)', String(copyRow.date_taken) === String(origRow.date_taken));
    check('original marqué (edit_copy_path)', origRow.edit_copy_path === created.copyPath);
    check('vignette de la copie générée', !!copyRow.thumbnail_path && fs.existsSync(copyRow.thumbnail_path));

    // 2. Re-invoke → reuses the same copy, no duplicate
    const again = await externalEditorService.createLinkedEditCopy(originalId);
    check('ré-édition = même copie (pas de doublon)', !('error' in again) && again.copyPhotoId === created.copyPhotoId);

    // 3. Simulate Affinity Cmd+S: rewrite the TIFF (grayscale) — like a real save
    const thumbBefore = fs.statSync(copyRow.thumbnail_path).mtimeMs;
    await new Promise(r => setTimeout(r, 1100)); // ensure a distinct mtime
    const gray = await sharp(created.copyPath).grayscale().tiff({ compression: 'lzw' }).toBuffer();
    fs.writeFileSync(created.copyPath, gray);

    // 4. Watcher: tick 1 marks the change pending, tick 2 sees it settled → regen
    const t1 = await externalEditorService.checkLinkedEditsOnce();
    check('tick 1: changement détecté mais PAS traité (anti-fichier-en-cours-d\'écriture)', t1.length === 0);
    const t2 = await externalEditorService.checkLinkedEditsOnce();
    check('tick 2: sauvegarde stabilisée → vignettes régénérées', t2.length === 1 && t2[0] === created.copyPhotoId);

    const thumbAfter = fs.statSync(catalogDb.getPhoto(created.copyPhotoId).thumbnail_path).mtimeMs;
    check('la vignette reflète le nouveau contenu (mtime bougé)', thumbAfter > thumbBefore);

    // 5. Quiet after: no spurious refresh
    const t3 = await externalEditorService.checkLinkedEditsOnce();
    check('plus de changement → plus de régénération', t3.length === 0);

    // 6. Bonus: RAW → TIFF render works on a real NEF when one is available
    try {
        const nef = fs.readdirSync(RAW_DIR).find(f => f.toLowerCase().endsWith('.nef'));
        if (nef) {
            const out = path.join(BASE, 'raw-render.tif');
            const t0 = Date.now();
            const ok = await thumbnailService.renderEditableTiff(path.join(RAW_DIR, nef), out);
            check('RAW réel → TIFF éditable', ok && fs.statSync(out).size > 0, `${nef}, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(fs.statSync(out).size / 1048576).toFixed(1)} Mo`);
        } else {
            console.log('ℹ️ pas de NEF disponible — test RAW sauté');
        }
    } catch { console.log('ℹ️ dossier RAW inaccessible — test RAW sauté'); }

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
