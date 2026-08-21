// End-to-end test of the visual card import pipeline against a FAKE card and a
// SCRATCH catalog (the real library is never touched).
// Run: ./node_modules/.bin/electron scripts/test-card-import.cjs
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/card-test';
const LIB = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19';
const RAW_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/2025/September 01/MPP_2316.NEF';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    ok ? pass++ : fail++;
};

app.whenReady().then(async () => {
    const catalogDb = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    const importService = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ImportService.js')).default;
    const thumbnailService = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ThumbnailService.js')).default;

    // Fresh sandbox
    fs.rmSync(BASE, { recursive: true, force: true });
    const dcim = path.join(BASE, 'FAKECARD', 'DCIM', '100TEST');
    fs.mkdirSync(dcim, { recursive: true });
    const jpegs = fs.readdirSync(LIB).filter(f => f.endsWith('.jpeg')).slice(0, 4);
    for (const f of jpegs) fs.copyFileSync(path.join(LIB, f), path.join(dcim, f));
    let hasRaw = false;
    try {
        if (fs.existsSync(RAW_SRC) && fs.statSync(RAW_SRC).size > 0) {
            fs.copyFileSync(RAW_SRC, path.join(dcim, 'MPP_2316.NEF'));
            hasRaw = true;
        }
    } catch {}

    catalogDb.initialize(path.join(BASE, 'test-catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));

    // 1. Scan
    const scanned = await importService.scanCardFiles(path.join(BASE, 'FAKECARD', 'DCIM'));
    check('scanCardFiles trouve les photos', scanned.length === jpegs.length + (hasRaw ? 1 : 0),
        `${scanned.length} trouvées (attendu ${jpegs.length + (hasRaw ? 1 : 0)})`);
    check('tri par date décroissante', scanned.every((f, i) => i === 0 || scanned[i - 1].mtimeMs >= f.mtimeMs));

    // 2. Quick previews
    const pj = path.join(BASE, 'prev-jpeg.webp');
    const okJ = await thumbnailService.quickPreview(scanned.find(f => !f.isRaw).path, pj);
    check('aperçu rapide JPEG', okJ && fs.existsSync(pj) && fs.statSync(pj).size > 0);
    if (hasRaw) {
        const pr = path.join(BASE, 'prev-raw.webp');
        const t0 = Date.now();
        const okR = await thumbnailService.quickPreview(scanned.find(f => f.isRaw).path, pr);
        check('aperçu rapide RAW (JPEG intégré)', okR && fs.existsSync(pr) && fs.statSync(pr).size > 0, `${Date.now() - t0} ms`);
    }

    // 3. Import with destination + subfolder that DOESN'T exist yet (the ENOENT bug)
    const dest = path.join(BASE, 'imported', '2026-08-20');
    const paths = scanned.map(f => f.path);
    const r1 = await importService.importFiles(paths, {
        destinationPath: dest, generateThumbnails: false, extractMetadata: true,
        keywords: ['test-import', 'carte'], deleteAfterImport: false
    });
    check('import avec destination inexistante (mkdir auto)', r1.importedIds.length === paths.length,
        `${r1.importedIds.length}/${paths.length} importées, ${r1.errors.length} erreurs ${r1.errors[0] ? '(' + r1.errors[0].error + ')' : ''}`);
    check('fichiers copiés dans la destination', fs.existsSync(dest) && fs.readdirSync(dest).length >= paths.length);
    const one = catalogDb.getPhoto(r1.importedIds[0]);
    check('chemin en base = copie (pas la carte)', one && one.file_path.startsWith(dest));
    const kw = catalogDb.getPhotoKeywords(r1.importedIds[0]).map(k => k.name);
    check('mots-clés du dialogue appliqués', kw.includes('test-import') && kw.includes('carte'), kw.join(', '));

    // 4. Re-import the same card → everything skipped (name+size dedup)
    const r2 = await importService.importFiles(paths, {
        destinationPath: dest, generateThumbnails: false, extractMetadata: true
    });
    check('ré-import = 0 doublon (tout ignoré)', r2.importedIds.length === 0 && r2.skippedFiles.length === paths.length,
        `${r2.importedIds.length} importées, ${r2.skippedFiles.length} ignorées`);

    // 5. deleteAfterImport: copy verified then source removed
    const extra = path.join(dcim, 'extra-delete-me.jpeg');
    fs.copyFileSync(path.join(LIB, jpegs[0]), extra);
    // different "name" so the dedup doesn't skip it
    const r3 = await importService.importFiles([extra], {
        destinationPath: dest, generateThumbnails: false, extractMetadata: false, deleteAfterImport: true
    });
    check('suppression de la carte après copie vérifiée', r3.importedIds.length === 1 && !fs.existsSync(extra));

    // 6. Name collision with a DIFFERENT file → suffixed, never overwritten
    const clashSrc = path.join(dcim, 'clash.jpeg');
    fs.copyFileSync(path.join(LIB, jpegs[1]), clashSrc); // content A
    const preexisting = path.join(dest, 'clash.jpeg');
    fs.copyFileSync(path.join(LIB, jpegs[2]), preexisting); // content B already in dest
    const sizeB = fs.statSync(preexisting).size;
    const r4 = await importService.importFiles([clashSrc], {
        destinationPath: dest, generateThumbnails: false, extractMetadata: false
    });
    const suffixed = path.join(dest, 'clash_1.jpeg');
    check('collision de nom → suffixe _1, original intact',
        r4.importedIds.length === 1 && fs.existsSync(suffixed) && fs.statSync(preexisting).size === sizeB);

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
