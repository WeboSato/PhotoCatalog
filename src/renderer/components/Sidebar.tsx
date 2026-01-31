import React, { useState, useEffect } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { FolderTree } from './FolderTree';
import {
    Folder,
    FolderOpen,
    Image,
    Star,
    Tag,
    ChevronDown,
    ChevronRight,
    Plus,
    LayoutGrid,
    Filter,
    Database,
    HardDrive,
    RefreshCw,
    Users,
    Copy,
    Settings,
    ScanFace,
    Loader2,
    Trash2
} from 'lucide-react';
import { SettingsModal } from './SettingsModal';

interface SidebarSectionProps {
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    action?: React.ReactNode;
}

const SidebarSection: React.FC<SidebarSectionProps> = ({
    title,
    icon,
    defaultOpen = true,
    children,
    action
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="mb-2">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {icon}
                    <span>{title}</span>
                </div>
                {action && (
                    <div onClick={(e) => e.stopPropagation()}>
                        {action}
                    </div>
                )}
            </button>
            {isOpen && (
                <div className="mt-1 ml-2">
                    {children}
                </div>
            )}
        </div>
    );
};

interface SidebarItemProps {
    icon?: React.ReactNode;
    label: string;
    count?: number;
    isActive?: boolean;
    onClick?: () => void;
    indent?: number;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
    icon,
    label,
    count,
    isActive,
    onClick,
    indent = 0
}) => {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded transition-colors
                ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            style={{ paddingLeft: `${12 + indent * 16}px` }}
        >
            <div className="flex items-center gap-2 truncate">
                {icon}
                <span className="truncate">{label}</span>
            </div>
            {count !== undefined && (
                <span className={`text-xs ${isActive ? 'text-blue-200' : 'text-gray-500'}`}>
                    {count}
                </span>
            )}
        </button>
    );
};

const getStore = () => useCatalogStore.getState();

export const Sidebar: React.FC = React.memo(() => {
    // Only subscribe to what affects render
    const collections = useCatalogStore((s) => s.collections);
    const keywords = useCatalogStore((s) => s.keywords);
    const activeCollectionId = useCatalogStore((s) => s.activeCollectionId);
    const activeFolderId = useCatalogStore((s) => s.activeFolderId);
    const totalPhotoCount = useCatalogStore((s) => s.totalPhotoCount);
    const sidebarCollapsed = useCatalogStore((s) => s.sidebarCollapsed);
    const filters = useCatalogStore((s) => s.filters);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [people, setPeople] = useState<{ id: string; name: string; face_count: number; thumbnail_face_id?: string }[]>([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<{ current: number; total: number; phase?: string }>({ current: 0, total: 0, phase: '' });
    const [duplicates, setDuplicates] = useState<{ hash: string; photos: any[] }[]>([]);
    const [affinityData, setAffinityData] = useState<{ grouped: Record<string, Record<string, Record<string, any[]>>>; total: number } | null>(null);
    const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
    const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
    const [activePersonId, setActivePersonId] = useState<string | null>(null);

    // Load people and affinity data on mount
    useEffect(() => {
        window.api.getPeople().then(setPeople);
        window.api.findDuplicates().then(setDuplicates);
        window.api.getAffinityByDate().then(setAffinityData);
    }, []);

    // Refresh affinity data when photos change
    useEffect(() => {
        const unsubscribe = window.api.onPhotosRefresh(() => {
            window.api.getAffinityByDate().then(setAffinityData);
        });
        return unsubscribe;
    }, []);

    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    // Face scanning function
    const scanFaces = async () => {
        if (isScanning) return;

        setIsScanning(true);
        setScanProgress({ current: 0, total: 0, phase: 'scanning' });

        try {
            // Import FaceRecognitionService dynamically
            const { faceRecognitionService } = await import('../services/FaceRecognitionService');

            // Load models first
            await faceRecognitionService.loadModels();

            // Get all photos
            const photos = await window.api.getPhotos(10000, 0);
            setScanProgress({ current: 0, total: photos.length, phase: 'scanning' });

            let facesFound = 0;

            for (let i = 0; i < photos.length; i++) {
                const photo = photos[i];
                setScanProgress({ current: i + 1, total: photos.length, phase: 'scanning' });

                // Skip if no thumbnail
                if (!photo.thumbnail_path) continue;

                try {
                    // Use thumbnail for faster processing
                    const imageUrl = `local-image://${photo.thumbnail_path}`;
                    const faces = await faceRecognitionService.detectFacesFromUrl(imageUrl);

                    // Save detected faces to database
                    for (const face of faces) {
                        await window.api.insertFace({
                            id: face.id,
                            photo_id: photo.id,
                            box_x: face.box.x,
                            box_y: face.box.y,
                            box_width: face.box.width,
                            box_height: face.box.height,
                            descriptor: face.descriptor ? JSON.stringify(Array.from(face.descriptor)) : null,
                            confidence: face.confidence
                        });
                        facesFound++;
                    }
                } catch (err) {
                    // Skip photos that fail
                    console.warn(`[FaceScan] Failed to process ${photo.file_name}:`, err);
                }

                // Small delay to keep UI responsive
                if (i % 10 === 0) {
                    await new Promise(r => setTimeout(r, 10));
                }
            }

            console.log(`[FaceScan] Complete! Found ${facesFound} faces in ${photos.length} photos`);

            // Now cluster the faces automatically
            setScanProgress({ current: 0, total: 0, phase: 'clustering' });
            console.log('[FaceScan] Starting face clustering...');

            const clusterResult = await window.api.clusterFaces();
            console.log(`[FaceScan] Clustering done: ${clusterResult.clustersCreated} people, ${clusterResult.facesAssigned} faces`);

            // Refresh people list
            const updatedPeople = await window.api.getPeople();
            setPeople(updatedPeople);

        } catch (error) {
            console.error('[FaceScan] Error:', error);
            alert('Erreur lors du scan: ' + (error as Error).message);
        } finally {
            setIsScanning(false);
            setScanProgress({ current: 0, total: 0, phase: '' });
        }
    };

    const toggleYear = (year: string) => {
        setExpandedYears(prev => {
            const next = new Set(prev);
            if (next.has(year)) next.delete(year);
            else next.add(year);
            return next;
        });
    };

    const toggleMonth = (yearMonth: string) => {
        setExpandedMonths(prev => {
            const next = new Set(prev);
            if (next.has(yearMonth)) next.delete(yearMonth);
            else next.add(yearMonth);
            return next;
        });
    };

    if (sidebarCollapsed) {
        return (
            <div className="w-12 bg-gray-900 border-r border-gray-700 flex flex-col items-center py-4 gap-4">
                <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <Database size={20} />
                </button>
                <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <HardDrive size={20} />
                </button>
                <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <LayoutGrid size={20} />
                </button>
                <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <Tag size={20} />
                </button>
            </div>
        );
    }

    const handleCreateCollection = async () => {
        const name = prompt('Collection name:');
        if (name) {
            await window.api.createCollection({ name, is_smart: false });
            const collections = await window.api.getCollections();
            getStore().setCollections(collections);
        }
    };

    const handleImportFolder = async () => {
        const path = await window.api.openDirectory();
        if (path) {
            getStore().setIsImporting(true);
            await window.api.scanAndImportFolders(path);
            await window.api.importFromPath({
                sourcePath: path,
                recursive: true,
                generateThumbnails: true,
                extractMetadata: true
            });
            getStore().setIsImporting(false);
            await refreshData();
        }
    };

    const refreshData = async () => {
        setIsRefreshing(true);
        try {
            const [collectionsData, keywordsData, count] = await Promise.all([
                window.api.getCollections(),
                window.api.getKeywords(),
                window.api.getPhotoCount()
            ]);
            const { setCollections, setKeywords, setTotalPhotoCount } = getStore();
            setCollections(collectionsData);
            setKeywords(keywordsData);
            setTotalPhotoCount(count);
        } catch (error) {
            console.error('Failed to refresh data:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleShowAllPhotos = async () => {
        const { setActiveCollectionId, setActiveFolderId, setFilters } = getStore();
        setActiveCollectionId(null);
        setActiveFolderId(null);
        setFilters({});
        setActivePersonId(null);
    };

    return (
        <div className="w-64 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-bold text-white">PhotoCatalog</h1>
                    <p className="text-xs text-gray-500">{totalPhotoCount} photos</p>
                </div>
                <button
                    onClick={refreshData}
                    className={`p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded ${isRefreshing ? 'animate-spin' : ''}`}
                    title="Refresh"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto py-2">
                {/* Catalog Section */}
                <SidebarSection
                    title="Catalog"
                    icon={<Database size={16} />}
                >
                    <SidebarItem
                        icon={<Image size={14} />}
                        label="All Photos"
                        count={totalPhotoCount}
                        isActive={!activeCollectionId && !activeFolderId && Object.keys(filters).length === 0}
                        onClick={handleShowAllPhotos}
                    />
                </SidebarSection>

                {/* Quick Filters */}
                <SidebarSection
                    title="Quick Filters"
                    icon={<Filter size={16} />}
                >
                    <SidebarItem
                        icon={<Star size={14} className="text-yellow-400" />}
                        label="5 Stars"
                        isActive={filters.rating?.min === 5}
                        onClick={() => getStore().setFilters({ rating: { min: 5 } })}
                    />
                    <SidebarItem
                        icon={<Star size={14} className="text-yellow-400" />}
                        label="4+ Stars"
                        isActive={filters.rating?.min === 4}
                        onClick={() => getStore().setFilters({ rating: { min: 4 } })}
                    />
                    <SidebarItem
                        label="Priorité"
                        isActive={filters.flag?.includes('picked')}
                        onClick={() => getStore().setFilters({ flag: ['picked'] })}
                    />
                    <SidebarItem
                        label="Rejected"
                        isActive={filters.flag?.includes('rejected')}
                        onClick={() => getStore().setFilters({ flag: ['rejected'] })}
                    />
                </SidebarSection>

                {/* Affinity Edits - simple item with count */}
                {affinityData && affinityData.total > 0 && (
                    <SidebarItem
                        icon={<span className="text-xs font-bold text-red-500">AFI</span>}
                        label="Affinity Edits"
                        count={affinityData.total}
                        isActive={filters.has_affinity_edit === true}
                        onClick={() => {
                            getStore().setActiveFolderId(null);
                            getStore().setActiveCollectionId(null);
                            getStore().setFilters({ has_affinity_edit: true });
                        }}
                    />
                )}

                {/* Color Labels Filter */}
                <SidebarSection
                    title="Color Labels"
                    icon={<div className="w-4 h-4 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500" />}
                    defaultOpen={false}
                >
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-red-500" />}
                        label="Red"
                        isActive={filters.color_label?.includes('red')}
                        onClick={() => getStore().setFilters({ color_label: ['red'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-yellow-500" />}
                        label="Yellow"
                        isActive={filters.color_label?.includes('yellow')}
                        onClick={() => getStore().setFilters({ color_label: ['yellow'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-green-500" />}
                        label="Green"
                        isActive={filters.color_label?.includes('green')}
                        onClick={() => getStore().setFilters({ color_label: ['green'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-blue-500" />}
                        label="Blue"
                        isActive={filters.color_label?.includes('blue')}
                        onClick={() => getStore().setFilters({ color_label: ['blue'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-purple-500" />}
                        label="Purple"
                        isActive={filters.color_label?.includes('purple')}
                        onClick={() => getStore().setFilters({ color_label: ['purple'] })}
                    />
                </SidebarSection>

                {/* Folders Section */}
                <SidebarSection
                    title="Folders"
                    icon={<HardDrive size={16} />}
                    action={
                        <button
                            onClick={handleImportFolder}
                            className="p-1 text-gray-500 hover:text-white rounded"
                            title="Import Folder"
                        >
                            <Plus size={14} />
                        </button>
                    }
                >
                    <FolderTree />
                </SidebarSection>

                {/* Collections */}
                <SidebarSection
                    title="Collections"
                    icon={<LayoutGrid size={16} />}
                    action={
                        <button
                            onClick={handleCreateCollection}
                            className="p-1 text-gray-500 hover:text-white rounded"
                        >
                            <Plus size={14} />
                        </button>
                    }
                >
                    {collections.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-500">No collections yet</p>
                    ) : (
                        collections.map((collection) => (
                            <SidebarItem
                                key={collection.id}
                                icon={<LayoutGrid size={14} />}
                                label={collection.name}
                                count={collection.photo_count}
                                isActive={activeCollectionId === collection.id}
                                onClick={() => getStore().setActiveCollectionId(collection.id)}
                            />
                        ))
                    )}
                </SidebarSection>

                {/* Keywords */}
                <SidebarSection
                    title="Keywords"
                    icon={<Tag size={16} />}
                    defaultOpen={false}
                >
                    {keywords.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-500">No keywords yet</p>
                    ) : (
                        keywords.slice(0, 20).map((keyword) => (
                            <SidebarItem
                                key={keyword.id}
                                label={keyword.name}
                                count={keyword.photo_count}
                            />
                        ))
                    )}
                </SidebarSection>

                {/* People */}
                <SidebarSection
                    title="People"
                    icon={<Users size={16} />}
                    defaultOpen={false}
                    action={
                        <div className="flex items-center gap-1">
                            <button
                                onClick={scanFaces}
                                disabled={isScanning}
                                className="p-1 text-gray-500 hover:text-blue-400 rounded disabled:opacity-50"
                                title="Scan faces / Scanner les visages"
                            >
                                {isScanning ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <ScanFace size={14} />
                                )}
                            </button>
                            <button
                                onClick={async () => {
                                    const name = prompt('Person name / Nom de la personne:');
                                    if (name) {
                                        await window.api.createPerson(name);
                                        const updatedPeople = await window.api.getPeople();
                                        setPeople(updatedPeople);
                                    }
                                }}
                                className="p-1 text-gray-500 hover:text-white rounded"
                                title="Add person / Ajouter une personne"
                            >
                                <Plus size={14} />
                            </button>
                            {people.length > 0 && (
                                <button
                                    onClick={async () => {
                                        if (confirm('Clear all face data? This will remove all detected faces and people. You can re-scan afterward.\n\nEffacer toutes les données de visages? Vous pourrez rescanner après.')) {
                                            await window.api.clearAllFaces();
                                            setPeople([]);
                                            setActivePersonId(null);
                                        }
                                    }}
                                    disabled={isScanning}
                                    className="p-1 text-gray-500 hover:text-red-400 rounded disabled:opacity-50"
                                    title="Clear all faces / Effacer tous les visages"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    }
                >
                    {isScanning && (
                        <div className="px-3 py-2 text-xs text-blue-400">
                            {scanProgress.phase === 'clustering' ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 size={12} className="animate-spin" />
                                    Grouping similar faces...
                                </span>
                            ) : (
                                <span>Scanning... {scanProgress.current}/{scanProgress.total}</span>
                            )}
                        </div>
                    )}
                    {!isScanning && people.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-500">
                            No people yet. Click <ScanFace size={12} className="inline" /> to scan.
                        </p>
                    ) : (
                        people.map((person) => (
                            <button
                                key={person.id}
                                onClick={async () => {
                                    // Set active state to show this person's photos
                                    setActivePersonId(person.id);
                                    getStore().setActiveCollectionId(null);
                                    getStore().setActiveFolderId(null);
                                    getStore().setFilters({});
                                    const photos = await window.api.getPhotosByPerson(person.id);
                                    getStore().setPhotos(photos);
                                }}
                                onDoubleClick={async () => {
                                    const newName = prompt('Rename person / Renommer:', person.name);
                                    if (newName && newName !== person.name) {
                                        await window.api.updatePerson(person.id, newName);
                                        const updatedPeople = await window.api.getPeople();
                                        setPeople(updatedPeople);
                                    }
                                }}
                                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded transition-colors
                                    ${activePersonId === person.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                            >
                                <div className="flex items-center gap-2 truncate">
                                    <Users size={14} />
                                    <span className="truncate">{person.name}</span>
                                </div>
                                <span className={`text-xs ${activePersonId === person.id ? 'text-blue-200' : 'text-gray-500'}`}>
                                    {person.face_count}
                                </span>
                            </button>
                        ))
                    )}
                </SidebarSection>

                {/* Duplicates */}
                {duplicates.length > 0 && (
                    <SidebarSection
                        title="Duplicates"
                        icon={<Copy size={16} />}
                        defaultOpen={false}
                    >
                        <p className="px-3 py-2 text-xs text-gray-400">
                            Found {duplicates.length} groups of duplicate photos
                        </p>
                        {duplicates.slice(0, 10).map((dup, i) => (
                            <SidebarItem
                                key={i}
                                label={`${dup.photos.length} copies`}
                                onClick={() => {
                                    getStore().setPhotos(dup.photos);
                                }}
                            />
                        ))}
                    </SidebarSection>
                )}
            </div>

            {/* Footer - Clean, minimal */}
            <div className="p-3 border-t border-gray-700 space-y-2">
                <button
                    onClick={handleImportFolder}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-all
                        bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 backdrop-blur-sm
                        hover:border-blue-400/50 hover:shadow-lg hover:shadow-blue-500/10"
                >
                    <Plus size={16} />
                    Importer
                </button>

                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg transition-all
                        hover:bg-gray-800"
                >
                    <Settings size={14} />
                    Paramètres
                </button>
            </div>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </div>
    );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
