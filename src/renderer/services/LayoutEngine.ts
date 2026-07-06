// Pure layout math shared by the on-screen canvas and the export pipeline, so
// what you preview is what prints (WYSIWYG). No image decoding here.

import {
    PAGE_FORMATS, SLIDESHOW_SPEC, PageFormat,
    AlbumPage, AlbumRenderSpec, AlbumRenderPage, AlbumSettings, Album
} from '../../shared/albumTypes';

const MM_PER_IN = 25.4;

export { PAGE_FORMATS, SLIDESHOW_SPEC };

// Minimal photo shape the layout/export needs (superset lives in the store).
export interface LayoutPhoto {
    id: string;
    file_path: string;
    preview_path?: string;
    thumbnail_path?: string;
    is_raw?: boolean | number;
    width?: number;
    height?: number;
    orientation?: number;
}

/** Effective on-screen aspect (w/h), honoring EXIF orientation swaps. */
export function effectiveAspect(p: LayoutPhoto): number {
    const w = p.width || 1;
    const h = p.height || 1;
    const swap = p.orientation && [5, 6, 7, 8].includes(p.orientation);
    return swap ? h / w : w / h;
}

/** One photo per page, full-bleed. Works for any page aspect (portrait or square). */
export function fullBleedPages(photoIds: string[]): AlbumPage[] {
    return photoIds.map((photoId, i) => ({
        id: '',
        album_id: '',
        page_index: i,
        page_kind: 'photo',
        layout_template: 'full-bleed-1',
        layout_data: { slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
        photos: [{ photo_id: photoId, slot_index: 0 }],
    }));
}

// ---- Multi-photo layout templates (rects within the trim box, gutter between) ----
const G = 0.02; // gutter between photos (outer edges stay at 0/1 for bleed)

function tplFull(): { x: number; y: number; w: number; h: number }[] {
    return [{ x: 0, y: 0, w: 1, h: 1 }];
}
function tpl2Cols() {
    const w = (1 - G) / 2;
    return [{ x: 0, y: 0, w, h: 1 }, { x: (1 + G) / 2, y: 0, w, h: 1 }];
}
function tpl2Rows() {
    const h = (1 - G) / 2;
    return [{ x: 0, y: 0, w: 1, h }, { x: 0, y: (1 + G) / 2, w: 1, h }];
}
function tpl3HeroLeft() {
    const leftW = 0.62;
    const rightX = leftW + G, rightW = 1 - rightX, rh = (1 - G) / 2;
    return [
        { x: 0, y: 0, w: leftW, h: 1 },
        { x: rightX, y: 0, w: rightW, h: rh },
        { x: rightX, y: (1 + G) / 2, w: rightW, h: rh },
    ];
}
function tpl4Grid() {
    const w = (1 - G) / 2, h = (1 - G) / 2, s = (1 + G) / 2;
    return [
        { x: 0, y: 0, w, h }, { x: s, y: 0, w, h },
        { x: 0, y: s, w, h }, { x: s, y: s, w, h },
    ];
}

function chooseTemplate(group: LayoutPhoto[]) {
    const n = group.length;
    if (n <= 1) return { template: 'full-bleed-1', slots: tplFull() };
    if (n === 2) {
        const portraits = group.filter(p => effectiveAspect(p) < 1).length;
        return portraits >= 1 ? { template: 'grid-2-cols', slots: tpl2Cols() } : { template: 'grid-2-rows', slots: tpl2Rows() };
    }
    if (n === 3) return { template: 'hero-3', slots: tpl3HeroLeft() };
    return { template: 'grid-4', slots: tpl4Grid() };
}

/**
 * Pack ordered photos into multi-photo pages. Heroes get a full-bleed page; the
 * rest are grouped (2–4 per page by density) with an aspect-aware template.
 */
export function packPages(
    photos: LayoutPhoto[],
    heroIds: Set<string>,
    density: 'minimal' | 'balanced' | 'dense' = 'balanced'
): AlbumPage[] {
    const groupMax = density === 'minimal' ? 1 : density === 'dense' ? 4 : 2;
    const pages: AlbumPage[] = [];
    let i = 0;
    const push = (template: string, slots: any[], group: LayoutPhoto[]) => {
        pages.push({
            id: '', album_id: '', page_index: pages.length, page_kind: 'photo',
            layout_template: template, layout_data: { slots },
            photos: group.map((p, idx) => ({ photo_id: p.id, slot_index: idx })),
        });
    };

    while (i < photos.length) {
        const p = photos[i];
        if (groupMax === 1 || heroIds.has(p.id)) {
            push('full-bleed-1', tplFull(), [p]);
            i += 1;
            continue;
        }
        // gather a group, but stop before the next hero
        const group: LayoutPhoto[] = [];
        for (let k = 0; k < groupMax && i + k < photos.length; k++) {
            const q = photos[i + k];
            if (k > 0 && heroIds.has(q.id)) break;
            group.push(q);
        }
        if (group.length === 1) { push('full-bleed-1', tplFull(), group); i += 1; continue; }
        const { template, slots } = chooseTemplate(group);
        push(template, slots, group);
        i += group.length;
    }
    return pages;
}

// Extensions sharp/libvips can actually decode. Everything else (RAW, PSD,
// Affinity, etc.) must fall back to the generated 2048px webp preview — the
// `is_raw` DB flag is unreliable (e.g. .psd and .NEF are stored as is_raw=0).
const SHARP_DECODABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'heic', 'heif']);

/** Pick the highest-resolution source sharp can actually decode for print. */
export function pickSourcePath(p: LayoutPhoto): { sourcePath: string; isRaw: boolean } {
    const ext = (p.file_path.split('.').pop() || '').toLowerCase();
    if (SHARP_DECODABLE.has(ext)) {
        return { sourcePath: p.file_path, isRaw: false };
    }
    // Not directly decodable — use the preview (webp, always decodable). Flag as
    // "raw" so the export honesty-gate knows this source is capped at ~2048px.
    return { sourcePath: p.preview_path || p.thumbnail_path || p.file_path, isRaw: true };
}

/**
 * Build the pure-JSON render spec handed to the main process for PDF export.
 * `photosById` must contain full rows (file_path/preview_path/is_raw) for every
 * placed photo — fetch via window.api.getPhotosByIds().
 */
export function buildRenderSpec(
    album: Pick<Album, 'page_format' | 'target_type'>,
    pages: AlbumPage[],
    photosById: Map<string, LayoutPhoto>,
    settings: AlbumSettings
): AlbumRenderSpec {
    const slideshow = album.target_type === 'slideshow';
    const geom = slideshow ? SLIDESHOW_SPEC : PAGE_FORMATS[album.page_format as PageFormat];
    const trimWmm = geom.trimInW * MM_PER_IN;
    const trimHmm = geom.trimInH * MM_PER_IN;

    const renderPages: AlbumRenderPage[] = pages.map(page => {
        const slots = page.layout_data.slots || [];
        const renderSlots = page.photos
            .map(sp => {
                const rect = slots[sp.slot_index] || { x: 0, y: 0, w: 1, h: 1 };
                const photo = photosById.get(sp.photo_id);
                if (!photo) return null;
                const { sourcePath, isRaw } = pickSourcePath(photo);
                return {
                    sourcePath,
                    isRaw,
                    cropData: sp.crop_data,
                    slotWidthMm: rect.w * trimWmm,
                    slotHeightMm: rect.h * trimHmm,
                    rect,
                };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
        return {
            index: page.page_index,
            kind: page.page_kind,
            bg: page.layout_data.bg,
            caption: page.layout_data.caption,
            slots: renderSlots,
        };
    });

    return {
        pageFormat: album.page_format as PageFormat,
        targetType: album.target_type,
        trimInW: geom.trimInW,
        trimInH: geom.trimInH,
        bleedMm: slideshow ? 0 : settings.bleedMm,
        dpi: slideshow ? 96 : settings.dpi,
        cropMarks: slideshow ? false : settings.cropMarks,
        backgroundColor: settings.backgroundColor,
        pages: renderPages,
    };
}
