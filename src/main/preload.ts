import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // Dialog operations
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: (filters?: Electron.FileFilter[]) => ipcRenderer.invoke('dialog:openFiles', filters),
    saveFile: (options: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:saveFile', options),

    // Photo operations
    getPhotos: (limit?: number, offset?: number) => ipcRenderer.invoke('photos:getAll', limit, offset),
    getPhoto: (id: string) => ipcRenderer.invoke('photos:get', id),
    searchPhotos: (criteria: any, limit?: number, offset?: number) => ipcRenderer.invoke('photos:search', criteria, limit, offset),
    getPhotoCount: () => ipcRenderer.invoke('photos:getCount'),
    updatePhoto: (id: string, updates: any) => ipcRenderer.invoke('photos:update', id, updates),
    deletePhotos: (ids: string[], deleteFromDisk?: boolean) => ipcRenderer.invoke('photos:delete', ids, deleteFromDisk || false),
    bulkUpdateRating: (ids: string[], rating: number) => ipcRenderer.invoke('photos:bulkUpdateRating', ids, rating),
    bulkUpdateFlag: (ids: string[], flag: string) => ipcRenderer.invoke('photos:bulkUpdateFlag', ids, flag),
    bulkUpdateColorLabel: (ids: string[], colorLabel: string) => ipcRenderer.invoke('photos:bulkUpdateColorLabel', ids, colorLabel),
    getAffinityByDate: () => ipcRenderer.invoke('photos:getAffinityByDate'),
    rotatePhotos: (ids: string[], direction: 'cw' | 'ccw') => ipcRenderer.invoke('photos:rotate', ids, direction),

    // Collection operations
    getCollections: () => ipcRenderer.invoke('collections:getAll'),
    createCollection: (collection: any) => ipcRenderer.invoke('collections:create', collection),
    updateCollection: (id: string, updates: any) => ipcRenderer.invoke('collections:update', id, updates),
    deleteCollection: (id: string) => ipcRenderer.invoke('collections:delete', id),
    getCollectionPhotos: (collectionId: string) => ipcRenderer.invoke('collections:getPhotos', collectionId),
    addPhotosToCollection: (collectionId: string, photoIds: string[]) => ipcRenderer.invoke('collections:addPhotos', collectionId, photoIds),
    removePhotosFromCollection: (collectionId: string, photoIds: string[]) => ipcRenderer.invoke('collections:removePhotos', collectionId, photoIds),

    // Keyword operations
    getKeywords: () => ipcRenderer.invoke('keywords:getAll'),
    createKeyword: (keyword: any) => ipcRenderer.invoke('keywords:create', keyword),
    getPhotoKeywords: (photoId: string) => ipcRenderer.invoke('keywords:getForPhoto', photoId),
    addKeywordsToPhoto: (photoId: string, keywordIds: string[]) => ipcRenderer.invoke('keywords:addToPhoto', photoId, keywordIds),
    removeKeywordsFromPhoto: (photoId: string, keywordIds: string[]) => ipcRenderer.invoke('keywords:removeFromPhoto', photoId, keywordIds),
    addKeywordsByName: (photoId: string, keywordNames: string[]) => ipcRenderer.invoke('keywords:addByName', photoId, keywordNames),

    // Folder operations
    getFolders: () => ipcRenderer.invoke('folders:getAll'),
    getFolderHierarchy: () => ipcRenderer.invoke('folders:getHierarchy'),
    getFoldersGroupedByYear: () => ipcRenderer.invoke('folders:getGroupedByYear'),
    getPhotosInFolder: (folderPath: string) => ipcRenderer.invoke('folders:getPhotos', folderPath),
    scanAndImportFolders: (rootPath: string) => ipcRenderer.invoke('folders:scanAndImport', rootPath),
    removeFolder: (folderId: string) => ipcRenderer.invoke('folders:remove', folderId),
    rebuildFolderHierarchy: (rootPath?: string) => ipcRenderer.invoke('folders:rebuildHierarchy', rootPath),
    getChildFolders: (parentId: string | null) => ipcRenderer.invoke('folders:getChildren', parentId),
    deleteFolder: (folderPath: string, deleteFromDisk: boolean) => ipcRenderer.invoke('folders:delete', folderPath, deleteFromDisk),
    moveFolder: (sourcePath: string, targetParentPath: string) => ipcRenderer.invoke('folders:move', sourcePath, targetParentPath),

    // Import operations
    importFromPath: (options: any) => ipcRenderer.invoke('import:fromPath', options),
    importFiles: (filePaths: string[], options: any) => ipcRenderer.invoke('import:files', filePaths, options),
    reindexPhoto: (photoId: string) => ipcRenderer.invoke('import:reindex', photoId),
    reindexAllPhotos: () => ipcRenderer.invoke('import:reindexAll'),

    // Metadata operations
    extractMetadata: (filePath: string) => ipcRenderer.invoke('metadata:extract', filePath),

    // External editor operations
    getAvailableEditors: () => ipcRenderer.invoke('editor:getAvailable'),
    openInEditor: (photoPath: string, photoId: string, editorId?: string) => ipcRenderer.invoke('editor:open', photoPath, photoId, editorId),
    openInAffinityPhoto: (photoPath: string, photoId: string) => ipcRenderer.invoke('editor:openInAffinity', photoPath, photoId),
    linkEditedFile: (photoId: string) => ipcRenderer.invoke('editor:linkEditedFile', photoId),

    // Statistics
    getStatistics: () => ipcRenderer.invoke('stats:get'),

    // Thumbnail operations
    getThumbnailPath: (sourcePath: string) => ipcRenderer.invoke('thumbnails:getPath', sourcePath),
    getPreviewPath: (sourcePath: string) => ipcRenderer.invoke('thumbnails:getPreviewPath', sourcePath),
    getCacheSize: () => ipcRenderer.invoke('thumbnails:getCacheSize'),
    clearThumbnailCache: () => ipcRenderer.invoke('thumbnails:clearCache'),

    // File operations
    showInFolder: (filePath: string) => ipcRenderer.invoke('file:showInFolder', filePath),
    openExternal: (filePath: string) => ipcRenderer.invoke('file:openExternal', filePath),

    // Lightroom import
    lightroomFindCatalogs: () => ipcRenderer.invoke('lightroom:findCatalogs'),
    lightroomFindBestCatalog: () => ipcRenderer.invoke('lightroom:findBestCatalog'),
    lightroomSelectCatalog: () => ipcRenderer.invoke('lightroom:selectCatalog'),
    lightroomSyncMetadata: (catalogPath: string) => ipcRenderer.invoke('lightroom:syncMetadata', catalogPath),
    lightroomImport: (catalogPath: string, options: any) => ipcRenderer.invoke('lightroom:import', catalogPath, options),
    lightroomImportAll: (catalogPath: string) => ipcRenderer.invoke('lightroom:importAll', catalogPath),
    onLightroomProgress: (callback: (progress: any) => void) => {
        const handler = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('lightroom:progress', handler);
        return () => ipcRenderer.removeListener('lightroom:progress', handler);
    },

    // Event listeners
    onMenuNewCatalog: (callback: () => void) => {
        ipcRenderer.on('menu:new-catalog', callback);
        return () => ipcRenderer.removeListener('menu:new-catalog', callback);
    },
    onMenuOpenCatalog: (callback: () => void) => {
        ipcRenderer.on('menu:open-catalog', callback);
        return () => ipcRenderer.removeListener('menu:open-catalog', callback);
    },
    onMenuImport: (callback: () => void) => {
        ipcRenderer.on('menu:import', callback);
        return () => ipcRenderer.removeListener('menu:import', callback);
    },
    onMenuImportFolder: (callback: () => void) => {
        ipcRenderer.on('menu:import-folder', callback);
        return () => ipcRenderer.removeListener('menu:import-folder', callback);
    },
    onMenuExport: (callback: () => void) => {
        ipcRenderer.on('menu:export', callback);
        return () => ipcRenderer.removeListener('menu:export', callback);
    },
    onMenuEditExternal: (callback: () => void) => {
        ipcRenderer.on('menu:edit-external', callback);
        return () => ipcRenderer.removeListener('menu:edit-external', callback);
    },
    onPhotoRating: (callback: (rating: number) => void) => {
        const handler = (_event: any, rating: number) => callback(rating);
        ipcRenderer.on('photo:rating', handler);
        return () => ipcRenderer.removeListener('photo:rating', handler);
    },
    onPhotoFlag: (callback: (flag: string) => void) => {
        const handler = (_event: any, flag: string) => callback(flag);
        ipcRenderer.on('photo:flag', handler);
        return () => ipcRenderer.removeListener('photo:flag', handler);
    },
    onPhotoColor: (callback: (color: string) => void) => {
        const handler = (_event: any, color: string) => callback(color);
        ipcRenderer.on('photo:color', handler);
        return () => ipcRenderer.removeListener('photo:color', handler);
    },
    onPhotoDelete: (callback: () => void) => {
        ipcRenderer.on('photo:delete', callback);
        return () => ipcRenderer.removeListener('photo:delete', callback);
    },
    onViewMode: (callback: (mode: string) => void) => {
        const handler = (_event: any, mode: string) => callback(mode);
        ipcRenderer.on('view:mode', handler);
        return () => ipcRenderer.removeListener('view:mode', handler);
    },
    onImportProgress: (callback: (progress: any) => void) => {
        const handler = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('import:progress', handler);
        return () => ipcRenderer.removeListener('import:progress', handler);
    },
    onCameraDetected: (callback: (data: { volumePath: string; volumeName: string; dcimPath: string; photoCount: number }) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('volume:camera-detected', handler);
        return () => ipcRenderer.removeListener('volume:camera-detected', handler);
    },
    onPhotosRefresh: (callback: () => void) => {
        ipcRenderer.on('photos:refresh', callback);
        return () => ipcRenderer.removeListener('photos:refresh', callback);
    },
    onEditSaved: (callback: (data: { photoId: string; editCopyPath: string }) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('edit:saved', handler);
        return () => ipcRenderer.removeListener('edit:saved', handler);
    },
    onAffinityUpdated: (callback: (data: { photoId: string; editCopyPath: string }) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('affinity:updated', handler);
        return () => ipcRenderer.removeListener('affinity:updated', handler);
    },
    onThumbnailsProgress: (callback: (progress: { current: number; total: number; done?: boolean }) => void) => {
        const handler = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('thumbnails:progress', handler);
        return () => ipcRenderer.removeListener('thumbnails:progress', handler);
    },

    // People/Face operations
    getPeople: () => ipcRenderer.invoke('people:getAll'),
    createPerson: (name: string) => ipcRenderer.invoke('people:create', name),
    updatePerson: (id: string, name: string) => ipcRenderer.invoke('people:update', id, name),
    deletePerson: (id: string) => ipcRenderer.invoke('people:delete', id),
    getPhotosByPerson: (personId: string) => ipcRenderer.invoke('people:getPhotos', personId),

    getFacesForPhoto: (photoId: string) => ipcRenderer.invoke('faces:getForPhoto', photoId),
    getUnidentifiedFaces: () => ipcRenderer.invoke('faces:getUnidentified'),
    assignFaceToPerson: (faceId: string, personId: string) => ipcRenderer.invoke('faces:assignToPerson', faceId, personId),
    insertFace: (face: any) => ipcRenderer.invoke('faces:insert', face),
    deleteFace: (faceId: string) => ipcRenderer.invoke('faces:delete', faceId),
    clusterFaces: () => ipcRenderer.invoke('faces:cluster'),
    getFaceStats: () => ipcRenderer.invoke('faces:getStats'),
    clearAllFaces: () => ipcRenderer.invoke('faces:clearAll'),
    getFaceWithPhoto: (faceId: string) => ipcRenderer.invoke('faces:getWithPhoto', faceId),
    getPersonWithThumbnail: (personId: string) => ipcRenderer.invoke('people:getWithThumbnail', personId),
    getPeopleWithThumbnails: () => ipcRenderer.invoke('people:getAllWithThumbnails'),

    // Duplicate detection
    findDuplicates: () => ipcRenderer.invoke('duplicates:find'),

    // XMP Sidecar operations
    xmpRead: (imagePath: string) => ipcRenderer.invoke('xmp:read', imagePath),
    xmpWrite: (imagePath: string, metadata: any) => ipcRenderer.invoke('xmp:write', imagePath, metadata),
    xmpUpdate: (imagePath: string, updates: any) => ipcRenderer.invoke('xmp:update', imagePath, updates),
    xmpExists: (imagePath: string) => ipcRenderer.invoke('xmp:exists', imagePath),
    xmpAddKeywords: (imagePath: string, keywords: string[]) => ipcRenderer.invoke('xmp:addKeywords', imagePath, keywords),
    xmpRemoveKeywords: (imagePath: string, keywords: string[]) => ipcRenderer.invoke('xmp:removeKeywords', imagePath, keywords),
    xmpBatchWrite: (photoIds: string[]) => ipcRenderer.invoke('xmp:batchWrite', photoIds),
    xmpSyncFromFile: (photoId: string) => ipcRenderer.invoke('xmp:syncFromFile', photoId),

    // Bulk keyword operations
    bulkAddKeywords: (photoIds: string[], keywords: string[]) => ipcRenderer.invoke('keywords:bulkAdd', photoIds, keywords),
    bulkRemoveKeywords: (photoIds: string[], keywords: string[]) => ipcRenderer.invoke('keywords:bulkRemove', photoIds, keywords),

    // Settings operations
    settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
    settingsGet: (key: string) => ipcRenderer.invoke('settings:get', key),
    settingsSet: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    settingsGetCatalogInfo: () => ipcRenderer.invoke('settings:getCatalogInfo'),
    settingsSelectCatalogPath: () => ipcRenderer.invoke('settings:selectCatalogPath'),
    settingsMigrateCatalog: (newPath: string) => ipcRenderer.invoke('settings:migrateCatalog', newPath),

    // Catalog Manager operations
    catalogCreate: (options: { name: string; location: string; copyCurrentData?: boolean }) =>
        ipcRenderer.invoke('catalog:create', options),
    catalogSelectLocation: () => ipcRenderer.invoke('catalog:selectLocation'),
    catalogOpen: (catalogPath: string) => ipcRenderer.invoke('catalog:open', catalogPath),
    catalogGetStats: (catalogPath: string) => ipcRenderer.invoke('catalog:getStats', catalogPath),
    catalogSelectAndOpen: () => ipcRenderer.invoke('catalog:selectAndOpen'),
    scanForCatalogs: () => ipcRenderer.invoke('catalog:scan'),
    onCatalogChanged: (callback: () => void) => {
        ipcRenderer.on('catalog:changed', callback);
        return () => ipcRenderer.removeListener('catalog:changed', callback);
    },
    onLanguageChange: (callback: (language: string) => void) => {
        const handler = (_event: any, language: string) => callback(language);
        ipcRenderer.on('language:change', handler);
        return () => ipcRenderer.removeListener('language:change', handler);
    }
});

// Type definitions for the exposed API
export interface ElectronAPI {
    openDirectory: () => Promise<string | null>;
    openFiles: (filters?: Electron.FileFilter[]) => Promise<string[]>;
    saveFile: (options: Electron.SaveDialogOptions) => Promise<string | null>;

    getPhotos: (limit?: number, offset?: number) => Promise<any[]>;
    getPhoto: (id: string) => Promise<any>;
    searchPhotos: (criteria: any, limit?: number, offset?: number) => Promise<any[]>;
    getPhotoCount: () => Promise<number>;
    updatePhoto: (id: string, updates: any) => Promise<boolean>;
    deletePhotos: (ids: string[], deleteFromDisk?: boolean) => Promise<boolean>;
    bulkUpdateRating: (ids: string[], rating: number) => Promise<boolean>;
    bulkUpdateFlag: (ids: string[], flag: string) => Promise<boolean>;
    bulkUpdateColorLabel: (ids: string[], colorLabel: string) => Promise<boolean>;
    getAffinityByDate: () => Promise<{ grouped: Record<string, Record<string, Record<string, any[]>>>; total: number }>;
    rotatePhotos: (ids: string[], direction: 'cw' | 'ccw') => Promise<boolean>;

    getCollections: () => Promise<any[]>;
    createCollection: (collection: any) => Promise<string>;
    updateCollection: (id: string, updates: any) => Promise<boolean>;
    deleteCollection: (id: string) => Promise<boolean>;
    getCollectionPhotos: (collectionId: string) => Promise<any[]>;
    addPhotosToCollection: (collectionId: string, photoIds: string[]) => Promise<boolean>;
    removePhotosFromCollection: (collectionId: string, photoIds: string[]) => Promise<boolean>;

    getKeywords: () => Promise<any[]>;
    createKeyword: (keyword: any) => Promise<string>;
    getPhotoKeywords: (photoId: string) => Promise<any[]>;
    addKeywordsToPhoto: (photoId: string, keywordIds: string[]) => Promise<boolean>;
    removeKeywordsFromPhoto: (photoId: string, keywordIds: string[]) => Promise<boolean>;
    addKeywordsByName: (photoId: string, keywordNames: string[]) => Promise<boolean>;

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

    importFromPath: (options: any) => Promise<any>;
    importFiles: (filePaths: string[], options: any) => Promise<any>;
    reindexPhoto: (photoId: string) => Promise<boolean>;
    reindexAllPhotos: () => Promise<{ success: number; failed: number }>;

    extractMetadata: (filePath: string) => Promise<any>;

    getAvailableEditors: () => Promise<any[]>;
    openInEditor: (photoPath: string, photoId: string, editorId?: string) => Promise<any>;
    openInAffinityPhoto: (photoPath: string, photoId: string) => Promise<any>;
    linkEditedFile: (photoId: string) => Promise<{ editCopyPath: string; thumbnailPath: string | null } | null>;

    getStatistics: () => Promise<any>;

    getThumbnailPath: (sourcePath: string) => Promise<string | null>;
    getPreviewPath: (sourcePath: string) => Promise<string | null>;
    getCacheSize: () => Promise<{ thumbnails: number; previews: number; total: number }>;
    clearThumbnailCache: () => Promise<boolean>;

    showInFolder: (filePath: string) => Promise<boolean>;
    openExternal: (filePath: string) => Promise<boolean>;

    lightroomFindCatalogs: () => Promise<any[]>;
    lightroomFindBestCatalog: () => Promise<any | null>;
    lightroomSelectCatalog: () => Promise<string | null>;
    lightroomSyncMetadata: (catalogPath: string) => Promise<{ synced: number; notFound: number }>;
    lightroomImport: (catalogPath: string, options: any) => Promise<any>;
    lightroomImportAll: (catalogPath: string) => Promise<{ imported: number; skipped: number; notFound: number; errors: string[] }>;
    onLightroomProgress: (callback: (progress: any) => void) => () => void;

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
    onThumbnailsProgress: (callback: (progress: { current: number; total: number; done?: boolean }) => void) => () => void;

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
    settingsGetCatalogInfo: () => Promise<{
        dbPath: string;
        thumbPath: string;
        dbSize: number;
        thumbCount: number;
        thumbSize: number;
    }>;
    settingsSelectCatalogPath: () => Promise<string | null>;
    settingsMigrateCatalog: (newPath: string) => Promise<{ success: boolean; error?: string }>;

    // Catalog Manager operations
    catalogCreate: (options: { name: string; location: string; copyCurrentData?: boolean }) =>
        Promise<{ success: boolean; catalogPath?: string; error?: string }>;
    catalogSelectLocation: () => Promise<string | null>;
    catalogOpen: (catalogPath: string) => Promise<{ success: boolean; error?: string }>;
    catalogGetStats: (catalogPath: string) => Promise<{
        name: string;
        path: string;
        dbPath: string;
        previewsPath: string;
        size: number;
        photoCount: number;
        createdAt: string;
        lastOpened: string;
    } | null>;
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
