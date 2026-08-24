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
    blur_hash?: string;
    edit_copy_path?: string;  // Path to external edit copy
    edited_from_id?: string;  // linked edit copy: id of the source photo
    updated_at?: string;      // bumped on every update; versions image URLs
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
    keywords?: string[];
}

export type ViewMode = 'grid' | 'loupe' | 'survey' | 'map' | 'develop' | 'aiface' | 'album';
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

    // Development settings per photo (Record for serialization + perf)
    photoDevSettings: Record<string, DevelopmentSettings>;

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

    // Copy/Move/Delete/Refresh operations
    copySelectedPhotos: () => Promise<void>;
    moveSelectedPhotos: () => Promise<void>;
    deleteSelectedPhotos: () => Promise<void>;
    refreshCatalog: () => Promise<void>;

    // Development settings
    setDevelopmentSettings: (settings: DevelopmentSettings) => void;
    updateDevelopmentSetting: (key: keyof DevelopmentSettings, value: number) => void;
    resetDevelopmentSettings: () => void;
}

// ---- Session restore --------------------------------------------------------
// Reopen exactly where the user left off (folder/collection, view, photo).
// Read synchronously so the very first render — and PhotoGrid's mount-time
// scroll-to-photo — start from the saved place.
const SESSION_KEY = 'photocatalog_session_v1';
const VIEW_MODES: ViewMode[] = ['grid', 'loupe', 'survey', 'map', 'develop', 'aiface', 'album'];
const loadSavedSession = (): { viewMode: ViewMode; activePhotoId: string | null; activeFolderId: string | null; activeCollectionId: string | null } => {
    const fallback = { viewMode: 'grid' as ViewMode, activePhotoId: null, activeFolderId: null, activeCollectionId: null };
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return fallback;
        const sess = JSON.parse(raw);
        return {
            viewMode: VIEW_MODES.includes(sess.viewMode) ? sess.viewMode : 'grid',
            activePhotoId: typeof sess.activePhotoId === 'string' ? sess.activePhotoId : null,
            activeFolderId: typeof sess.activeFolderId === 'string' ? sess.activeFolderId : null,
            activeCollectionId: typeof sess.activeCollectionId === 'string' ? sess.activeCollectionId : null,
        };
    } catch {
        return fallback;
    }
};
const savedSession = loadSavedSession();

export const useCatalogStore = create<CatalogState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    photos: [],
    selectedPhotoIds: savedSession.activePhotoId ? new Set([savedSession.activePhotoId]) : new Set(),
    activePhotoId: savedSession.activePhotoId,
    totalPhotoCount: 0,
    isLoading: false,

    collections: [],
    keywords: [],
    folders: [],
    activeCollectionId: savedSession.activeCollectionId,
    activeFolderId: savedSession.activeFolderId,

    viewMode: savedSession.viewMode,
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
    photoDevSettings: {},
    developmentSettings: defaultDevelopmentSettings,

    // Photo actions (optimized: findIndex+slice instead of map for O(1) lookup)
    setPhotos: (photos) => set({ photos }),
    addPhotos: (newPhotos) => set((state) => ({ photos: [...state.photos, ...newPhotos] })),
    updatePhoto: (id, updates) => set((state) => {
        const idx = state.photos.findIndex(p => p.id === id);
        if (idx === -1) return {};
        const newPhotos = state.photos.slice();
        newPhotos[idx] = { ...newPhotos[idx], ...updates };
        return { photos: newPhotos };
    }),
    removePhotos: (ids) => {
        const idSet = new Set(ids);
        set((state) => ({
            photos: state.photos.filter((p) => !idSet.has(p.id)),
            selectedPhotoIds: new Set([...state.selectedPhotoIds].filter((id) => !idSet.has(id)))
        }));
    },

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

        // Ratings, color labels and flags act on the selection — so the selection
        // has to follow the photo actually on screen. Loupe/Develop arrows, the
        // filmstrip, the map and the people view all move the active photo without
        // touching the selection, which meant pressing 1-5 rated whatever was
        // selected back in the grid instead of the photo being viewed. Navigating
        // onto a photo outside the selection now makes it the selection; stepping
        // around inside a deliberate multi-selection leaves that selection intact.
        const keepSelection = !id || state.selectedPhotoIds.has(id);
        const selectedPhotoIds = keepSelection ? state.selectedPhotoIds : new Set([id]);

        if (id) {
            // First check the in-memory cache (Record instead of Map)
            photoSettings = state.photoDevSettings[id] || null;

            // If not in cache, try to load from the photo object (from DB)
            if (!photoSettings) {
                const photo = state.photos.find(p => p.id === id);
                if (photo && photo.develop_settings) {
                    try {
                        const parsed = typeof photo.develop_settings === 'string'
                            ? JSON.parse(photo.develop_settings)
                            : photo.develop_settings;
                        photoSettings = { ...defaultDevelopmentSettings, ...parsed };
                        // Cache it (Record spread instead of new Map)
                        set({
                            activePhotoId: id,
                            selectedPhotoIds,
                            developmentSettings: photoSettings,
                            photoDevSettings: { ...state.photoDevSettings, [id]: photoSettings }
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
            selectedPhotoIds,
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
            editHistory: [...s.editHistory.slice(-100), entry]  // Keep last 100 entries (was 500 - too much RAM)
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

        const newSettings = { ...historyEntry.devSettingsSnapshot };
        const settingsJson = JSON.stringify(newSettings);

        // Save to database
        window.api.updatePhoto(historyEntry.photoId, { develop_settings: settingsJson });

        // Update photo in array with findIndex (O(1) lookup vs O(n) map)
        set((s) => {
            const idx = s.photos.findIndex(p => p.id === historyEntry.photoId);
            let newPhotos = s.photos;
            if (idx !== -1) {
                newPhotos = s.photos.slice();
                newPhotos[idx] = { ...newPhotos[idx], develop_settings: settingsJson };
            }
            return {
                developmentSettings: newSettings,
                photoDevSettings: { ...s.photoDevSettings, [historyEntry.photoId]: newSettings },
                photos: newPhotos
            };
        });
    },

    // Bulk operations (optimized with Set lookups instead of includes)
    setSelectedRating: (rating) => {
        const state = get();
        const idSet = state.selectedPhotoIds;
        const ids = [...idSet];
        if (ids.length === 0) return;

        const previousValues = new Map<string, number>();
        state.photos.forEach(p => { if (idSet.has(p.id)) previousValues.set(p.id, p.rating); });

        window.api.bulkUpdateRating(ids, rating).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) => idSet.has(p.id) ? { ...p, rating } : p)
            }));
            ids.forEach(id => {
                addEditHistory(id, `Rating → ${rating} ★`, previousValues.get(id), rating);
            });
        });
    },
    setSelectedFlag: (flag) => {
        const state = get();
        const idSet = state.selectedPhotoIds;
        const ids = [...idSet];
        if (ids.length === 0) return;

        const previousValues = new Map<string, string>();
        state.photos.forEach(p => { if (idSet.has(p.id)) previousValues.set(p.id, p.flag); });

        const flagLabels = { none: 'None', picked: 'Picked ✓', rejected: 'Rejected ✗' };

        window.api.bulkUpdateFlag(ids, flag).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) => idSet.has(p.id) ? { ...p, flag } : p)
            }));
            ids.forEach(id => {
                addEditHistory(id, `Flag → ${flagLabels[flag]}`, previousValues.get(id), flag);
            });
        });
    },
    setSelectedColorLabel: (color) => {
        const state = get();
        const idSet = state.selectedPhotoIds;
        const ids = [...idSet];
        if (ids.length === 0) return;

        const previousValues = new Map<string, string>();
        state.photos.forEach(p => { if (idSet.has(p.id)) previousValues.set(p.id, p.color_label); });

        const colorLabels: Record<string, string> = {
            none: 'None', red: 'Red 🔴', yellow: 'Yellow 🟡',
            green: 'Green 🟢', blue: 'Blue 🔵', purple: 'Purple 🟣'
        };

        window.api.bulkUpdateColorLabel(ids, color).then(() => {
            const { addEditHistory } = get();
            set((s) => ({
                photos: s.photos.map((p) => idSet.has(p.id) ? { ...p, color_label: color } : p)
            }));
            ids.forEach(id => {
                addEditHistory(id, `Color → ${colorLabels[color]}`, previousValues.get(id), color);
            });
        });
    },

    // Copy selected photos to a folder
    copySelectedPhotos: async () => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        const targetFolder = await window.api.selectTargetFolder();
        if (!targetFolder) return;

        const result = await window.api.copyPhotos(ids, targetFolder);
        if (result.failed > 0) {
            console.warn(`[Store] Copy: ${result.success} copied, ${result.failed} failed`, result.errors);
        }
    },

    // Move selected photos to a folder
    moveSelectedPhotos: async () => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        const targetFolder = await window.api.selectTargetFolder();
        if (!targetFolder) return;

        const result = await window.api.movePhotos(ids, targetFolder);
        if (result.success > 0) {
            // Refresh photos from DB to get updated paths
            const count = await window.api.getPhotoCount();
            const photos = await window.api.getPhotos(count, 0);
            set({ photos, totalPhotoCount: count });
        }
        if (result.failed > 0) {
            console.warn(`[Store] Move: ${result.success} moved, ${result.failed} failed`, result.errors);
        }
    },

    // Delete selected photos with confirmation
    deleteSelectedPhotos: async () => {
        const state = get();
        const ids = [...state.selectedPhotoIds];
        if (ids.length === 0) return;

        const idSet = new Set(ids);
        await window.api.deletePhotos(ids, false);
        set((s) => ({
            photos: s.photos.filter((p) => !idSet.has(p.id)),
            selectedPhotoIds: new Set(),
            activePhotoId: null,
        }));
    },

    // Refresh catalog from database (get count first, then load exact amount)
    refreshCatalog: async () => {
        set({ isLoading: true });
        try {
            // Get count first to avoid loading arbitrary large number
            const count = await window.api.getPhotoCount();
            const [photos, collections, keywords, folders] = await Promise.all([
                window.api.getPhotos(count, 0),
                window.api.getCollections(),
                window.api.getKeywords(),
                window.api.getFolders(),
            ]);
            set({ photos, collections, keywords, folders, totalPhotoCount: count, isLoading: false });
        } catch (error) {
            console.error('[Store] Refresh failed:', error);
            set({ isLoading: false });
        }
    },

    // Development settings (optimized: Record + findIndex instead of Map + map)
    setDevelopmentSettings: (settings) => {
        const state = get();
        const photoId = state.activePhotoId;
        if (photoId) {
            set({
                developmentSettings: settings,
                photoDevSettings: { ...state.photoDevSettings, [photoId]: settings }
            });
        } else {
            set({ developmentSettings: settings });
        }
    },
    updateDevelopmentSetting: (key, value) => {
        const state = get();
        const photoId = state.activePhotoId;
        const previousValue = state.developmentSettings[key];

        if (previousValue === value) return;

        const previousSettings = { ...state.developmentSettings };
        const newSettings = { ...state.developmentSettings, [key]: value };

        if (photoId) {
            const { addEditHistory } = get();
            const labelMap: Record<string, string> = {
                exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights',
                shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks',
                clarity: 'Clarity', vibrance: 'Vibrance', saturation: 'Saturation',
                temperature: 'Temperature', tint: 'Tint'
            };
            addEditHistory(photoId, `${labelMap[key] || key} → ${value > 0 ? '+' : ''}${value}`, previousValue, value, previousSettings);

            const settingsJson = JSON.stringify(newSettings);
            window.api.updatePhoto(photoId, { develop_settings: settingsJson });

            // findIndex + slice instead of map (avoid iterating all photos)
            set((s) => {
                const idx = s.photos.findIndex(p => p.id === photoId);
                let newPhotos = s.photos;
                if (idx !== -1) {
                    newPhotos = s.photos.slice();
                    newPhotos[idx] = { ...newPhotos[idx], develop_settings: settingsJson };
                }
                return {
                    developmentSettings: newSettings,
                    photoDevSettings: { ...s.photoDevSettings, [photoId]: newSettings },
                    photos: newPhotos
                };
            });
        } else {
            set({ developmentSettings: newSettings });
        }
    },
    resetDevelopmentSettings: () => {
        const state = get();
        const photoId = state.activePhotoId;
        if (photoId) {
            const previousSettings = { ...state.developmentSettings };
            const { addEditHistory } = get();
            addEditHistory(photoId, 'Reset', previousSettings, defaultDevelopmentSettings, previousSettings);

            const settingsJson = JSON.stringify(defaultDevelopmentSettings);
            window.api.updatePhoto(photoId, { develop_settings: settingsJson });

            set((s) => {
                const idx = s.photos.findIndex(p => p.id === photoId);
                let newPhotos = s.photos;
                if (idx !== -1) {
                    newPhotos = s.photos.slice();
                    newPhotos[idx] = { ...newPhotos[idx], develop_settings: settingsJson };
                }
                return {
                    developmentSettings: defaultDevelopmentSettings,
                    photoDevSettings: { ...s.photoDevSettings, [photoId]: defaultDevelopmentSettings },
                    photos: newPhotos
                };
            });
        } else {
            set({ developmentSettings: defaultDevelopmentSettings });
        }
    }
})));


// Persist the working position on every relevant change, so closing the app
// mid-session costs nothing: folder/collection, view mode and active photo.
let lastPersistedSession = '';
useCatalogStore.subscribe((s) => {
    const sess = JSON.stringify({
        viewMode: s.viewMode,
        activePhotoId: s.activePhotoId,
        activeFolderId: s.activeFolderId,
        activeCollectionId: s.activeCollectionId,
    });
    if (sess !== lastPersistedSession) {
        lastPersistedSession = sess;
        try { localStorage.setItem(SESSION_KEY, sess); } catch { /* storage full — skip */ }
    }
});
