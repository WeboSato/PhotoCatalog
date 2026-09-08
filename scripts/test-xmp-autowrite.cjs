// XMP auto-write: a photo's keywords / rating / label end up in a sidecar next
// to the file, the backfill catches up old rows, and re-import reads it back.
// Scratch catalog only.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = '/private/tmp/claude-501/-Volumes-Seagate-4T-PhotoCatalog/745e7b21-9f4b-40fc-ab1c-b46439395bf0/scratchpad/xmp-test';
const JPEG_SRC = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/Images/Année 2025/Siana/2025/April 19/untitled.jpeg';

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); ok ? pass++ : fail++; };

app.whenReady().then(async () => {
    const catalogDb = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/database/Database.js').default;
    const thumbnailService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ThumbnailService.js').default;
    const importService = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/services/ImportService.js').default;
    const { xmpAutoWrite } = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/main/services/XmpAutoWriteService.js');
    const { XmpService } = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/main/services/XmpService.js');
    const { settingsService } = require('/Volumes/Seagate 4T/PhotoCatalog/dist/main/main/services/SettingsService.js');
    // Sidecar writing is opt-in since it touches files Lightroom also owns.
    settingsService.set('autoWriteXmp', true);

    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(path.join(BASE, 'photos'), { recursive: true });
    const a = path.join(BASE, 'photos', 'shoot-a.jpeg');
    const b = path.join(BASE, 'photos', 'shoot-b.jpeg');
    fs.copyFileSync(JPEG_SRC, a);
    fs.copyFileSync(JPEG_SRC, b);

    catalogDb.initialize(path.join(BASE, 'catalog.db'));
    thumbnailService.initialize(path.join(BASE, 'thumbs'));

    // 1. Import with dialog keywords, rate + label it, then let the queue flush
    const imp = await importService.importFiles([a, b], { generateThumbnails: false, extractMetadata: false, keywords: ['mariage', 'extérieur'] });
    const [idA, idB] = imp.importedIds;
    catalogDb.bulkUpdateRating([idA], 4);
    catalogDb.bulkUpdateColorLabel([idA], 'red');
    catalogDb.bulkUpdateFlag([idA], 'picked');
    xmpAutoWrite.queue([idA]);
    await new Promise(r => setTimeout(r, 2200)); // > 1.5 s debounce

    const xmpA = XmpService.getXmpPath(a);
    check('sidecar .xmp créé à côté du fichier', fs.existsSync(xmpA), path.basename(xmpA));
    const txt = fs.existsSync(xmpA) ? fs.readFileSync(xmpA, 'utf-8') : '';
    check('mots-clés dans le fichier (dc:subject)', txt.includes('dc:subject') && txt.includes('mariage') && txt.includes('extérieur'));
    check('note 4★ dans le fichier', /Rating[^0-9]*4/.test(txt));
    check('libellé couleur dans le fichier', /red/i.test(txt));
    check('original jamais modifié', fs.statSync(a).size === fs.statSync(JPEG_SRC).size);

    // 2. Backfill: B had no sidecar (never queued) → catch-up writes it
    check('B sans sidecar avant rattrapage', !fs.existsSync(XmpService.getXmpPath(b)));
    const r = await xmpAutoWrite.backfill();
    check('rattrapage écrit les sidecars manquants', r.written >= 1 && fs.existsSync(XmpService.getXmpPath(b)), `${r.written} écrits, ${r.skipped} à jour`);
    const r2 = await xmpAutoWrite.backfill();
    check('2e rattrapage = rien à faire (sidecars à jour)', r2.written === 0, `${r2.written} écrits`);

    // 3. Round-trip: a fresh catalog importing the same file reads the sidecar back
    catalogDb.initialize(path.join(BASE, 'catalog2.db'));
    const imp2 = await importService.importFiles([a], { generateThumbnails: false, extractMetadata: false });
    const row = catalogDb.getPhoto(imp2.importedIds[0]);
    const kws = catalogDb.getPhotoKeywords(row.id).map(k => k.name);
    check('nouveau catalogue: note relue depuis le XMP', row.rating === 4, `rating=${row.rating}`);
    check('nouveau catalogue: mots-clés relus depuis le XMP', kws.includes('mariage') && kws.includes('extérieur'), kws.join(', '));

    // Safety contract: a sidecar written by Lightroom is never touched.
    const foreign = path.join(BASE, 'photos', 'foreign.jpeg');
    fs.copyFileSync(JPEG_SRC, foreign);
    const impF = await importService.importFiles([foreign], { generateThumbnails: false, extractMetadata: false });
    const LR = '<?xpacket begin=""?><x:xmpmeta x:xmptk="Adobe XMP Core 5.6"><rdf:RDF><rdf:Description crs:CropTop="0.2"/></rdf:RDF></x:xmpmeta>';
    fs.writeFileSync(XmpService.getXmpPath(foreign), LR);
    catalogDb.bulkUpdateRating([impF.importedIds[0]], 5);
    xmpAutoWrite.queue([impF.importedIds[0]]);
    await new Promise(r => setTimeout(r, 2200));
    check('sidecar Lightroom jamais écrasé', fs.readFileSync(XmpService.getXmpPath(foreign), 'utf-8').includes('crs:CropTop'));

    console.log(`\n${pass}/${pass + fail} tests OK`);
    app.exit(fail === 0 ? 0 : 1);
}).catch(e => { console.error('❌ fatal', e); app.exit(1); });
