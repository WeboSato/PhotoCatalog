import { v4 as uuidv4 } from 'uuid';

// Improved offline face clustering. Replaces the old greedy pass (which over-merged
// different people and left ~37% of faces unassigned) with FIXED-representative
// nearest-neighbour clustering over the FULL face set, preserving renamed people.
//
// Why fixed-representative and NOT centroid: a running-centroid cluster drifts
// toward the population-average face, and then every face falls within threshold of
// it — collapsing everyone into one mega-cluster (measured: 18k-32k faces in one).
// A fixed representative (the cluster's first face, never updated) has no drift.
//
// Threshold. 0.6 keeps the people count low (fewer duplicate cards) at the cost of
// occasionally grouping similar-looking different people in mid-size clusters;
// 0.5 is purer but splits one person across a few cards. User preference: 0.6
// (fewer cards). Tunable per call via opts.threshold.
const DEFAULT_THRESHOLD = 0.6;
const MIN_CLUSTER = 2; // a "person" must appear in >= 2 photos (drops singleton false-positives)
// Faces smaller than this fraction of the image (box_width * box_height) get an
// unreliable 128-d descriptor (a ~15px crowd/stage face) that bridges different
// people together — measured: the "intruders" in a mixed person were ~0.3% area
// vs ~6.5% for the real faces. Below this, leave the face unassigned.
const DEFAULT_MIN_FACE_AREA = 0.012;

export interface ReclusterOptions {
    threshold?: number;
    minCluster?: number;
    minFaceArea?: number;
}

interface FaceRow {
    id: string;
    photo_id: string;
    person_id: string | null;
    box_width: number;
    box_height: number;
    file_path: string;
    descriptor: number[];
}

interface Cluster {
    rep: Float64Array;   // representative descriptor — FIXED, never drifts
    faceIds: string[];
}

function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
}

type ProgressFn = (p: { phase: string; current?: number; total?: number }) => void;

export interface ReclusterResult {
    peopleCreated: number;
    facesAssigned: number;
    unassigned: number;
    preservedNames: number;
}

/**
 * Recluster every face with a descriptor. `catalogDb` is the CatalogDatabase
 * singleton; `thumbnailService` provides getPreviewPath/getThumbnailPath/
 * generateFaceCrop for the new representatives. Renamed people (name not matching
 * "Person N") keep their name if a resulting cluster matches their faces.
 */
export async function reclusterAllFaces(
    catalogDb: any,
    thumbnailService: any,
    onProgress?: ProgressFn,
    opts: ReclusterOptions = {}
): Promise<ReclusterResult> {
    const THRESHOLD = opts.threshold ?? DEFAULT_THRESHOLD;
    const minCluster = opts.minCluster ?? MIN_CLUSTER;
    const minFaceArea = opts.minFaceArea ?? DEFAULT_MIN_FACE_AREA;
    const db = catalogDb.getDb();
    onProgress?.({ phase: 'loading' });

    const rows = db.prepare(`
        SELECT f.id, f.photo_id, f.person_id, f.box_width, f.box_height, f.descriptor, p.file_path
        FROM faces f JOIN photos p ON p.id = f.photo_id
        WHERE f.descriptor IS NOT NULL
    `).all() as any[];

    const faces: FaceRow[] = [];
    let tooSmall = 0;
    for (const r of rows) {
        // Skip faces too small to have a reliable descriptor (they cross-contaminate).
        if ((r.box_width || 0) * (r.box_height || 0) < minFaceArea) { tooSmall++; continue; }
        try {
            const d = JSON.parse(r.descriptor);
            if (Array.isArray(d) && d.length >= 64) {
                faces.push({ id: r.id, photo_id: r.photo_id, person_id: r.person_id, box_width: r.box_width, box_height: r.box_height, file_path: r.file_path, descriptor: d });
            }
        } catch { /* skip bad descriptor */ }
    }
    const DIM = faces[0]?.descriptor.length || 128;

    // Snapshot renamed people's centroids BEFORE rebuild, to carry names over.
    const namedPeople = db.prepare(`SELECT id, name FROM people WHERE name NOT LIKE 'Person %'`).all() as { id: string; name: string }[];
    const namedCentroids: { id: string; name: string; centroid: Float64Array; claimed: boolean }[] = [];
    for (const np of namedPeople) {
        const sum = new Float64Array(DIM); let n = 0;
        for (const f of faces) {
            if (f.person_id === np.id) { for (let k = 0; k < DIM; k++) sum[k] += f.descriptor[k]; n++; }
        }
        if (n > 0) {
            const c = new Float64Array(DIM); for (let k = 0; k < DIM; k++) c[k] = sum[k] / n;
            namedCentroids.push({ id: np.id, name: np.name, centroid: c, claimed: false });
        }
    }

    // ---- Fixed-representative nearest-neighbour clustering over ALL faces ----
    onProgress?.({ phase: 'clustering', current: 0, total: faces.length });
    const clusters: Cluster[] = [];
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        let best = -1, bestD = Infinity;
        for (let c = 0; c < clusters.length; c++) {
            const d = dist(f.descriptor, clusters[c].rep);
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best >= 0 && bestD < THRESHOLD) {
            clusters[best].faceIds.push(f.id);
        } else {
            clusters.push({ rep: Float64Array.from(f.descriptor), faceIds: [f.id] });
        }
        if (i > 0 && i % 4000 === 0) onProgress?.({ phase: 'clustering', current: i, total: faces.length });
    }

    // Keep clusters that appear in >= minCluster photos.
    const kept = clusters.filter(c => c.faceIds.length >= minCluster);
    const unassignedCount = faces.length - kept.reduce((n, c) => n + c.faceIds.length, 0);

    // Match each kept cluster (largest first) to a renamed person, once each.
    const faceById = new Map(faces.map(f => [f.id, f]));
    const assignments: { personId: string; name: string; faceIds: string[]; repId: string; repFile: string }[] = [];
    let autoN = 1;
    kept.sort((a, b) => b.faceIds.length - a.faceIds.length);
    for (const cl of kept) {
        let name = '', personId = '';
        let bestNamed: typeof namedCentroids[0] | null = null, bestNd = Infinity;
        for (const nc of namedCentroids) {
            if (nc.claimed) continue;
            const d = dist(cl.rep, nc.centroid);
            if (d < bestNd) { bestNd = d; bestNamed = nc; }
        }
        if (bestNamed && bestNd < THRESHOLD) {
            bestNamed.claimed = true;
            personId = bestNamed.id; name = bestNamed.name;
        } else {
            personId = uuidv4(); name = `Person ${autoN++}`;
        }
        // representative = largest face box in the cluster
        let repId = cl.faceIds[0], repArea = -1, repFile = '';
        for (const fid of cl.faceIds) {
            const fr = faceById.get(fid);
            if (!fr) continue;
            const area = fr.box_width * fr.box_height;
            if (area > repArea) { repArea = area; repId = fid; repFile = fr.file_path; }
        }
        assignments.push({ personId, name, faceIds: cl.faceIds, repId, repFile });
    }

    // ---- Rebuild people + assignments in one transaction ----
    onProgress?.({ phase: 'saving' });
    const rebuild = db.transaction(() => {
        db.exec('UPDATE faces SET person_id = NULL');
        db.exec('DELETE FROM people');
        const insPerson = db.prepare('INSERT INTO people (id, name, thumbnail_face_id, face_count) VALUES (?, ?, ?, ?)');
        const assignFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');
        for (const a of assignments) {
            insPerson.run(a.personId, a.name, a.repId, a.faceIds.length);
            for (const fid of a.faceIds) assignFace.run(a.personId, fid);
        }
    });
    rebuild();

    // ---- Generate a square crop for each new representative (I/O, outside txn) ----
    onProgress?.({ phase: 'crops', current: 0, total: assignments.length });
    let done = 0;
    for (const a of assignments) {
        try {
            const src = thumbnailService.getPreviewPath(a.repFile) ?? thumbnailService.getThumbnailPath(a.repFile);
            if (src) {
                const fr = faceById.get(a.repId);
                const out = await thumbnailService.generateFaceCrop(src, a.repId, fr, { force: true });
                if (out) catalogDb.setFaceCropPath(a.repId, out);
            }
        } catch { /* one bad crop must not abort */ }
        done++;
        if (done % 10 === 0) onProgress?.({ phase: 'crops', current: done, total: assignments.length });
    }

    return {
        peopleCreated: assignments.length,
        facesAssigned: assignments.reduce((n, a) => n + a.faceIds.length, 0),
        unassigned: unassignedCount,
        preservedNames: namedCentroids.filter(n => n.claimed).length,
    };
}
