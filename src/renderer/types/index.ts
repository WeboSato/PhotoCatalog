export interface Photo {
    id: string;
    file_path: string;
    file_name: string;
    file_size?: number;
    file_type?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    orientation?: number;
    date_taken?: string;
    date_imported?: string;
    date_modified?: string;
    camera_make?: string;
    camera_model?: string;
    lens_model?: string;
    focal_length?: number;
    aperture?: number;
    shutter_speed?: string;
    iso?: number;
    flash_used?: number;
    gps_latitude?: number;
    gps_longitude?: number;
    gps_altitude?: number;
    rating: number;
    flag: 'none' | 'picked' | 'rejected';
    color_label: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
    title?: string;
    caption?: string;
    copyright?: string;
    creator?: string;
    is_raw: boolean;
    raw_type?: string;
    thumbnail_path?: string;
    preview_path?: string;
    keywords?: string[];
    indexed: boolean;
}

export interface Collection {
    id: string;
    name: string;
    description?: string;
    parent_id?: string;
    is_smart: boolean;
    smart_criteria?: object;
    sort_order: number;
    cover_photo_id?: string;
    photo_count?: number;
}

export interface Keyword {
    id: string;
    name: string;
    parent_id?: string;
    synonyms?: string[];
    include_on_export: boolean;
    photo_count?: number;
}

export interface Folder {
    id: string;
    path: string;
    name: string;
    parent_id?: string;
    is_watched: boolean;
    photo_count: number;
}

export interface FilterCriteria {
    rating?: { min?: number; max?: number };
    flag?: ('none' | 'picked' | 'rejected')[];
    color_label?: ('none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple')[];
    date_range?: { start?: string; end?: string };
    camera_model?: string[];
    is_raw?: boolean;
    keywords?: string[];
    search_text?: string;
    collection_id?: string;
    folder_path?: string;
}

export interface ImportProgress {
    phase: 'scanning' | 'importing' | 'thumbnails' | 'complete' | 'error';
    current: number;
    total: number;
    currentFile?: string;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    errors?: string[];
}

export interface ImportResult {
    success: boolean;
    importedIds: string[];
    skippedFiles: string[];
    errors: { file: string; error: string }[];
    totalProcessed: number;
    duration: number;
}

export interface ExternalEditor {
    id: string;
    name: string;
    path: string;
    icon?: string;
    isDefault?: boolean;
    isInstalled: boolean;
}

export interface CatalogStatistics {
    totalPhotos: number;
    totalRaw: number;
    totalCollections: number;
    totalKeywords: number;
    ratingDistribution: Record<number, number>;
    cameraModels: { model: string; count: number }[];
    dateDistribution: { month: string; count: number }[];
}

export type ViewMode = 'grid' | 'loupe' | 'survey' | 'map' | 'develop';
export type SortBy = 'date_taken' | 'date_imported' | 'file_name' | 'rating';
export type SortOrder = 'asc' | 'desc';

export const COLOR_LABELS = {
    none: { name: 'None', color: '#666666' },
    red: { name: 'Red', color: '#ef4444' },
    yellow: { name: 'Yellow', color: '#eab308' },
    green: { name: 'Green', color: '#22c55e' },
    blue: { name: 'Blue', color: '#3b82f6' },
    purple: { name: 'Purple', color: '#a855f7' }
} as const;

export const FLAGS = {
    none: { name: 'Unflagged', icon: 'flag-off' },
    picked: { name: 'Picked', icon: 'flag' },
    rejected: { name: 'Rejected', icon: 'x' }
} as const;
