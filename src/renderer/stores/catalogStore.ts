import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface Photo {
    id: string;
    file_path: string;
    file_name: string;
    file_size?: number;
    file_type?: string;
    width?: number;
    height?: number;
    date_taken?: string;
    date_imported?: string;
    camera_make?: string;
    camera_model?: string;
    lens_model?: string;
    focal_length?: number;
    aperture?: number;
    shutter_speed?: string;
    iso?: number;
    gps_latitude?: number;
    gps_longitude?: number;
    rating: number;
    flag: 'none' | 'picked' | 'rejected';
    color_label: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
    title?: string;
    caption?: string;
    is_raw: boolean;
    thumbnail_path?: string;
    preview_path?: string;
    edit_copy_path?: string;  // Path to external edit copy
    develop_settings?: string; // JSON string of DevelopmentSettings
}

export interface Collection {
    id: string;
    name: string;
    description?: string;
    photo_count?: number;
    is_smart: boolean;
}

export interface Keyword {
    id: string;
    name: string;
    photo_count?: number;
}

export interface Folder {
    id: string;
    path: string;
    name: string;
    photo_count: number;
}

export interface FilterCriteria {
    rating?: { min?: number; max?: number };
    flag?: ('none' | 'picked' | 'rejected')[];
    color_label?: ('none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple')[];
    is_raw?: boolean;
    has_affinity_edit?: boolean;
    affinity_date?: string; // Format: YYYY-MM-DD
    search_text?: string;
}

export type ViewMode = 'grid' | 'loupe' | 'survey' | 'map' | 'develop';
export type SortBy = 'date_taken' | 'date_imported' | 'file_name' | 'rating';
export type SortOrder = 'asc' | 'desc';

// Navigation history entry
export interface NavigationState {
    viewMode: ViewMode;
    activePhotoId: string | null;
    activeCollectionId: string | null;
    activeFolderId: string | null;
    filters: FilterCriteria;
}

// Edit history entry for a photo
export interface EditHistoryEntry {
    id: string;
    photoId: string;
    action: string;  // e.g., "Rating changed to 5", "Flag set to picked"
    timestamp: Date;
    previousValue?: any;
    newValue?: any;
    // Snapshot of development settings at this point (for undo)
    devSettingsSnapshot?: DevelopmentSettings;
}

// Development settings for image adjustments
export interface DevelopmentSettings {
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    clarity: number;
    vibrance: number;
    saturation: number;
    temperature: number;
    tint: number;
}

export const defaultDevelopmentSettings: DevelopmentSettings = {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    clarity: 0,
    vibrance: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
};

interface CatalogState {
    // Photos
    photos: Photo[];
    selectedPhotoIds: Set<string>;
    activePhotoId: string | null;
    totalPhotoCount: number;
    isLoading: boolean;

    // Collections & Keywords
    collections: Collection[];
    keywords: Keyword[];
    folders: Folder[];
    activeCollectionId: string | null;
    activeFolderId: string | null;

    // View settings
    viewMode: ViewMode;
    gridSize: number;
    sortBy: SortBy;
    sortOrder: SortOrder;

    // Filters
    filters: FilterCriteria;

    // Import
    isImporting: boolean;
    importProgress: {
        phase: string;
        current: number;
        total: number;
        currentFile?: string;
    } | null;

    // Sidebar
    sidebarCollapsed: boolean;
    rightPanelCollapsed: boolean;

    // Loupe view state (shared with sidebars)
    loupeZoom: number;
    loupeOffset: { x: number; y: number };
    loupeContainerSize: { width: number; height: number };
    loupeImageDimensions: { width: number; height: number };

    // Navigation history (for back navigation with ESC)
    navigationHistory: NavigationState[];

    // Edit history per photo (for undo and history panel)
    editHistory: EditHistoryEntry[];

    // Development settings per photo (Map of photoId -> settings)
    photoDevSettings: Map<string, DevelopmentSettings>;

    // Development settings for current photo (derived from photoDevSettings)
    developmentSettings: DevelopmentSettings;

    // Actions
    setPhotos: (photos: Photo[]) => void;
    addPhotos: (photos: Photo[]) => void;
    updatePhoto: (id: string, updates: Partial<Photo>) => void;
    removePhotos: (ids: string[]) => void;

    setSelectedPhotoIds: (ids: Set<string>) => void;
    togglePhotoSelection: (id: string) => void;
    selectPhoto: (id: string, multi?: boolean, range?: boolean) => void;
    selectAll: () => void;
    deselectAll: () => void;
    setActivePhotoId: (id: string | null) => void;

    setCollections: (collections: Collection[]) => void;
    setKeywords: (keywords: Keyword[]) => void;
    setFolders: (folders: Folder[]) => void;
    setActiveCollectionId: (id: string | null) => void;
    setActiveFolderId: (id: string | null) => void;

    setViewMode: (mode: ViewMode) => void;
    setGridSize: (size: number) => void;
    setSortBy: (sortBy: SortBy) => void;
    setSortOrder: (order: SortOrder) => void;

    setFilters: (filters: FilterCriteria) => void;
    clearFilters: () => void;

    setIsLoading: (loading: boolean) => void;
    setTotalPhotoCount: (count: number) => void;

    setIsImporting: (importing: boolean) => void;
    setImportProgress: (progress: CatalogState['importProgress']) => void;

    toggleSidebar: () => void;
    toggleRightPanel: () => void;

    // Loupe state setters
    setLoupeZoom: (zoom: number) => void;
    setLoupeOffset: (offset: { x: number; y: number }) => void;
    setLoupeContainerSize: (size: { width: number; height: number }) => void;
    setLoupeImageDimensions: (dims: { width: number; height: number }) => void;

    // Navigation history
    pushNavigation: () => void;  // Save current state before navigating
    goBack: () => boolean;  // Go back to previous state, returns true if successful

    // Edit history
    addEditHistory: (photoId: string, action: string, previousValue?: any, newValue?: any, devSnapshot?: DevelopmentSettings) => void;
    getPhotoEditHistory: (photoId: string) => EditHistoryEntry[];
    clearPhotoEditHistory: (photoId: string) => void;
    restoreFromHistory: (historyEntry: EditHistoryEntry) => void;

    // Bulk operations on selected
    setSelectedRating: (rating: number) => void;
    setSelectedFlag: (flag: 'none' | 'picked' | 'rejected') => void;
    setSelectedColorLabel: (color: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple') => void;

    // Development settings
    setDevelopmentSettings: (settings: DevelopmentSettings) => void;
    updateDevelopmentSetting: (key: keyof DevelopmentSettings, value: number) => void;
    resetDevelopmentSettings: () => void;
}

export const useCatalogStore = create<CatalogState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    photos: [],
    selectedPhotoIds: new Set(),
    activePhotoId: null,
    totalPhotoCount: 0,
    isLoading: false,

    collections: [],
    keywords: [],
    folders: [],
    activeCollectionId: null,
    activeFolderId: null,

    viewMode: 'grid',
    gridSize: 200,
    sortBy: 'date_taken',
    sortOrder: 'desc',

    filters: {},

    isImporting: false,
    importProgress: null,

    sidebarCollapsed: false,
    rightPanelCollapsed: true,

    // Loupe state
    loupeZoom: 1,
    loupeOffset: { x: 0, y: 0 },
    loupeContainerSize: { width: 0, height: 0 },
    loupeImageDimensions: { width: 0, height: 0 },

    navigationHistory: [],
    editHistory: [],
    photoDevSettings: new Map(),
    developmentSettings: defaultDevelopmentSettings,

    // Photo actions
    setPhotos: (photos) => set({ photos }),
    addPhotos: (newPhotos) => set((state) => ({ photos: [...state.photos, ...newPhotos] })),
    updatePhoto: (id, updates) => set((state) => ({
        photos: state.photos.map((p) => (p.id === id ? { ...p, ...updates } : p))
    })),
    removePhotos: (ids) => set((state) => ({
        photos: state.photos.filter((p) => !ids.includes(p.id)),
        selectedPhotoIds: new Set([...state.selectedPhotoIds].filter((id) => !ids.includes(id)))
    })),

    // Selection actions
    setSelectedPhotoIds: (ids) => set({ selectedPhotoIds: ids }),
    togglePhotoSelection: (id) => set((state) => {
        const newSet = new Set(state.selectedPhotoIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        return { selectedPhotoIds: newSet };
    }),
    selectPhoto: (id, multi = false, range = false) => set((state) => {
        if (range && state.activePhotoId) {
            // Range selection
            const photos = state.photos;
            const activeIndex = photos.findIndex((p) => p.id === state.activePhotoId);
            const clickIndex = photos.findIndex((p) => p.id === id);
            if (activeIndex !== -1 && clickIndex !== -1) {
                const start = Math.min(activeIndex, clickIndex);
                const end = Math.max(activeIndex, clickIndex);
                const rangeIds = photos.slice(start, end + 1).map((p) => p.id);
                return {
                    selectedPhotoIds: new Set([...state.selectedPhotoIds, ...rangeIds]),
                    activePhotoId: id
                };
            }
        }

        if (multi) {
            const newSet = new Set(state.selectedPhotoIds);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            // Auto-open right panel when selecting a photo
            return { selectedPhotoIds: newSet, activePhotoId: id, rightPanelCollapsed: false };
        }

        // Auto-open right panel when selecting a photo
        return { selectedPhotoIds: new Set([id]), activePhotoId: id, rightPanelCollapsed: false };
    }),
    selectAll: () => set((state) => ({
        selectedPhotoIds: new Set(state.photos.map((p) => p.id))
    })),
    deselectAll: () => set({ selectedPhotoIds: new Set() }),
    setActivePhotoId: (id) => {
        const state = get();
        let photoSettings: DevelopmentSettings | null = null;

        if (id) {
            // First check the in-memory cache
            photoSettings = state.photoDevSettings.get(id) || null;

            // If not in cache, try to load from the photo object (from DB)
            if (!photoSettings) {
                const photo = state.photos.find(p => p.id === id);
                if (photo && photo.develop_settings) {
                    try {
                        const parsed = typeof photo.develop_settings === 'string'
                            ? JSON.parse(photo.develop_settings)
                            : photo.develop_settings;
                        photoSettings = { ...defaultDevelopmentSettings, ...parsed };
                        // Cache it
                        const newPhotoDevSettings = new Map(state.photoDevSettings);
                        newPhotoDevSettings.set(id, photoSettings);
                        set({
                            activePhotoId: id,
                            developmentSettings: photoSettings,
                            photoDevSettings: newPhotoDevSettings
                        });
                        return;
                    } catch (e) {
                        console.error('[Store] Failed to parse develop_settings:', e);
                    }
                }
            }
        }

        set({
            activePhotoId: id,
            developmentSettings: photoSettings || defaultDevelopmentSettings
        });
    },

    // Collection/Keyword/Folder actions
    setCollections: (collections) => set({ collections }),
    setKeywords: (keywords) => set({ keywords }),
    setFolders: (folders) => set({ folders }),
    setActiveCollectionId: (id) => set({ activeCollectionId: id, activeFolderId: null }),
    setActiveFolderId: (id) => set({ activeFolderId: id, activeCollectionId: null }),

    // View actions
    setViewMode: (mode) => set({ viewMode: mode }),
    setGridSize: (size) => set({ gridSize: Math.max(80, Math.min(600, size)) }),
    setSortBy: (sortBy) => set({ sortBy }),
    setSortOrder: (order) => set({ sortOrder }),

    // Filter actions
    setFilters: (filters) => set({ filters }),
    clearFilters: () => set({ filters: {} }),

    // Loading state
    setIsLoading: (loading) => set({ isLoading: loading }),
    setTotalPhotoCount: (count) => set({ totalPhotoCount: count }),

    // Import state
    setIsImporting: (importing) => set({ isImporting: importing }),
    setImportProgress: (progress) => set({ importProgress: progress }),

    // Panel toggles
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    toggleRightPanel: () => set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

    // Loupe state setters
    setLoupeZoom: (zoom) => set({ loupeZoom: zoom }),
    setLoupeOffset: (offset) => set({ loupeOffset: offset }),
    setLoupeContainerSize: (size) => set({ loupeContainerSize: size }),
    setLoupeImageDimensions: (dims) => set({ loupeImageDimensions: dims }),

    // Navigation history
    pushNavigation: () => {
        const state = get();
        const currentState: NavigationState = {
            viewMode: state.viewMode,
            activePhotoId: state.activePhotoId,
            activeCollectionId: state.activeCollectionId,
            activeFolderId: state.activeFolderId,
            filters: { ...state.filters }
        };
        set((s) => ({
            navigationHistory: [...s.navigationHistory.slice(-20), currentState]  // Keep last 20 states
        }));
    },
    goBack: () => {
        const state = get();
        if (state.navigationHistory.length === 0) return false;

        const history = [...state.navigationHistory];
        const previousState = history.pop()!;

        set({
            navigationHistory: history,
            viewMode: previousState.viewMode,
            activePhotoId: previousState.activePhotoId,
            activeCollectionId: previousState.activeCollectionId,
            activeFolderId: previousState.activeFolderId,
            filters: previousState.filters
        });
        return true;
    },

    // Edit history
    addEditHistory: (photoId, action, previousValue, newValue, devSnapshot?: DevelopmentSettings) => {
        const entry: EditHistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            photoId,
            action,
            timestamp: new Date(),
            previousValue,
            newValue,
            // Snapshot of dev settings BEFORE the change (for undo)
            devSettingsSnapshot: devSnapshot ? { ...devSnapshot } : undefined
        };
        set((s) => ({
            editHistory: [...s.editHistory.slice(-500), entry]  // Keep last 500 entries
        }));
    },
    getPhotoEditHistory: (photoId) => {
        return get().editHistory.filter(e => e.photoId === photoId);
    },
    clearPhotoEditHistory: (photoId) => {
        set((state) => ({
            editHistory: state.editHistory.filter(e => e.photoId !== photoId)
        }));
    },
    restoreFromHistory: (historyEntry) => {
        const state = get();
        if (!historyEntry.devSettingsSnapshot) return;

        // Restore development settings from snapshot
        const newSettings = { ...historyEntry.devSettingsSnapshot };

        // Update photoDevSettings map
        const newPhotoDevSettings = new Map(state.photoDevSettings);
        newPhotoDevSettings.set(historyEntry.photoId, newSettings);

        // Save to database
        window.api.updatePhoto(historyEntry.photoId, { develop_settings: JSON.stringify(newSettings) });

        // Update the photo in local photos array
        set((s) => ({
            developmentSettings: newSettings,
            photoDevSettings: newPhotoDevSettings,
            photos: s.photos.map(p => p.id === historyEntry.photoId ? { ...p, develop_settings: JSON.stringify(newSettings) } : p)
        }));
    },

    // Bulk operations
    setSelectedRating: (rating) => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        // Get previous values for history
        const previousValues = new Map(
            state.photos.filter(p => ids.includes(p.id)).map(p => [p.id, p.rating])
        );

        window.api.bulkUpdateRating(ids, rating).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) =>
                    ids.includes(p.id) ? { ...p, rating } : p
                )
            }));
            // Add to edit history
            ids.forEach(id => {
                addEditHistory(id, `Rating → ${rating} ★`, previousValues.get(id), rating);
            });
        });
    },
    setSelectedFlag: (flag) => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        const previousValues = new Map(
            state.photos.filter(p => ids.includes(p.id)).map(p => [p.id, p.flag])
        );

        const flagLabels = { none: 'None', picked: 'Picked ✓', rejected: 'Rejected ✗' };

        window.api.bulkUpdateFlag(ids, flag).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) =>
                    ids.includes(p.id) ? { ...p, flag } : p
                )
            }));
            ids.forEach(id => {
                addEditHistory(id, `Flag → ${flagLabels[flag]}`, previousValues.get(id), flag);
            });
        });
    },
    setSelectedColorLabel: (color) => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        const previousValues = new Map(
            state.photos.filter(p => ids.includes(p.id)).map(p => [p.id, p.color_label])
        );

        const colorLabels: Record<string, string> = {
            none: 'None', red: 'Red 🔴', yellow: 'Yellow 🟡',
            green: 'Green 🟢', blue: 'Blue 🔵', purple: 'Purple 🟣'
        };

        window.api.bulkUpdateColorLabel(ids, color).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) =>
                    ids.includes(p.id) ? { ...p, color_label: color } : p
                )
            }));
            ids.forEach(id => {
                addEditHistory(id, `Color → ${colorLabels[color]}`, previousValues.get(id), color);
            });
        });
    },

    // Development settings
    setDevelopmentSettings: (settings) => {
        const state = get();
        const photoId = state.activePhotoId;
        if (photoId) {
            const newPhotoDevSettings = new Map(state.photoDevSettings);
            newPhotoDevSettings.set(photoId, settings);
            set({ developmentSettings: settings, photoDevSettings: newPhotoDevSettings });
        } else {
            set({ developmentSettings: settings });
        }
    },
    updateDevelopmentSetting: (key, value) => {
        const state = get();
        const photoId = state.activePhotoId;
        const previousValue = state.developmentSettings[key];

        // Don't add history if value hasn't changed
        if (previousValue === value) return;

        // Capture the PREVIOUS state before making changes
        const previousSettings = { ...state.developmentSettings };
        const newSettings = { ...state.developmentSettings, [key]: value };

        if (photoId) {
            const newPhotoDevSettings = new Map(state.photoDevSettings);
            newPhotoDevSettings.set(photoId, newSettings);

            // Add to history with snapshot of PREVIOUS state (before this change)
            const { addEditHistory } = get();
            const labelMap: Record<string, string> = {
                exposure: 'Exposition',
                contrast: 'Contraste',
                highlights: 'Hautes lumières',
                shadows: 'Ombres',
                whites: 'Blancs',
                blacks: 'Noirs',
                clarity: 'Clarté',
                vibrance: 'Vibrance',
                saturation: 'Saturation',
                temperature: 'Température',
                tint: 'Teinte'
            };
            addEditHistory(photoId, `${labelMap[key] || key} → ${value > 0 ? '+' : ''}${value}`, previousValue, value, previousSettings);

            // Save to database (debounced by caller if needed)
            window.api.updatePhoto(photoId, { develop_settings: JSON.stringify(newSettings) });

            // Update the photo in the local photos array with the new settings
            set((s) => ({
                developmentSettings: newSettings,
                photoDevSettings: newPhotoDevSettings,
                photos: s.photos.map(p => p.id === photoId ? { ...p, develop_settings: JSON.stringify(newSettings) } : p)
            }));
        } else {
            set({ developmentSettings: newSettings });
        }
    },
    resetDevelopmentSettings: () => {
        const state = get();
        const photoId = state.activePhotoId;
        if (photoId) {
            // Capture previous state before reset
            const previousSettings = { ...state.developmentSettings };
            const newPhotoDevSettings = new Map(state.photoDevSettings);
            newPhotoDevSettings.set(photoId, defaultDevelopmentSettings);

            const { addEditHistory } = get();
            addEditHistory(photoId, 'Réinitialisation', previousSettings, defaultDevelopmentSettings, previousSettings);

            // Save to database
            window.api.updatePhoto(photoId, { develop_settings: JSON.stringify(defaultDevelopmentSettings) });

            set((s) => ({
                developmentSettings: defaultDevelopmentSettings,
                photoDevSettings: newPhotoDevSettings,
                photos: s.photos.map(p => p.id === photoId ? { ...p, develop_settings: JSON.stringify(defaultDevelopmentSettings) } : p)
            }));
        } else {
            set({ developmentSettings: defaultDevelopmentSettings });
        }
    }
})));
