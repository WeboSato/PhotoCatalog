import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import {
    Folder,
    FolderOpen,
    ChevronDown,
    ChevronRight,
    HardDrive,
    Trash2,
    EyeOff,
    FolderInput,
    RefreshCw,
    X
} from 'lucide-react';

// Context menu state
interface FolderContextMenu {
    visible: boolean;
    x: number;
    y: number;
    folder: FolderNode | null;
}

interface FolderNode {
    id: string;
    path: string;
    name: string;
    parent_id: string | null;
    children: FolderNode[];
    photo_count: number;
    depth: number;
}

interface FolderYearGroup {
    year: string;
    folders: FolderNode[];
    total_photos: number;
}

interface VolumeGroup {
    volumePath: string;
    volumeName: string;
    folders: FolderNode[];
    total_photos: number;
}

interface FolderTreeItemProps {
    folder: FolderNode;
    level: number;
    activeFolderId: string | null;
    expandedFolders: Set<string>;
    onToggle: (folderId: string) => void;
    onSelect: (folderId: string, folderPath: string) => void;
    onContextMenu: (e: React.MouseEvent, folder: FolderNode) => void;
    onDragStart: (e: React.DragEvent, folder: FolderNode) => void;
    onDragOver: (e: React.DragEvent, folder: FolderNode) => void;
    onDrop: (e: React.DragEvent, targetFolder: FolderNode) => void;
    dragOverFolder: string | null;
}

const FolderTreeItem: React.FC<FolderTreeItemProps> = ({
    folder,
    level,
    activeFolderId,
    expandedFolders,
    onToggle,
    onSelect,
    onContextMenu,
    onDragStart,
    onDragOver,
    onDrop,
    dragOverFolder
}) => {
    const hasChildren = folder.children.length > 0;
    const isActive = activeFolderId === folder.id;
    const isExpanded = expandedFolders.has(folder.id);
    const isDragOver = dragOverFolder === folder.id;

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (hasChildren) {
            onToggle(folder.id);
        }
    };

    const handleSelect = () => {
        onSelect(folder.id, folder.path);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, folder);
    };

    return (
        <div>
            <button
                onClick={handleSelect}
                onContextMenu={handleContextMenu}
                draggable
                onDragStart={(e) => onDragStart(e, folder)}
                onDragOver={(e) => onDragOver(e, folder)}
                onDrop={(e) => onDrop(e, folder)}
                className={`w-full flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors group
                    ${isActive
                        ? 'bg-blue-600 text-white'
                        : isDragOver
                            ? 'bg-blue-500/30 text-white border border-blue-500 border-dashed'
                            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                style={{ paddingLeft: `${8 + level * 12}px` }}
            >
                {/* Expand/collapse chevron */}
                <span
                    onClick={handleToggle}
                    className={`p-0.5 -ml-1 rounded hover:bg-gray-700 ${hasChildren ? 'visible' : 'invisible'}`}
                >
                    {isExpanded ? (
                        <ChevronDown size={12} />
                    ) : (
                        <ChevronRight size={12} />
                    )}
                </span>

                {/* Folder icon */}
                {isActive || isExpanded ? (
                    <FolderOpen size={14} className="text-yellow-500 flex-shrink-0" />
                ) : (
                    <Folder size={14} className="text-yellow-500 flex-shrink-0" />
                )}

                {/* Folder name */}
                <span className="truncate flex-1 text-left">{folder.name}</span>

                {/* Photo count */}
                {folder.photo_count > 0 && (
                    <span className={`text-xs ${isActive ? 'text-blue-200' : 'text-gray-500'}`}>
                        {folder.photo_count}
                    </span>
                )}
            </button>

            {/* Children */}
            {isExpanded && hasChildren && (
                <div>
                    {folder.children.map((child) => (
                        <FolderTreeItem
                            key={child.id}
                            folder={child}
                            level={level + 1}
                            activeFolderId={activeFolderId}
                            expandedFolders={expandedFolders}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onContextMenu={onContextMenu}
                            onDragStart={onDragStart}
                            onDragOver={onDragOver}
                            onDrop={onDrop}
                            dragOverFolder={dragOverFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Volume header component (like Lightroom)
const VolumeHeader: React.FC<{
    volume: VolumeGroup;
    isExpanded: boolean;
    onToggle: () => void;
    activeFolderId: string | null;
    expandedFolders: Set<string>;
    onFolderToggle: (folderId: string) => void;
    onFolderSelect: (folderId: string, folderPath: string) => void;
    onContextMenu: (e: React.MouseEvent, folder: FolderNode) => void;
    onDragStart: (e: React.DragEvent, folder: FolderNode) => void;
    onDragOver: (e: React.DragEvent, folder: FolderNode) => void;
    onDrop: (e: React.DragEvent, targetFolder: FolderNode) => void;
    dragOverFolder: string | null;
}> = ({ volume, isExpanded, onToggle, activeFolderId, expandedFolders, onFolderToggle, onFolderSelect, onContextMenu, onDragStart, onDragOver, onDrop, dragOverFolder }) => {
    return (
        <div className="mb-1">
            {/* Volume header */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <HardDrive size={14} className="text-gray-500" />
                <span className="truncate flex-1 text-left">{volume.volumeName}</span>
                <span className="text-gray-600">{volume.total_photos}</span>
            </button>

            {/* Folders in this volume */}
            {isExpanded && (
                <div className="ml-2">
                    {volume.folders.map((folder) => (
                        <FolderTreeItem
                            key={folder.id}
                            folder={folder}
                            level={0}
                            activeFolderId={activeFolderId}
                            expandedFolders={expandedFolders}
                            onToggle={onFolderToggle}
                            onSelect={onFolderSelect}
                            onContextMenu={onContextMenu}
                            onDragStart={onDragStart}
                            onDragOver={onDragOver}
                            onDrop={onDrop}
                            dragOverFolder={dragOverFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Folder Context Menu Component
const FolderContextMenuComponent: React.FC<{
    x: number;
    y: number;
    folder: FolderNode;
    onClose: () => void;
    onDelete: () => void;
    onHide: () => void;
    onShowInFinder: () => void;
    onSync: () => void;
    isSyncing: boolean;
}> = ({ x, y, folder, onClose, onDelete, onHide, onShowInFinder, onSync, isSyncing }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded shadow-xl py-1 min-w-[220px]"
            style={{ left: x, top: y }}
        >
            <div className="px-3 py-1 text-xs text-gray-500 border-b border-[#444] truncate">
                {folder.name}
            </div>
            <button
                className="w-full px-3 py-2 text-left text-sm text-blue-400 hover:bg-blue-600 hover:text-white flex items-center gap-2"
                onClick={onSync}
                disabled={isSyncing}
            >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Synchronisation...' : 'Synchroniser ce dossier'}
            </button>
            <button
                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-blue-600 hover:text-white flex items-center gap-2"
                onClick={onShowInFinder}
            >
                <FolderInput size={14} />
                Afficher dans le Finder
            </button>
            <div className="border-t border-[#444] my-1" />
            <button
                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                onClick={onHide}
            >
                <EyeOff size={14} />
                Masquer de la bibliothèque
            </button>
            <button
                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-600 hover:text-white flex items-center gap-2"
                onClick={onDelete}
            >
                <Trash2 size={14} />
                Supprimer définitivement
            </button>
        </div>
    );
};

// Storage keys for persistence
const STORAGE_KEYS = {
    expandedFolders: 'photocatalog_expanded_folders',
    expandedVolumes: 'photocatalog_expanded_volumes',
    activeFolderId: 'photocatalog_active_folder'
};

// Load persisted state
const loadPersistedSet = (key: string): Set<string> => {
    try {
        const saved = localStorage.getItem(key);
        if (saved) {
            return new Set(JSON.parse(saved));
        }
    } catch (e) {
        console.warn('Failed to load persisted state:', key);
    }
    return new Set();
};

const savePersistedSet = (key: string, set: Set<string>) => {
    try {
        localStorage.setItem(key, JSON.stringify([...set]));
    } catch (e) {
        console.warn('Failed to save persisted state:', key);
    }
};

export const FolderTree: React.FC = () => {
    const [flatFolders, setFlatFolders] = useState<FolderNode[]>([]);
    const [volumes, setVolumes] = useState<VolumeGroup[]>([]);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => loadPersistedSet(STORAGE_KEYS.expandedFolders));
    const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(() => loadPersistedSet(STORAGE_KEYS.expandedVolumes));
    const [isLoading, setIsLoading] = useState(false);
    const [initialized, setInitialized] = useState(false);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<FolderContextMenu>({ visible: false, x: 0, y: 0, folder: null });
    const [isSyncing, setIsSyncing] = useState(false);

    // Drag and drop state
    const [draggedFolder, setDraggedFolder] = useState<FolderNode | null>(null);
    const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

    const activeFolderId = useCatalogStore((s) => s.activeFolderId);
    const setActiveFolderId = useCatalogStore((s) => s.setActiveFolderId);
    const setPhotos = useCatalogStore((s) => s.setPhotos);

    // Group folders by volume (root path)
    const groupByVolume = (folders: FolderNode[]): VolumeGroup[] => {
        const volumeMap = new Map<string, VolumeGroup>();

        for (const folder of folders) {
            // Extract volume path (first 3 parts of path like /Users/name/Pictures)
            const parts = folder.path.split('/').filter(Boolean);
            let volumePath: string;
            let volumeName: string;

            if (parts[0] === 'Volumes') {
                // External drive
                volumePath = '/' + parts.slice(0, 2).join('/');
                volumeName = parts[1] || 'External';
            } else if (parts[0] === 'Users' && parts.length >= 3) {
                // User folder - show up to Pictures/Documents level
                volumePath = '/' + parts.slice(0, 3).join('/');
                volumeName = parts.slice(0, 3).join('/');
            } else {
                // Root or other
                volumePath = '/' + parts[0];
                volumeName = parts[0] || '/';
            }

            if (!volumeMap.has(volumePath)) {
                volumeMap.set(volumePath, {
                    volumePath,
                    volumeName,
                    folders: [],
                    total_photos: 0
                });
            }

            const volume = volumeMap.get(volumePath)!;

            // Only add root-level folders for this volume
            if (folder.path.startsWith(volumePath) && folder.depth === 0) {
                volume.folders.push(folder);
            }

            // Count all photos
            const countPhotos = (f: FolderNode): number => {
                return f.photo_count + f.children.reduce((sum, c) => sum + countPhotos(c), 0);
            };
            volume.total_photos += countPhotos(folder);
        }

        // Sort volumes, putting user folders first
        return Array.from(volumeMap.values()).sort((a, b) => {
            if (a.volumePath.includes('/Users/') && !b.volumePath.includes('/Users/')) return -1;
            if (!a.volumePath.includes('/Users/') && b.volumePath.includes('/Users/')) return 1;
            return a.volumeName.localeCompare(b.volumeName);
        });
    };

    // Load folder data
    const loadFolders = useCallback(async () => {
        setIsLoading(true);
        try {
            const hierarchy = await window.api.getFolderHierarchy();
            setFlatFolders(hierarchy);

            // Group by volume
            const volumeGroups = groupByVolume(hierarchy);
            setVolumes(volumeGroups);

            // If no persisted state, auto-expand the first volume
            if (!initialized) {
                const savedVolumes = loadPersistedSet(STORAGE_KEYS.expandedVolumes);
                const savedFolders = loadPersistedSet(STORAGE_KEYS.expandedFolders);

                if (savedVolumes.size === 0 && volumeGroups.length > 0) {
                    // Auto-expand first volume
                    savedVolumes.add(volumeGroups[0].volumePath);
                    // Also expand "Images" folder if it exists
                    const imagesFolder = volumeGroups[0].folders.find(f => f.name === 'Images');
                    if (imagesFolder) {
                        savedFolders.add(imagesFolder.id);
                    }
                }

                setExpandedVolumes(savedVolumes);
                setExpandedFolders(savedFolders);
                setInitialized(true);

                // Restore active folder if saved
                const savedActiveFolderId = localStorage.getItem(STORAGE_KEYS.activeFolderId);
                if (savedActiveFolderId) {
                    setActiveFolderId(savedActiveFolderId);
                    // Load photos for this folder
                    const allFolders: FolderNode[] = [];
                    const collectFolders = (folders: FolderNode[]) => {
                        for (const f of folders) {
                            allFolders.push(f);
                            collectFolders(f.children);
                        }
                    };
                    collectFolders(hierarchy);
                    const folder = allFolders.find(f => f.id === savedActiveFolderId);
                    if (folder) {
                        const photos = await window.api.getPhotosInFolder(folder.path);
                        setPhotos(photos);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load folders:', error);
        } finally {
            setIsLoading(false);
        }
    }, [initialized, setActiveFolderId, setPhotos]);

    useEffect(() => {
        loadFolders();
    }, [loadFolders]);

    const handleFolderToggle = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            // Persist state
            savePersistedSet(STORAGE_KEYS.expandedFolders, next);
            return next;
        });
    };

    const handleVolumeToggle = (volumePath: string) => {
        setExpandedVolumes(prev => {
            const next = new Set(prev);
            if (next.has(volumePath)) {
                next.delete(volumePath);
            } else {
                next.add(volumePath);
            }
            // Persist state
            savePersistedSet(STORAGE_KEYS.expandedVolumes, next);
            return next;
        });
    };

    const handleFolderSelect = async (folderId: string, folderPath: string) => {
        setActiveFolderId(folderId);
        // Persist active folder
        localStorage.setItem(STORAGE_KEYS.activeFolderId, folderId);

        try {
            const photos = await window.api.getPhotosInFolder(folderPath);
            setPhotos(photos);
        } catch (error) {
            console.error('Failed to load photos:', error);
        }
    };

    // Context menu handlers
    const handleContextMenu = useCallback((e: React.MouseEvent, folder: FolderNode) => {
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            folder
        });
    }, []);

    const closeContextMenu = useCallback(() => {
        setContextMenu({ visible: false, x: 0, y: 0, folder: null });
    }, []);

    const handleShowInFinder = useCallback(async () => {
        if (contextMenu.folder) {
            await window.api.showInFolder(contextMenu.folder.path);
        }
        closeContextMenu();
    }, [contextMenu.folder, closeContextMenu]);

    const handleHideFolder = useCallback(async () => {
        if (contextMenu.folder) {
            try {
                await window.api.deleteFolder(contextMenu.folder.path, false); // false = hide only
                loadFolders(); // Refresh folders
            } catch (error) {
                console.error('Failed to hide folder:', error);
            }
        }
        closeContextMenu();
    }, [contextMenu.folder, closeContextMenu, loadFolders]);

    const handleDeleteFolder = useCallback(async () => {
        if (contextMenu.folder) {
            const confirmed = window.confirm(
                `Voulez-vous vraiment supprimer le dossier "${contextMenu.folder.name}" et toutes ses photos?\n\nCette action est irréversible!`
            );
            if (confirmed) {
                try {
                    await window.api.deleteFolder(contextMenu.folder.path, true); // true = delete from disk
                    loadFolders(); // Refresh folders
                } catch (error) {
                    console.error('Failed to delete folder:', error);
                }
            }
        }
        closeContextMenu();
    }, [contextMenu.folder, closeContextMenu, loadFolders]);

    const handleSyncFolder = useCallback(async () => {
        if (contextMenu.folder) {
            setIsSyncing(true);
            try {
                console.log('[FolderTree] Syncing folder:', contextMenu.folder.path);
                await window.api.importFromPath({
                    sourcePath: contextMenu.folder.path,
                    recursive: true,
                    generateThumbnails: true,
                    extractMetadata: true
                });
                // Refresh folders after sync
                loadFolders();
                // Refresh photos if this folder is selected
                if (activeFolderId === contextMenu.folder.id) {
                    const photos = await window.api.getPhotosInFolder(contextMenu.folder.path);
                    setPhotos(photos);
                }
            } catch (error) {
                console.error('Failed to sync folder:', error);
            } finally {
                setIsSyncing(false);
            }
        }
        closeContextMenu();
    }, [contextMenu.folder, closeContextMenu, loadFolders, activeFolderId, setPhotos]);

    // Drag and drop handlers
    const handleDragStart = useCallback((e: React.DragEvent, folder: FolderNode) => {
        setDraggedFolder(folder);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', folder.id);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, folder: FolderNode) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Don't allow dropping on self or children
        if (draggedFolder && draggedFolder.id !== folder.id && !folder.path.startsWith(draggedFolder.path + '/')) {
            setDragOverFolder(folder.id);
        }
    }, [draggedFolder]);

    const handleDragEnd = useCallback(() => {
        setDraggedFolder(null);
        setDragOverFolder(null);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent, targetFolder: FolderNode) => {
        e.preventDefault();
        if (draggedFolder && draggedFolder.id !== targetFolder.id) {
            // Check if not dropping into self or children
            if (!targetFolder.path.startsWith(draggedFolder.path + '/')) {
                try {
                    await window.api.moveFolder(draggedFolder.path, targetFolder.path);
                    loadFolders(); // Refresh folders
                } catch (error) {
                    console.error('Failed to move folder:', error);
                }
            }
        }
        setDraggedFolder(null);
        setDragOverFolder(null);
    }, [draggedFolder, loadFolders]);

    // Add drag end listener
    useEffect(() => {
        const handleGlobalDragEnd = () => {
            setDraggedFolder(null);
            setDragOverFolder(null);
        };
        document.addEventListener('dragend', handleGlobalDragEnd);
        return () => document.removeEventListener('dragend', handleGlobalDragEnd);
    }, []);

    if (isLoading) {
        return (
            <div className="px-3 py-4 text-center">
                <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full mx-auto" />
                <p className="text-xs text-gray-500 mt-2">Loading folders...</p>
            </div>
        );
    }

    if (flatFolders.length === 0) {
        return (
            <div className="px-3 py-4 text-center">
                <Folder size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No folders imported</p>
                <p className="text-xs text-gray-600 mt-1">
                    Import a folder to see your photo library
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {/* Volumes section - like Lightroom */}
            <div className="overflow-y-auto">
                {volumes.map((volume) => (
                    <VolumeHeader
                        key={volume.volumePath}
                        volume={volume}
                        isExpanded={expandedVolumes.has(volume.volumePath)}
                        onToggle={() => handleVolumeToggle(volume.volumePath)}
                        activeFolderId={activeFolderId}
                        expandedFolders={expandedFolders}
                        onFolderToggle={handleFolderToggle}
                        onFolderSelect={handleFolderSelect}
                        onContextMenu={handleContextMenu}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        dragOverFolder={dragOverFolder}
                    />
                ))}
            </div>

            {/* Context Menu */}
            {contextMenu.visible && contextMenu.folder && (
                <FolderContextMenuComponent
                    x={contextMenu.x}
                    y={contextMenu.y}
                    folder={contextMenu.folder}
                    onClose={closeContextMenu}
                    onDelete={handleDeleteFolder}
                    onHide={handleHideFolder}
                    onShowInFinder={handleShowInFinder}
                    onSync={handleSyncFolder}
                    isSyncing={isSyncing}
                />
            )}
        </div>
    );
};

export default FolderTree;
