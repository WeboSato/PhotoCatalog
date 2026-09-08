// Runs the improved face re-clustering on the real catalog.
// Run: ./node_modules/.bin/electron scripts/recluster-faces.cjs
const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const catalogDb = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    const thumbs = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'ThumbnailService.js')).default;
    const { reclusterAllFaces } = require(path.join(__dirname, '..', 'dist', 'main', 'services', 'FaceClusteringService.js'));

    const CAT = '/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0';
    catalogDb.initialize(path.join(CAT, 'catalog.db'));
    thumbs.initialize(path.join(CAT, 'thumbnails'));

    const before = catalogDb.getDb().prepare('SELECT COUNT(*) c FROM people').get().c;
    console.log('[recluster] people before:', before);

    const t0 = Date.now();
    let lastPhase = '';
    const res = await reclusterAllFaces(catalogDb, thumbs, (p) => {
        if (p.phase !== lastPhase) { lastPhase = p.phase; console.log('[recluster] phase:', p.phase); }
        if (p.total && p.current && p.current % 6000 === 0) console.log(`[recluster]   ${p.phase} ${p.current}/${p.total}`);
    });
    console.log(`[recluster] DONE in ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(res));

    const after = catalogDb.getDb().prepare('SELECT COUNT(*) c FROM people').get().c;
    console.log('[recluster] people after:', after);
    app.quit();
}).catch(e => { console.error('[recluster] fatal', e); app.quit(); });
