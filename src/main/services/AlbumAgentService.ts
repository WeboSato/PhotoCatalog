import catalogDb from '../../database/Database';
import type { Photo } from '../../database/Database';
import type { AlbumProgress } from '../../shared/albumTypes';

// blurhash is a CommonJS dep already used by ThumbnailService.
let blurhashDecode: ((hash: string, w: number, h: number) => Uint8ClampedArray) | null = null;
try { blurhashDecode = require('blurhash').decode; } catch { /* optional */ }

export interface CurateParams {
    seedIds?: string[];
    personId?: string;
    density?: 'minimal' | 'balanced' | 'dense';
    minCount?: number;
}

export interface CurateResult {
    orderedIds: string[];
    coverId: string | null;
    heroIds: string[];
    reasons: Record<string, string>;
    rejects: { id: string; reason: string }[];
    summary: {
        keeperCount: number;
        eventCount: number;
        nearDupsRemoved: number;
        peopleCovered: number;
        strategy: string;
    };
}

type ProgressFn = (p: AlbumProgress) => void;

const HOUR = 3600 * 1000;

function effAspect(p: Photo): number {
    const w = p.width || 1, h = p.height || 1;
    const swap = (p as any).orientation && [5, 6, 7, 8].includes((p as any).orientation);
    return swap ? h / w : w / h;
}

function scorePhoto(p: Photo, kwCount: number, faceCount: number, distinctPersons: number, sharp: number): number {
    let s = 40 * ((p.rating || 0) / 5);
    s += p.flag === 'picked' ? 25 : p.flag === 'none' ? 8 : 0;
    s += (p as any).color_label && (p as any).color_label !== 'none' ? 5 : 0;
    s += faceCount ? Math.min(12, 6 + 3 * distinctPersons) : 0;
    s += Math.min(8, 2 * kwCount);
    s += (p.title || (p as any).caption) ? 2 : 0;
    s += sharp * 8;
    return s;
}

// Decode a blurhash to an 8x8 luma grid for burst/near-dup comparison + a coarse
// sharpness proxy (flat blurhash => blurry frame => low local variance).
function blurGrid(hash?: string): number[] | null {
    if (!hash || !blurhashDecode) return null;
    try {
        const px = blurhashDecode(hash, 8, 8);
        const luma: number[] = [];
        for (let i = 0; i < 64; i++) {
            const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
            luma.push(0.299 * r + 0.587 * g + 0.114 * b);
        }
        return luma;
    } catch { return null; }
}

function gridDistance(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s / a.length);
}

function sharpnessProxy(grid: number[] | null): number {
    if (!grid) return 0.5; // neutral when unknown
    const mean = grid.reduce((x, y) => x + y, 0) / grid.length;
    let v = 0;
    for (const x of grid) v += (x - mean) * (x - mean);
    v = Math.sqrt(v / grid.length);
    return Math.max(0, Math.min(1, v / 60)); // ~0..1
}

class AlbumAgentService {
    async build(params: CurateParams, onProgress?: ProgressFn): Promise<CurateResult> {
        onProgress?.({ phase: 'scan', message: 'Analyse de la bibliothèque…' });

        // ---- Stage 0: candidate pool ----
        let pool: Photo[] = [];
        if (params.seedIds && params.seedIds.length) {
            pool = catalogDb.getPhotosByIds(params.seedIds);
        } else if (params.personId) {
            pool = catalogDb.getPhotosByPerson(params.personId);
        } else {
            pool = catalogDb.searchPhotos({ flag: ['picked'] } as any, 100000, 0);
            const minCount = params.minCount || 20;
            if (pool.length < minCount) pool = catalogDb.searchPhotos({ rating: { min: 1 } } as any, 100000, 0);
            if (pool.length < minCount) pool = catalogDb.getAllPhotos(100000, 0);
        }
        pool = pool.filter(p => p.flag !== 'rejected');
        if (pool.length === 0) {
            return { orderedIds: [], coverId: null, heroIds: [], reasons: {}, rejects: [], summary: { keeperCount: 0, eventCount: 0, nearDupsRemoved: 0, peopleCovered: 0, strategy: 'Aucune photo éligible.' } };
        }

        // ---- Stage 1: batch-enrich ----
        onProgress?.({ phase: 'curate', message: 'Lecture des métadonnées…' });
        const ids = pool.map(p => p.id);
        const kw = catalogDb.getKeywordsForPhotos(ids);
        const faces = catalogDb.getFacesForPhotos(ids);

        // ---- Stage 2: quality score ----
        const grids = new Map<string, number[] | null>();
        const scoreById = new Map<string, number>();
        for (const p of pool) {
            const g = blurGrid(p.blur_hash);
            grids.set(p.id, g);
            const f = faces[p.id] || [];
            const persons = new Set(f.map(x => x.person_id).filter(Boolean));
            const s = scorePhoto(p, (kw[p.id] || []).length, f.length, persons.size, sharpnessProxy(g));
            scoreById.set(p.id, s);
        }

        // ---- Stage 3: chronological event buckets + near-dup collapse ----
        onProgress?.({ phase: 'curate', message: 'Regroupement par événement…' });
        const timeKey = (p: Photo) => p.date_taken || p.date_imported || '';
        const sorted = [...pool].sort((a, b) => {
            const ta = timeKey(a), tb = timeKey(b);
            return ta < tb ? -1 : ta > tb ? 1 : 0;
        });

        const rejects: { id: string; reason: string }[] = [];
        const rejectedSet = new Set<string>();
        let nearDupsRemoved = 0;

        const buckets: Photo[][] = [];
        let cur: Photo[] = [];
        let prevT: number | null = null;
        for (const p of sorted) {
            const t = Date.parse(timeKey(p));
            const tv = isNaN(t) ? null : t;
            if (cur.length && prevT != null && tv != null && (tv - prevT) > 6 * HOUR) {
                buckets.push(cur); cur = [];
            }
            cur.push(p);
            if (tv != null) prevT = tv;
        }
        if (cur.length) buckets.push(cur);

        // near-dup collapse inside buckets (only where blur_hash exists)
        const NEARDUP = 6; // luma grid distance threshold
        for (const b of buckets) {
            for (let i = 0; i < b.length; i++) {
                if (rejectedSet.has(b[i].id)) continue;
                const gi = grids.get(b[i].id);
                if (!gi) continue;
                for (let j = i + 1; j < b.length; j++) {
                    if (rejectedSet.has(b[j].id)) continue;
                    const gj = grids.get(b[j].id);
                    if (!gj) continue;
                    if (gridDistance(gi, gj) < NEARDUP) {
                        const loser = (scoreById.get(b[i].id) || 0) >= (scoreById.get(b[j].id) || 0) ? b[j] : b[i];
                        rejectedSet.add(loser.id);
                        rejects.push({ id: loser.id, reason: 'Quasi-doublon (rafale) — meilleure version gardée.' });
                        nearDupsRemoved++;
                    }
                }
            }
        }

        // Hero threshold: top ~10% by score become full-bleed (plus each event's
        // lead and true panoramas). Percentile keeps the ratio sane regardless of
        // how generous the raw scores are, so multi-photo pages still dominate.
        const keptScores = sorted.filter(p => !rejectedSet.has(p.id)).map(p => scoreById.get(p.id) || 0).sort((a, z) => a - z);
        const heroThreshold = keptScores.length ? keptScores[Math.floor(keptScores.length * 0.9)] : Infinity;

        // ---- Stage 4/5: build ordered keepers, heroes, reasons, cover ----
        const reasons: Record<string, string> = {};
        const orderedIds: string[] = [];
        const heroIds: string[] = [];
        const peopleSeen = new Set<string>();

        for (const b of buckets) {
            const kept = b.filter(p => !rejectedSet.has(p.id));
            // lead the event with its best photo
            kept.sort((a, z) => (scoreById.get(z.id) || 0) - (scoreById.get(a.id) || 0));
            const lead = kept[0];
            // restore chronological order for the rest
            const rest = kept.slice(1).sort((a, z) => (timeKey(a) < timeKey(z) ? -1 : 1));
            const seq = lead ? [lead, ...rest] : rest;
            for (const p of seq) {
                orderedIds.push(p.id);
                const panorama = effAspect(p) >= 1.7;
                const topScored = (scoreById.get(p.id) || 0) >= heroThreshold;
                if (p === lead || panorama || topScored) heroIds.push(p.id);
                const f = faces[p.id] || [];
                f.forEach(x => x.person_id && peopleSeen.add(x.person_id));
                reasons[p.id] = buildReason(p, scoreById.get(p.id) || 0, (kw[p.id] || []).length, f.length, p === lead);
            }
        }

        const coverId = orderedIds.length
            ? orderedIds.reduce((best, id) => (scoreById.get(id) || 0) > (scoreById.get(best) || 0) ? id : best, orderedIds[0])
            : null;

        onProgress?.({ phase: 'done', message: `Composé ${orderedIds.length} photos` });
        return {
            orderedIds,
            coverId,
            heroIds,
            reasons,
            rejects,
            summary: {
                keeperCount: orderedIds.length,
                eventCount: buckets.length,
                nearDupsRemoved,
                peopleCovered: peopleSeen.size,
                strategy: `Regroupé en ${buckets.length} événement(s), ordonné par date, meilleures photos en pleine page.`,
            },
        };
    }
}

function buildReason(p: Photo, score: number, kwCount: number, faceCount: number, isLead: boolean): string {
    const bits: string[] = [];
    if (p.rating) bits.push(`${p.rating}★`);
    if (p.flag === 'picked') bits.push('retenue');
    if (faceCount) bits.push(`${faceCount} visage${faceCount > 1 ? 's' : ''}`);
    if (kwCount) bits.push(`${kwCount} mot(s)-clé`);
    if (isLead) bits.push('photo phare de l’événement');
    if (!bits.length) bits.push('sélection par date');
    return bits.join(', ');
}

export const albumAgentService = new AlbumAgentService();
export default albumAgentService;
