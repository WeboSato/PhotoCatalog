// Sweep: fixed-rep clustering WITH tiny-face filter, reporting people count AND
// a purity metric (fraction of clusters that contain an obviously-different face).
const { app } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
    const db = new Database('/tmp/bak.db', { readonly: true });
    const rows = db.prepare('SELECT descriptor, box_width, box_height FROM faces WHERE descriptor IS NOT NULL').all();
    const MIN_AREA = 0.012;
    const faces = [];
    for (const r of rows) {
        if ((r.box_width || 0) * (r.box_height || 0) < MIN_AREA) continue;
        try { const d = JSON.parse(r.descriptor); if (d.length >= 64) faces.push(Float64Array.from(d)); } catch {}
    }
    console.log('[sweep] faces after size filter:', faces.length, '/', rows.length);
    const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };

    function run(TH) {
        const cl = []; // {rep, members:[idx]}
        for (let i = 0; i < faces.length; i++) {
            let best = -1, bd = Infinity;
            for (let c = 0; c < cl.length; c++) { const d = dist(faces[i], cl[c].rep); if (d < bd) { bd = d; best = c; } }
            if (best >= 0 && bd < TH) cl[best].members.push(i);
            else cl.push({ rep: faces[i], members: [i] });
        }
        const kept = cl.filter(c => c.members.length >= 2).sort((a, b) => b.members.length - a.members.length);
        // purity: for each kept cluster sample 30 member pairs, count those >0.72 (different person)
        let impureClusters = 0, totalPairs = 0, mixedPairs = 0;
        for (const c of kept) {
            let localMixed = 0;
            for (let t = 0; t < 30; t++) {
                const a = c.members[(Math.floor(faces.length * 0.7 + t * 7)) % c.members.length];
                const b = c.members[(Math.floor(faces.length * 0.3 + t * 13)) % c.members.length];
                if (a === b) continue;
                const d = dist(faces[a], faces[b]); totalPairs++;
                if (d > 0.72) { mixedPairs++; localMixed++; }
            }
            if (localMixed > 2) impureClusters++;
        }
        return { people: kept.length, largest: kept[0]?.members.length || 0,
            impureClusters, impurePct: Math.round(mixedPairs / Math.max(1, totalPairs) * 100) };
    }

    for (const TH of [0.45, 0.48, 0.5, 0.52, 0.55, 0.6]) {
        const t0 = Date.now();
        const r = run(TH);
        console.log(`[sweep] th=${TH} -> people=${r.people} largest=${r.largest} impureClusters=${r.impureClusters} mixedPairs=${r.impurePct}% (${Math.round((Date.now()-t0)/1000)}s)`);
    }
    app.quit();
}).catch(e => { console.error(e); app.quit(); });
