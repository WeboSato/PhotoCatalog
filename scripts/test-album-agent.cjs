// Exercises AlbumAgentService against the real catalog (no UI).
// Run: ./node_modules/.bin/electron scripts/test-album-agent.cjs
const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const catalogDb = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    const { albumAgentService } = require(path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'AlbumAgentService.js'));

    catalogDb.initialize('/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/catalog.db');

    // Seed with 60 photos from the library.
    const seed = catalogDb.getAllPhotos(60, 0).map(p => p.id);
    console.log('[agent-test] seed size:', seed.length);

    const r = await albumAgentService.build({ seedIds: seed, density: 'balanced' }, p => {});
    console.log('[agent-test] summary:', JSON.stringify(r.summary));
    console.log('[agent-test] ordered:', r.orderedIds.length, 'heroes:', r.heroIds.length, 'rejects:', r.rejects.length, 'cover:', r.coverId ? 'yes' : 'no');
    const sampleId = r.orderedIds[0];
    console.log('[agent-test] sample reason:', sampleId, '->', r.reasons[sampleId]);
    console.log('[agent-test] first 5 reasons:', r.orderedIds.slice(0, 5).map(id => r.reasons[id]));
    const focalCount = Object.keys(r.focals || {}).length;
    console.log('[agent-test] FOCALS (face-safe crop): ', focalCount, 'photos have a face focal point');
    const fEx = Object.entries(r.focals || {})[0];
    if (fEx) console.log('[agent-test] focal example:', fEx[0], '->', JSON.stringify(fEx[1]));

    app.quit();
}).catch(e => { console.error('[agent-test] fatal', e); app.quit(); });
