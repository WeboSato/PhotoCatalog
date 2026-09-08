// Headless smoke test: exercises the read-side backend of every major tool
// against the real catalog, proving each subsystem responds without error.
const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const db = require(path.join(__dirname, '..', 'dist', 'main', 'database', 'Database.js')).default;
    db.initialize('/Volumes/Backup Plus 4T/Martin Paquette Photographe_2.0/catalog.db');

    const tests = [
        ['Photos: count', () => db.getPhotoCount()],
        ['Photos: getAll(10)', () => db.getAllPhotos(10, 0).length],
        ['Photos: search rating>=4', () => db.searchPhotos({ rating: { min: 4 } }, 10, 0).length],
        ['Photos: search picked', () => db.searchPhotos({ flag: ['picked'] }, 10, 0).length],
        ['Photos: getPhotosByIds', () => { const p = db.getAllPhotos(3, 0).map(x => x.id); return db.getPhotosByIds(p).length; }],
        ['Collections: getAll', () => db.getCollections().length],
        ['Keywords: getAll', () => db.getKeywords().length],
        ['Keywords: forPhoto', () => { const p = db.getAllPhotos(1, 0)[0]; return p ? db.getPhotoKeywords(p.id).length : 0; }],
        ['Folders: getAll', () => db.getFolders().length],
        ['People: getAll', () => db.getPeople().length],
        ['Faces: forPhoto', () => { const p = db.getAllPhotos(1, 0)[0]; return p ? db.getFacesForPhoto(p.id).length : 0; }],
        ['Faces: batch', () => { const ids = db.getAllPhotos(5, 0).map(x => x.id); return Object.keys(db.getFacesForPhotos(ids)).length; }],
        ['Keywords: batch', () => { const ids = db.getAllPhotos(5, 0).map(x => x.id); return Object.keys(db.getKeywordsForPhotos(ids)).length; }],
        ['Albums: getAll', () => db.getAlbums().length],
        ['Albums: getPages', () => { const a = db.getAlbums()[0]; return a ? db.getAlbumPages(a.id).length : 0; }],
    ];

    let pass = 0, fail = 0;
    for (const [name, fn] of tests) {
        try {
            const r = await fn();
            console.log(`[tools] OK   ${name} -> ${r}`);
            pass++;
        } catch (e) {
            console.log(`[tools] FAIL ${name} -> ${e.message}`);
            fail++;
        }
    }
    console.log(`[tools] ===== ${pass} OK, ${fail} FAIL =====`);
    app.quit();
}).catch(e => { console.error('[tools] fatal', e); app.quit(); });
