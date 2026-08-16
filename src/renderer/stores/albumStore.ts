import { create } from 'zustand';
import { useCatalogStore, Photo } from './catalogStore';
import { fullBleedPages, packPages, buildRenderSpec, LayoutPhoto } from '../services/LayoutEngine';
import {
    Album, AlbumPage, AlbumSettings, AlbumBuildSummary, AlbumExportResult,
    AlbumProgress, PageFormat, AlbumTargetType, DEFAULT_ALBUM_SETTINGS
} from '../../shared/albumTypes';

// Deterministic offline curation for the MVP: drop rejects, order chronologically,
// pick the best-scored photo as cover. (The richer AlbumAgentService — near-dup
// collapse, people coverage, multi-photo layouts — is a Phase-2 upgrade.)
function scorePhoto(p: Photo): number {
    return (p.rating || 0) * 10
        + (p.flag === 'picked' ? 8 : 0)
        + (p.color_label && p.color_label !== 'none' ? 2 : 0);
}

function curate(photos: Photo[]): { orderedIds: string[]; coverId?: string; summary: AlbumBuildSummary } {
    const usable = photos.filter(p => p.flag !== 'rejected');
    const sorted = [...usable].sort((a, b) => {
        const da = a.date_taken || a.date_imported || '';
        const db = b.date_taken || b.date_imported || '';
        if (da && db) return da < db ? -1 : da > db ? 1 : 0;
        return 0;
    });
    const cover = sorted.reduce<Photo | undefined>((best, p) => (!best || scorePhoto(p) > scorePhoto(best) ? p : best), undefined);
    const rejectedCount = photos.length - usable.length;
    return {
        orderedIds: sorted.map(p => p.id),
        coverId: cover?.id,
        summary: {
            keeperCount: sorted.length,
            pageCount: sorted.length,
            strategy: 'Ordonné par date, 1 photo par page (pleine page). Couverture = mieux notée.',
            reasons: cover ? { [cover.id]: 'Choisie comme couverture (meilleure note).' } : undefined,
        },
    };
}

function toLayoutMap(photos: Photo[]): Map<string, LayoutPhoto> {
    return new Map(photos.map(p => [p.id, p as unknown as LayoutPhoto]));
}

interface AlbumState {
    albums: Album[];
    activeAlbum: Album | null;
    pages: AlbumPage[];
    photosById: Map<string, LayoutPhoto>;
    settings: AlbumSettings;
    summary: AlbumBuildSummary | null;
    progress: AlbumProgress | null;
    busy: 'idle' | 'building' | 'exporting';
    lastExport: AlbumExportResult | null;

    loadAlbums: () => Promise<void>;
    buildFromSelection: (name: string, format: PageFormat, targetType: AlbumTargetType, theme?: string) => Promise<string | null>;
    openAlbum: (id: string) => Promise<void>;
    closeAlbum: () => void;
    deleteAlbum: (id: string) => Promise<void>;
    removePage: (pageId: string) => Promise<void>;
    movePage: (from: number, to: number) => Promise<void>;
    regenerate: (density: 'minimal' | 'balanced' | 'dense') => Promise<void>;
    togglePin: (pageId: string, photoId: string) => Promise<void>;
    setProgress: (p: AlbumProgress | null) => void;
    exportActive: (mode: 'book' | 'slideshow') => Promise<AlbumExportResult | null>;
    clearLastExport: () => void;
}

export const useAlbumStore = create<AlbumState>((set, get) => ({
    albums: [],
    activeAlbum: null,
    pages: [],
    photosById: new Map(),
    settings: { ...DEFAULT_ALBUM_SETTINGS },
    summary: null,
    progress: null,
    busy: 'idle',
    lastExport: null,

    loadAlbums: async () => {
        const albums = await window.api.getAlbums();
        set({ albums });
    },

    buildFromSelection: async (name, format, targetType, theme = 'all') => {
        // Read selection/photos ONCE from the grid store (no selectPhoto side-effects).
        const { photos, selectedPhotoIds } = useCatalogStore.getState();
        const pool = selectedPhotoIds.size > 0 ? photos.filter(p => selectedPhotoIds.has(p.id)) : photos;
        if (pool.length === 0) return null;

        set({ busy: 'building', progress: { phase: 'curate', message: 'Sélection des photos…' } });
        const settings = { ...DEFAULT_ALBUM_SETTINGS };
        const density = settings.density || 'balanced';
        const photoMap = toLayoutMap(pool);

        // Ask the local-AI agent (main process) to curate; fall back to the simple
        // deterministic ranker if it's unavailable.
        let orderedIds: string[] = [];
        let coverId: string | undefined;
        let heroIds = new Set<string>();
        let focals: Record<string, { x: number; y: number }> = {};
        let summary: AlbumBuildSummary;
        let agentExtra: any = null;
        try {
            const r = await window.api.autoCurateAlbum({ seedIds: pool.map(p => p.id), density, theme });
            if (r && Array.isArray(r.orderedIds) && r.orderedIds.length) {
                orderedIds = r.orderedIds;
                coverId = r.coverId || undefined;
                heroIds = new Set<string>(r.heroIds || []);
                focals = r.focals || {};
                agentExtra = { ...r.summary, reasons: r.reasons, rejects: r.rejects };
                summary = { keeperCount: r.summary.keeperCount, pageCount: 0, strategy: r.summary.strategy, reasons: r.reasons };
            } else {
                throw new Error('empty');
            }
        } catch {
            const det = curate(pool);
            orderedIds = det.orderedIds; coverId = det.coverId; summary = det.summary;
        }

        const keeperPhotos = orderedIds.map(id => photoMap.get(id)).filter((p): p is LayoutPhoto => !!p);
        const pages = orderedIds.length ? packPages(keeperPhotos, heroIds, density, focals) : fullBleedPages(orderedIds);
        summary = { ...summary, pageCount: pages.length };

        const albumId = await window.api.createAlbum({
            name,
            page_format: format,
            target_type: targetType,
            cover_photo_id: coverId,
            settings,
            agent_summary: JSON.stringify({ ...summary, agent: agentExtra }),
        });
        await window.api.saveAlbumPages(albumId, pages);

        // Reload pages from DB so working copy has the generated page ids.
        const savedPages = await window.api.getAlbumPages(albumId);
        await get().loadAlbums();
        const album = (get().albums.find(a => a.id === albumId)) || null;

        set({
            activeAlbum: album,
            pages: savedPages,
            photosById: photoMap,
            settings,
            summary,
            busy: 'idle',
            progress: null,
        });
        return albumId;
    },

    openAlbum: async (id) => {
        const albums = get().albums.length ? get().albums : (await window.api.getAlbums());
        const album = albums.find(a => a.id === id) || null;
        const pages = await window.api.getAlbumPages(id);
        const ids = Array.from(new Set(pages.flatMap(p => p.photos.map(s => s.photo_id))));
        const photos = ids.length ? await window.api.getPhotosByIds(ids) : [];
        set({
            albums,
            activeAlbum: album,
            pages,
            photosById: new Map(photos.map((p: any) => [p.id, p as LayoutPhoto])),
            settings: album?.settings || { ...DEFAULT_ALBUM_SETTINGS },
            summary: album?.agent_summary ? safeParse(album.agent_summary) : null,
        });
    },

    closeAlbum: () => set({ activeAlbum: null, pages: [], photosById: new Map(), summary: null }),

    deleteAlbum: async (id) => {
        await window.api.deleteAlbum(id);
        if (get().activeAlbum?.id === id) get().closeAlbum();
        await get().loadAlbums();
    },

    removePage: async (pageId) => {
        const album = get().activeAlbum;
        if (!album) return;
        const pages = get().pages.filter(p => p.id !== pageId).map((p, i) => ({ ...p, page_index: i }));
        set({ pages });
        await window.api.saveAlbumPages(album.id, pages);
    },

    movePage: async (from, to) => {
        const album = get().activeAlbum;
        if (!album) return;
        const pages = [...get().pages];
        if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return;
        const [moved] = pages.splice(from, 1);
        pages.splice(to, 0, moved);
        const reindexed = pages.map((p, i) => ({ ...p, page_index: i }));
        set({ pages: reindexed });
        await window.api.saveAlbumPages(album.id, reindexed);
    },

    setProgress: (p) => set({ progress: p }),

    // Re-run the agent on the album's current photos with a new density, keeping
    // pinned photos featured (forced heroes). Mostly re-flows the layout.
    regenerate: async (density) => {
        const { activeAlbum, pages, photosById } = get();
        if (!activeAlbum) return;
        const currentIds = Array.from(new Set(pages.flatMap(p => p.photos.map(s => s.photo_id))));
        const pinnedIds = new Set(pages.flatMap(p => p.photos.filter(s => s.crop_data?.pinned).map(s => s.photo_id)));
        if (currentIds.length === 0) return;

        set({ busy: 'building', progress: { phase: 'curate', message: 'Régénération…' } });
        let orderedIds = currentIds;
        let heroIds = new Set<string>(pinnedIds);
        let focals: Record<string, { x: number; y: number }> = {};
        try {
            const r = await window.api.autoCurateAlbum({ seedIds: currentIds, density });
            if (r && Array.isArray(r.orderedIds) && r.orderedIds.length) {
                orderedIds = r.orderedIds;
                heroIds = new Set<string>([...(r.heroIds || []), ...pinnedIds]);
                focals = r.focals || {};
            }
        } catch { /* keep current order */ }

        // ensure pinned photos survive and lead
        const missing = [...pinnedIds].filter(id => !orderedIds.includes(id));
        orderedIds = [...missing, ...orderedIds];

        const keeperPhotos = orderedIds.map(id => photosById.get(id)).filter((p): p is LayoutPhoto => !!p);
        const newPages = packPages(keeperPhotos, heroIds, density, focals);
        for (const pg of newPages) {
            for (const s of pg.photos) {
                if (pinnedIds.has(s.photo_id)) s.crop_data = { ...(s.crop_data || {}), pinned: true };
            }
        }
        const settings = { ...get().settings, density };
        await window.api.saveAlbumPages(activeAlbum.id, newPages);
        await window.api.updateAlbum(activeAlbum.id, { settings });
        const saved = await window.api.getAlbumPages(activeAlbum.id);
        set({ pages: saved, settings, busy: 'idle', progress: null });
    },

    togglePin: async (pageId, photoId) => {
        const { activeAlbum, pages } = get();
        if (!activeAlbum) return;
        const newPages = pages.map(p => p.id === pageId
            ? { ...p, photos: p.photos.map(s => s.photo_id === photoId
                ? { ...s, crop_data: { ...(s.crop_data || {}), pinned: !s.crop_data?.pinned } }
                : s) }
            : p);
        set({ pages: newPages });
        await window.api.saveAlbumPages(activeAlbum.id, newPages);
    },

    exportActive: async (mode) => {
        const { activeAlbum, pages, photosById, settings } = get();
        if (!activeAlbum || pages.length === 0) return null;

        const suggestedName = `${activeAlbum.name}${mode === 'slideshow' ? '-diaporama' : ''}.pdf`;
        const savePath = await window.api.saveFile({
            title: mode === 'slideshow' ? 'Exporter le diaporama' : 'Exporter le livre PDF',
            defaultPath: suggestedName,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!savePath) return null;

        // Ensure the render spec has full photo rows (file_path/preview_path/is_raw).
        let photoMap = photosById;
        const missing = Array.from(new Set(pages.flatMap(p => p.photos.map(s => s.photo_id)))).filter(id => !photoMap.has(id));
        if (missing.length) {
            const fetched = await window.api.getPhotosByIds(missing);
            photoMap = new Map(photoMap);
            fetched.forEach((p: any) => photoMap.set(p.id, p as LayoutPhoto));
        }

        const albumForSpec = { page_format: activeAlbum.page_format, target_type: (mode === 'slideshow' ? 'slideshow' : 'book') as AlbumTargetType };
        const spec = buildRenderSpec(albumForSpec, pages, photoMap, settings);

        set({ busy: 'exporting', progress: { phase: 'resample', current: 0, total: pages.length }, lastExport: null });
        const result = mode === 'slideshow'
            ? await window.api.exportAlbumSlideshow(spec, savePath)
            : await window.api.exportAlbumPdf(spec, savePath);
        set({ busy: 'idle', progress: null, lastExport: result });
        return result;
    },

    clearLastExport: () => set({ lastExport: null }),
}));

function safeParse(s: string): any {
    try { return JSON.parse(s); } catch { return null; }
}
