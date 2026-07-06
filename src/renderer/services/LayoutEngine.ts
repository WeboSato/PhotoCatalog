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
