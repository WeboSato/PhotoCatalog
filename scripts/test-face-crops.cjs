// Verifies the face-crop pipeline (migration + getFacesNeedingCrops + generateFaceCrop)
// against the real catalog. Run: ./node_modules/.bin/electron scripts/test-face-crops.cjs
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    const catalogDb = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    const thumbs = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ThumbnailService.js')).default;

    const CAT = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0';
    catalogDb.initialize(path.join(CAT, 'catalog.db')); // runs migration -> adds face_crop_path
    thumbs.initialize(path.join(CAT, 'thumbnails'));     // creates faces/ dir

    // Migration present?
    const cols = catalogDb.getDb().pragma('table_info(faces)').map(c => c.name);
    console.log('[face] face_crop_path column present:', cols.includes('face_crop_path'));

    const rows = catalogDb.getFacesNeedingCrops();
    console.log('[face] representative faces needing crops:', rows.length);

    // Generate crops for the first 12 to prove the pipeline.
    let ok = 0, skipped = 0, badsrc = 0;
    for (const r of rows.slice(0, 12)) {
        const src = thumbs.getPreviewPath(r.file_path)
            ?? thumbs.getThumbnailPath(r.file_path)
            ?? (r.thumbnail_path && fs.existsSync(r.thumbnail_path) ? r.thumbnail_path : null);
        if (!src) { badsrc++; continue; }
        const out = await thumbs.generateFaceCrop(src, r.id, r, { force: true });
        if (out && fs.existsSync(out)) {
            const buf = fs.readFileSync(out);
            const isWebp = buf.slice(0, 4).toString('latin1') === 'RIFF';
            catalogDb.setFaceCropPath(r.id, out);
            ok++;
            if (ok <= 3) console.log(`[face] crop OK: ${path.basename(out)} ${buf.length}b webp=${isWebp} src=${path.basename(src)}`);
        } else {
            skipped++;
        }
    }
    console.log(`[face] ===== generated ${ok}, skipped ${skipped}, no-source ${badsrc} =====`);

    // Confirm persistence
    const persisted = catalogDb.getDb().prepare("SELECT COUNT(*) c FROM faces WHERE face_crop_path IS NOT NULL").get().c;
    console.log('[face] faces with face_crop_path in DB:', persisted);

    app.quit();
}).catch(e => { console.error('[face] fatal', e); app.quit(); });
