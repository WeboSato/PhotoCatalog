import React, { useEffect, useCallback, lazy, Suspense, useRef, useState } from 'react';
import { useCatalogStore } from './stores/catalogStore';
import { useLanguageStore } from './i18n';
import { Sidebar } from './components/Sidebar';
import { HistorySidebar } from './components/HistorySidebar';
import { Toolbar } from './components/Toolbar';
import { PhotoGrid } from './components/PhotoGrid';
import { LoupeView } from './components/LoupeView';
import { InfoPanel } from './components/InfoPanel';
import { ImportModal } from './components/ImportModal';
import { ImportDialog, ImportOptions } from './components/ImportDialog';
import { NewCatalogDialog } from './components/NewCatalogDialog';
import './styles/globals.css';

// Lazy load heavy components
const MapView = lazy(() => import('./components/MapView'));
const DevelopView = lazy(() => import('./components/DevelopView'));

// Get store actions once - they're stable and don't need subscriptions
const getStoreActions = () => useCatalogStore.getState();

const App: React.FC = () => {
    // ONLY subscribe to what affects render
    const viewMode = useCatalogStore((s) => s.viewMode);

    // Camera import dialog state
    const [cameraImport, setCameraImport] = useState<{
        isOpen: boolean;
        volumePath: string;
        volumeName: string;
        dcimPath: string;
        photoCount: number;
    }>({ isOpen: false, volumePath: '', volumeName: '', dcimPath: '', photoCount: 0 });

    // New catalog dialog state
    const [newCatalogDialogOpen, setNewCatalogDialogOpen] = useState(false);

    // Load initial data once on mount
    useEffect(() => {
        const loadData = async () => {
            const { setPhotos, setCollections, setKeywords, setFolders, setTotalPhotoCount, setIsLoading } = getStoreActions();
            setIsLoading(true);
            try {
                const [collectionsData, keywordsData, foldersData, count] = await Promise.all([
                    window.api.getCollections(),
                    window.api.getKeywords(),
                    window.api.getFolders(),
                    window.api.getPhotoCount()
                ]);
                // Don't load photos here - PhotoGrid handles its own loading
                setCollections(collectionsData);
                setKeywords(keywordsData);
                setFolders(foldersData);
                setTotalPhotoCount(count);
            } catch (error) {
                console.error('Failed to load data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    // Listen for photos refresh (throttled)
    useEffect(() => {
        let lastRefresh = 0;
        const unsubscribe = window.api.onPhotosRefresh(() => {
            const now = Date.now();
            if (now - lastRefresh > 5000) {
                lastRefresh = now;
                window.api.getPhotoCount().then((count) => {
                    getStoreActions().setTotalPhotoCount(count);
                });
            }
        });
        return () => unsubscribe();
    }, []);

    // Listen for external edit saves (from Affinity Photo, etc.)
    useEffect(() => {
        const unsubscribe = window.api.onEditSaved(async ({ photoId, editCopyPath }) => {
            console.log(`[App] External edit saved for photo ${photoId}: ${editCopyPath}`);
            // Reload the photo from database to get updated thumbnail
            try {
                const updatedPhoto = await window.api.getPhoto(photoId);
                if (updatedPhoto) {
                    getStoreActions().updatePhoto(photoId, {
                        thumbnail_path: updatedPhoto.thumbnail_path,
                        preview_path: updatedPhoto.preview_path,
                        edit_copy_path: updatedPhoto.edit_copy_path
                    });
                    // Add to edit history
                    const { addEditHistory } = useCatalogStore.getState();
                    addEditHistory(photoId, 'External edit saved', null, editCopyPath);
                }
            } catch (error) {
                console.error('[App] Failed to update photo after external edit:', error);
            }
        });
        return () => unsubscribe();
    }, []);

    // Listen for camera/SD card detection
    useEffect(() => {
        const unsubscribe = window.api.onCameraDetected((data) => {
            console.log('[App] Camera detected:', data);
            setCameraImport({
                isOpen: true,
                volumePath: data.volumePath,
                volumeName: data.volumeName,
                dcimPath: data.dcimPath,
                photoCount: data.photoCount
            });
        });
        return () => unsubscribe();
    }, []);

    // Handle camera import
    const handleCameraImport = useCallback(async (options: ImportOptions) => {
        console.log('[App] Starting camera import:', options);
        getStoreActions().setIsImporting(true);

        try {
            await window.api.importFromPath({
                sourcePath: options.sourcePath,
                destinationPath: options.destinationPath ? `${options.destinationPath}/${options.subfolderName}` : undefined,
                recursive: true,
                generateThumbnails: true,
                extractMetadata: true,
                keywords: options.keywords,
                renamePattern: options.renamePattern,
                customPattern: options.customPattern,
                deleteAfterImport: options.deleteAfterImport
            });

            setCameraImport(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
            console.error('[App] Camera import failed:', error);
        }
    }, []);

    // Menu event listeners - use refs to avoid re-creating handlers
    useEffect(() => {
        const unsubscribers = [
            window.api.onMenuNewCatalog(() => {
                setNewCatalogDialogOpen(true);
            }),
            window.api.onMenuOpenCatalog(async () => {
                const result = await window.api.catalogSelectAndOpen();
                if (result.success) {
                    // Reload the app data after opening a new catalog
                    window.location.reload();
                } else if (result.error && result.error !== 'Cancelled') {
                    alert(`Error: ${result.error}`);
                }
            }),
            window.api.onMenuImport(async () => {
                const files = await window.api.openFiles();
                if (files.length > 0) {
                    getStoreActions().setIsImporting(true);
                    await window.api.importFiles(files, {
                        generateThumbnails: true,
                        extractMetadata: true
                    });
                }
            }),
            window.api.onMenuImportFolder(async () => {
                const path = await window.api.openDirectory();
                if (path) {
                    getStoreActions().setIsImporting(true);
                    await window.api.importFromPath({
                        sourcePath: path,
                        recursive: true,
                        generateThumbnails: true,
                        extractMetadata: true
                    });
                }
            }),
            window.api.onMenuEditExternal(async () => {
                const { photos, activePhotoId } = useCatalogStore.getState();
                const photo = photos.find((p) => p.id === activePhotoId);
                if (photo) {
                    await window.api.openInAffinityPhoto(photo.file_path, photo.id);
                }
            }),
            window.api.onPhotoRating((rating) => {
                const { selectedPhotoIds, setSelectedRating } = useCatalogStore.getState();
                if (selectedPhotoIds.size > 0) {
                    setSelectedRating(rating);
                }
            }),
            window.api.onPhotoFlag((flag) => {
                const { selectedPhotoIds, setSelectedFlag } = useCatalogStore.getState();
                if (selectedPhotoIds.size > 0) {
                    setSelectedFlag(flag as any);
                }
            }),
            window.api.onPhotoColor((color) => {
                const { selectedPhotoIds, setSelectedColorLabel } = useCatalogStore.getState();
                if (selectedPhotoIds.size > 0) {
                    setSelectedColorLabel(color as any);
                }
            }),
            window.api.onViewMode((mode) => {
                getStoreActions().setViewMode(mode as any);
            }),
            window.api.onLanguageChange((language) => {
                useLanguageStore.getState().setLanguage(language as 'en' | 'fr');
            })
        ];

        return () => {
            unsubscribers.forEach((unsub) => unsub());
        };
    }, []);

    // Keyboard shortcuts - use getState() to avoid re-renders
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            const { selectedPhotoIds, setViewMode, setSelectedFlag, setSelectedRating, setSelectedColorLabel } = useCatalogStore.getState();

            switch (e.key.toLowerCase()) {
                case 'g':
                    if (!e.metaKey && !e.ctrlKey) setViewMode('grid');
                    break;
                case 'e':
                    if (!e.metaKey && !e.ctrlKey) setViewMode('loupe');
                    break;
                case 'n':
                    if (!e.metaKey && !e.ctrlKey) setViewMode('survey');
                    break;
                case 'm':
                    if (!e.metaKey && !e.ctrlKey) setViewMode('map');
                    break;
                case 'd':
                    if (!e.metaKey && !e.ctrlKey) setViewMode('develop');
                    break;
                case 'p':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedFlag('picked');
                    }
                    break;
                case 'u':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedFlag('none');
                    }
                    break;
                case 'x':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedFlag('rejected');
                    }
                    break;
                case '1': case '2': case '3': case '4': case '5':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedRating(parseInt(e.key));
                    }
                    break;
                case '0':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedRating(0);
                    }
                    break;
                case '6':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedColorLabel('none');
                    }
                    break;
                case '7':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedColorLabel('red');
                    }
                    break;
                case '8':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedColorLabel('yellow');
                    }
                    break;
                case '9':
                    if (!e.metaKey && !e.ctrlKey && selectedPhotoIds.size > 0) {
                        setSelectedColorLabel('green');
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Handle drag and drop
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        const paths = files.map((f) => f.path).filter((p) => p);

        if (paths.length > 0) {
            const { setIsImporting, setTotalPhotoCount } = getStoreActions();
            const hasFolders = files.some((f) => f.type === '' && !f.name.includes('.'));

            if (hasFolders) {
                for (const path of paths) {
                    setIsImporting(true);
                    await window.api.importFromPath({
                        sourcePath: path,
                        recursive: true,
                        generateThumbnails: true,
                        extractMetadata: true
                    });
                }
            } else {
                setIsImporting(true);
                await window.api.importFiles(paths, {
                    generateThumbnails: true,
                    extractMetadata: true
                });
            }

            const count = await window.api.getPhotoCount();
            setTotalPhotoCount(count);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    return (
        <div
            className="h-screen flex flex-col overflow-hidden"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            {/* Titlebar drag region */}
            <div className="h-8 bg-gray-900 titlebar-drag-region flex items-center justify-center">
                <span className="text-xs text-gray-500">PhotoCatalog</span>
            </div>

            {/* Main content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Show different sidebar based on view mode */}
                {(viewMode === 'loupe' || viewMode === 'develop') ? (
                    <HistorySidebar />
                ) : (
                    <Sidebar />
                )}

                <div className="flex-1 flex flex-col overflow-hidden">
                    <Toolbar />

                    <div className="flex-1 flex overflow-hidden">
                        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
                            {viewMode === 'grid' && <PhotoGrid />}
                            {viewMode === 'loupe' && <LoupeView />}
                            {viewMode === 'survey' && <PhotoGrid />}
                            {viewMode === 'map' && (
                                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500">Loading map...</div>}>
                                    <MapView />
                                </Suspense>
                            )}
                            {viewMode === 'develop' && (
                                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500">Loading develop module...</div>}>
                                    <DevelopView />
                                </Suspense>
                            )}
                        </div>

                        <InfoPanel />
                    </div>
                </div>
            </div>

            <ImportModal />

            {/* Camera Import Dialog */}
            <ImportDialog
                isOpen={cameraImport.isOpen}
                sourcePath={cameraImport.dcimPath}
                sourceName={cameraImport.volumeName}
                photoCount={cameraImport.photoCount}
                onClose={() => setCameraImport(prev => ({ ...prev, isOpen: false }))}
                onImport={handleCameraImport}
            />

            {/* New Catalog Dialog */}
            <NewCatalogDialog
                isOpen={newCatalogDialogOpen}
                onClose={() => setNewCatalogDialogOpen(false)}
                onCreated={() => {
                    setNewCatalogDialogOpen(false);
                    window.location.reload();
                }}
            />
        </div>
    );
};

export default App;
