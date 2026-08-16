// Shared album / photo-book types used by BOTH the main process (Database,
// AlbumExportService, IPC handlers) and the renderer (albumStore, components,
// LayoutEngine). Kept in src/shared so both tsconfigs can resolve it.

export type PageFormat = '4x6' | '5x7' | '8x10' | 'sq20' | 'sq30';
export type AlbumTargetType = 'book' | 'slideshow';
export type PageKind = 'cover' | 'photo' | 'divider';

export interface AlbumSettings {
    bleedMm: number;
    dpi: number;
    cropMarks: boolean;
    backgroundColor: string;
    density?: 'minimal' | 'balanced' | 'dense';
    curationWeights?: Record<string, number>;
}

export interface Album {
    id: string;
    name: string;
    description?: string;
    page_format: PageFormat;
    target_type: AlbumTargetType;
    cover_photo_id?: string | null;
    settings?: AlbumSettings;
    agent_summary?: string; // JSON string of AlbumBuildSummary
    sort_order?: number;
    page_count?: number;
    created_at?: string;
    updated_at?: string;
}

// A normalized rectangle (0..1) inside the page trim box.
export interface SlotRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface CropData {
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    focalX?: number;
    focalY?: number;
    pinned?: boolean;
}

export interface AlbumSlotPhoto {
    photo_id: string;
    slot_index: number;
    crop_data?: CropData;
}

export interface AlbumPageLayout {
    slots: SlotRect[];
    bg?: string;
    caption?: string;
}

export interface AlbumPage {
    id: string;
    album_id: string;
    page_index: number;
    page_kind: PageKind;
    layout_template: string;
    layout_data: AlbumPageLayout;
    photos: AlbumSlotPhoto[];
}

// What the deterministic/agent curator reports back to the UI.
export interface AlbumBuildSummary {
    keeperCount: number;
    pageCount: number;
    strategy: string;
    reasons?: Record<string, string>; // photoId -> human reason
}

export interface AlbumBuildResult {
    pages: AlbumPage[];
    coverPhotoId?: string | null;
    summary: AlbumBuildSummary;
}

// Pure-JSON spec handed from renderer to main for export. No DOM, unit-testable.
export interface AlbumRenderSlot {
    sourcePath: string;   // absolute file path of the source image (original or preview)
    isRaw: boolean;
    cropData?: CropData;
    slotWidthMm: number;
    slotHeightMm: number;
    rect: SlotRect;       // position within the trim box (0..1)
}

export interface AlbumRenderPage {
    index: number;
    kind: PageKind;
    bg?: string;
    caption?: string;
    slots: AlbumRenderSlot[];
}

export interface AlbumRenderSpec {
    pageFormat: PageFormat;
    targetType: AlbumTargetType;
    trimInW: number;
    trimInH: number;
    bleedMm: number;
    dpi: number;
    cropMarks: boolean;
    backgroundColor: string;
    pages: AlbumRenderPage[];
}

export interface AlbumExportResult {
    ok: boolean;
    path?: string;
    warnings?: string[];
    error?: string;
}

export interface AlbumProgress {
    phase: 'scan' | 'curate' | 'resample' | 'render' | 'write' | 'done';
    message?: string;
    current?: number;
    total?: number;
}

// Physical page geometry. Inches drive printToPDF; aspect drives layout.
export interface PageFormatSpec {
    id: PageFormat;
    label: string;
    trimInW: number;
    trimInH: number;
    aspect: number; // trimInW / trimInH
    square: boolean;
}

export const PAGE_FORMATS: Record<PageFormat, PageFormatSpec> = {
    '4x6':  { id: '4x6',  label: '4×6 (10×15 cm)',  trimInW: 3.937,  trimInH: 5.906,  aspect: 3.937 / 5.906,  square: false },
    '5x7':  { id: '5x7',  label: '5×7 (13×18 cm)',  trimInW: 5.118,  trimInH: 7.087,  aspect: 5.118 / 7.087,  square: false },
    '8x10': { id: '8x10', label: '8×10 in',         trimInW: 8.0,    trimInH: 10.0,   aspect: 0.8,            square: false },
    'sq20': { id: 'sq20', label: 'Carré 20×20 cm',  trimInW: 7.874,  trimInH: 7.874,  aspect: 1,              square: true  },
    'sq30': { id: 'sq30', label: 'Carré 30×30 cm',  trimInW: 11.811, trimInH: 11.811, aspect: 1,              square: true  },
};

// 16:9 slideshow "page" (1280×720 @ 96dpi).
export const SLIDESHOW_SPEC = { trimInW: 13.333, trimInH: 7.5, aspect: 16 / 9 };

export const DEFAULT_ALBUM_SETTINGS: AlbumSettings = {
    bleedMm: 3,
    dpi: 300,
    cropMarks: false,
    backgroundColor: '#ffffff',
    density: 'balanced',
};
