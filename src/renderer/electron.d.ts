// Type declarations for the Electron preload API exposed on window
// This makes window.api available to TypeScript in the renderer process

interface ElectronAPI {
    // Dialog operations
    openDirectory: () => Promise<string | null>;
    openDirectoryDialog: () => Promise<string | null>;
    regenerateThumbnails: () => Promise<any>;
    syncLightroom: () => Promise<any>;
    importLightroom: () => Promise<any>;
    openFiles: (filters?: any[]) => Promise<string[]>;
    saveFile: (options: any) => Promise<string | null>;

    // Photo operations
    getPhotos: (limit?: number, offset?: number) => Promise<any[]>;
    getPhoto: (id: string) => Promise<any>;
    searchPhotos: (criteria: any, limit?: number, offset?: number) => Promise<any[]>;
    getPhotoCount: () => Promise<number>;
    updatePhoto: (id: string, updates: any) => Promise<boolean>;
    deletePhotos: (ids: string[], deleteFromDisk?: boolean) => Promise<boolean>;
    bulkUpdateRating: (ids: string[], rating: number) => Promise<boolean>;
    bulkUpdateFlag: (ids: string[], flag: string) => Promise<boolean>;
    bulkUpdateColorLabel: (ids: string[], colorLabel: string) => Promise<boolean>;
    getAffinityByDate: () => Promise<any>;
    rotatePhotos: (ids: string[], direction: 'cw' | 'ccw') => Promise<boolean>;
    copyPhotos: (ids: string[], targetFolder: string) => Promise<{ success: number; failed: number; errors: string[] }>;
    movePhotos: (ids: string[], targetFolder: string) => Promise<{ success: number; failed: number; errors: string[] }>;
    selectTargetFolder: () => Promise<string | null>;

    // Collection operations
    getCollections: () => Promise<any[]>;
    createCollection: (collection: any) => Promise<string>;
    updateCollection: (id: string, updates: any) => Promise<boolean>;
    deleteCollection: (id: string) => Promise<boolean>;
    getCollectionPhotos: (collectionId: string) => Promise<any[]>;
    addPhotosToCollection: (collectionId: string, photoIds: string[]) => Promise<boolean>;
    removePhotosFromCollection: (collectionId: string, photoIds: string[]) => Promise<boolean>;

    // Album / Photo Book operations
    getAlbums: () => Promise<import('../shared/albumTypes').Album[]>;
    createAlbum: (a: Partial<import('../shared/albumTypes').Album>) => Promise<string>;
    updateAlbum: (id: string, u: Partial<import('../shared/albumTypes').Album>) => Promise<boolean>;
    deleteAlbum: (id: string) => Promise<boolean>;
    getAlbumPages: (id: string) => Promise<import('../shared/albumTypes').AlbumPage[]>;
    saveAlbumPages: (id: string, pages: import('../shared/albumTypes').AlbumPage[]) => Promise<boolean>;
    getPhotosByIds: (ids: string[]) => Promise<any[]>;
    autoCurateAlbum: (params: { seedIds?: string[]; personId?: string; density?: string; minCount?: number }) => Promise<any>;
    exportAlbumPdf: (spec: import('../shared/albumTypes').AlbumRenderSpec, savePath: string) => Promise<import('../shared/albumTypes').AlbumExportResult>;
    exportAlbumSlideshow: (spec: import('../shared/albumTypes').AlbumRenderSpec, savePath: string) => Promise<import('../shared/albumTypes').AlbumExportResult>;
    onAlbumProgress: (callback: (p: import('../shared/albumTypes').AlbumProgress) => void) => () => void;

    // Keyword operations
    getKeywords: () => Promise<any[]>;
    createKeyword: (keyword: any) => Promise<string>;
    getPhotoKeywords: (photoId: string) => Promise<any[]>;
    addKeywordsToPhoto: (photoId: string, keywordIds: string[]) => Promise<boolean>;
    removeKeywordsFromPhoto: (photoId: string, keywordIds: string[]) => Promise<boolean>;
    addKeywordsByName: (photoId: string, keywordNames: string[]) => Promise<boolean>;

    // AI Tagging
    aiAnalyze: (photoId: string) => Promise<string[]>;
    aiInit: () => Promise<boolean>;
    aiIsReady: () => Promise<boolean>;

    // Folder operations
    getFolders: () => Promise<any[]>;
    getFolderHierarchy: () => Promise<any[]>;
    getFoldersGroupedByYear: () => Promise<any[]>;
    getPhotosInFolder: (folderPath: string) => Promise<any[]>;
    scanAndImportFolders: (rootPath: string) => Promise<boolean>;
    removeFolder: (folderId: string) => Promise<boolean>;
    rebuildFolderHierarchy: (rootPath?: string) => Promise<{ updated: number; created: number }>;
    getChildFolders: (parentId: string | null) => Promise<any[]>;
    deleteFolder: (folderPath: string, deleteFromDisk: boolean) => Promise<boolean>;
    moveFolder: (sourcePath: string, targetParentPath: string) => Promise<{ newPath: string }>;

    // Import operations
    importFromPath: (options: any) => Promise<any>;
    importFiles: (filePaths: string[], options: any) => Promise<any>;
    scanCard: (dirPath: string) => Promise<any[]>;
    cardPreview: (filePath: string) => Promise<string | null>;
    reindexPhoto: (photoId: string) => Promise<boolean>;
    reindexAllPhotos: () => Promise<{ success: number; failed: number }>;

    // Metadata
    extractMetadata: (filePath: string) => Promise<any>;

    // External editor
    getAvailableEditors: () => Promise<any[]>;
    openInEditor: (photoPath: string, photoId: string, editorId?: string) => Promise<any>;
    editLinkedCopy: (photoId: string) => Promise<{ success: boolean; copyPath?: string; copyPhotoId?: string; error?: string }>;
    applyCrop: (photoId: string, crop: { x: number; y: number; w: number; h: number } | null) => Promise<{ success: boolean; photo?: any; error?: string }>;
    getUncroppedPreview: (photoId: string) => Promise<string | null>;
    openInAffinityPhoto: (photoPath: string, photoId: string) => Promise<any>;
    linkEditedFile: (photoId: string) => Promise<{ editCopyPath: string; thumbnailPath: string | null } | null>;

    // Statistics
    getStatistics: () => Promise<any>;

    // Thumbnail operations
    getThumbnailPath: (sourcePath: string) => Promise<string | null>;
    getPreviewPath: (sourcePath: string) => Promise<string | null>;
    getCacheSize: () => Promise<{ thumbnails: number; previews: number; total: number }>;
    clearThumbnailCache: () => Promise<boolean>;

    // File operations
    showInFolder: (filePath: string) => Promise<boolean>;
    openExternal: (filePath: string) => Promise<boolean>;

    // Lightroom import
    lightroomFindCatalogs: () => Promise<any[]>;
    lightroomFindBestCatalog: () => Promise<any | null>;
    lightroomSelectCatalog: () => Promise<string | null>;
    lightroomSyncMetadata: (catalogPath: string) => Promise<{ synced: number; notFound: number }>;
    lightroomImport: (catalogPath: string, options: any) => Promise<any>;
    lightroomImportAll: (catalogPath: string) => Promise<any>;
    onLightroomProgress: (callback: (progress: any) => void) => () => void;

    // Event listeners
    onMenuNewCatalog: (callback: () => void) => () => void;
    onMenuOpenCatalog: (callback: () => void) => () => void;
    onMenuImport: (callback: () => void) => () => void;
    onMenuImportFolder: (callback: () => void) => () => void;
    onMenuExport: (callback: () => void) => () => void;
    onMenuEditExternal: (callback: () => void) => () => void;
    onPhotoRating: (callback: (rating: number) => void) => () => void;
    onPhotoFlag: (callback: (flag: string) => void) => () => void;
    onPhotoColor: (callback: (color: string) => void) => () => void;
    onPhotoDelete: (callback: () => void) => () => void;
    onViewMode: (callback: (mode: string) => void) => () => void;
    onImportProgress: (callback: (progress: any) => void) => () => void;
    onCameraDetected: (callback: (data: { volumePath: string; volumeName: string; dcimPath: string; photoCount: number }) => void) => () => void;
    onPhotosRefresh: (callback: () => void) => () => void;
    onEditSaved: (callback: (data: { photoId: string; editCopyPath: string }) => void) => () => void;
    onAffinityUpdated: (callback: (data: { photoId: string; editCopyPath: string }) => void) => () => void;
    onThumbnailsProgress: (callback: (progress: { current: number; total: number; done?: boolean; status?: string }) => void) => () => void;

    // People/Face operations
    getPeople: () => Promise<any[]>;
    createPerson: (name: string) => Promise<string>;
    updatePerson: (id: string, name: string) => Promise<boolean>;
    deletePerson: (id: string) => Promise<boolean>;
    getPhotosByPerson: (personId: string) => Promise<any[]>;
    getFacesForPhoto: (photoId: string) => Promise<any[]>;
    getUnidentifiedFaces: () => Promise<any[]>;
    assignFaceToPerson: (faceId: string, personId: string) => Promise<boolean>;
    insertFace: (face: any) => Promise<boolean>;
    deleteFace: (faceId: string) => Promise<boolean>;
    clusterFaces: () => Promise<{ clustersCreated: number; facesAssigned: number }>;
    getFaceStats: () => Promise<{ total: number; unassigned: number }>;
    clearAllFaces: () => Promise<boolean>;
    getFaceWithPhoto: (faceId: string) => Promise<any>;
    getPersonWithThumbnail: (personId: string) => Promise<any>;
    getPeopleWithThumbnails: () => Promise<any[]>;
    regenerateFaceCrops: () => Promise<{ generated: number }>;
    onFacesCropProgress: (callback: (p: { current: number; total: number; done?: boolean }) => void) => () => void;
    reclusterFaces: () => Promise<{ peopleCreated: number; facesAssigned: number; unassigned: number; preservedNames: number }>;
    onReclusterProgress: (callback: (p: { phase: string; current?: number; total?: number }) => void) => () => void;

    // Duplicate detection
    findDuplicates: () => Promise<{ hash: string; photos: any[] }[]>;

    // XMP Sidecar operations
    xmpRead: (imagePath: string) => Promise<any>;
    xmpWrite: (imagePath: string, metadata: any) => Promise<boolean>;
    xmpUpdate: (imagePath: string, updates: any) => Promise<boolean>;
    xmpExists: (imagePath: string) => Promise<boolean>;
    xmpAddKeywords: (imagePath: string, keywords: string[]) => Promise<boolean>;
    xmpRemoveKeywords: (imagePath: string, keywords: string[]) => Promise<boolean>;
    xmpBatchWrite: (photoIds: string[]) => Promise<{ success: number; failed: number }>;
    xmpSyncFromFile: (photoId: string) => Promise<any>;

    // Bulk keyword operations
    bulkAddKeywords: (photoIds: string[], keywords: string[]) => Promise<{ success: number; failed: number }>;
    bulkRemoveKeywords: (photoIds: string[], keywords: string[]) => Promise<{ success: number; failed: number }>;

    // Settings operations
    settingsGetAll: () => Promise<any>;
    settingsGet: (key: string) => Promise<any>;
    settingsSet: (key: string, value: any) => Promise<boolean>;
    settingsGetCatalogInfo: () => Promise<any>;
    settingsSelectCatalogPath: () => Promise<string | null>;
    settingsMigrateCatalog: (newPath: string) => Promise<{ success: boolean; error?: string }>;

    // Catalog Manager operations
    catalogCreate: (options: { name: string; location: string; copyCurrentData?: boolean }) => Promise<{ success: boolean; catalogPath?: string; error?: string }>;
    catalogSelectLocation: () => Promise<string | null>;
    catalogOpen: (catalogPath: string) => Promise<{ success: boolean; error?: string }>;
    catalogGetStats: (catalogPath: string) => Promise<any>;
    catalogSelectAndOpen: () => Promise<{ success: boolean; error?: string }>;
    scanForCatalogs: () => Promise<string[]>;
    onCatalogChanged: (callback: () => void) => () => void;
    onLanguageChange: (callback: (language: string) => void) => () => void;
}

declare global {
    interface Window {
        api: ElectronAPI;
    }
}
