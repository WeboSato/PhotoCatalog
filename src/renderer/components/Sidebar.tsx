import React, { useState, useEffect } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { useTranslation } from '../i18n';
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
    Copy,
    Settings,
    ScanFace,
    Trash2,
    X,
    BookOpen
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
    const { t } = useTranslation();
    // Only subscribe to what affects render
    const collections = useCatalogStore((s) => s.collections);
    const keywords = useCatalogStore((s) => s.keywords);
    const activeCollectionId = useCatalogStore((s) => s.activeCollectionId);
    const activeFolderId = useCatalogStore((s) => s.activeFolderId);
    const totalPhotoCount = useCatalogStore((s) => s.totalPhotoCount);
    const sidebarCollapsed = useCatalogStore((s) => s.sidebarCollapsed);
    const filters = useCatalogStore((s) => s.filters);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [peopleCount, setPeopleCount] = useState(0);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [duplicates, setDuplicates] = useState<{ hash: string; photos: any[] }[]>([]);
    const [affinityData, setAffinityData] = useState<{ grouped: Record<string, Record<string, Record<string, any[]>>>; total: number } | null>(null);
    const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
    const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

    // Load people count and affinity data on mount
    useEffect(() => {
        window.api.getPeople().then(people => setPeopleCount(people.length));
        window.api.findDuplicates().then(setDuplicates);
        window.api.getAffinityByDate().then(setAffinityData);
    }, []);

    // Refresh affinity data when photos change. The main process fires
    // photos:refresh every ~50 thumbnails during import; this query runs a full
    // table scan on the main process, so throttle it (trailing) instead of firing
    // on every tick concurrently with the PhotoGrid reload.
    useEffect(() => {
        let lastRun = 0;
        let timer: number | null = null;
        const REFRESH_INTERVAL = 3000;
        const run = () => { window.api.getAffinityByDate().then(setAffinityData); };
        const unsubscribe = window.api.onPhotosRefresh(() => {
            const elapsed = Date.now() - lastRun;
            if (elapsed >= REFRESH_INTERVAL) {
                lastRun = Date.now();
                run();
            } else if (timer === null) {
                timer = window.setTimeout(() => {
                    timer = null;
                    lastRun = Date.now();
                    run();
                }, REFRESH_INTERVAL - elapsed);
            }
        });
        return () => {
            unsubscribe();
            if (timer !== null) clearTimeout(timer);
        };
    }, []);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
                        label={t('allPhotos')}
                        count={totalPhotoCount}
                        isActive={!activeCollectionId && !activeFolderId && Object.keys(filters).length === 0}
                        onClick={handleShowAllPhotos}
                    />
                </SidebarSection>

                {/* Quick Filters */}
                <SidebarSection
                    title={t('quickFilters')}
                    icon={<Filter size={16} />}
                >
                    <SidebarItem
                        icon={<Star size={14} className="text-yellow-400" />}
                        label={t('fiveStars')}
                        isActive={filters.rating?.min === 5}
                        onClick={() => getStore().setFilters({ rating: { min: 5 } })}
                    />
                    <SidebarItem
                        icon={<Star size={14} className="text-yellow-400" />}
                        label={t('fourPlusStars')}
                        isActive={filters.rating?.min === 4}
                        onClick={() => getStore().setFilters({ rating: { min: 4 } })}
                    />
                    <SidebarItem
                        label={t('priority')}
                        isActive={filters.flag?.includes('picked')}
                        onClick={() => getStore().setFilters({ flag: ['picked'] })}
                    />
                    <SidebarItem
                        label={t('rejected')}
                        isActive={filters.flag?.includes('rejected')}
                        onClick={() => getStore().setFilters({ flag: ['rejected'] })}
                    />
                </SidebarSection>

                {/* Affinity Edits - simple item with count */}
                {affinityData && affinityData.total > 0 && (
                    <SidebarItem
                        icon={<span className="text-xs font-bold text-red-500">AFI</span>}
                        label={t('affinityEdits')}
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
                    title={t('colorLabels')}
                    icon={<div className="w-4 h-4 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500" />}
                    defaultOpen={false}
                >
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-red-500" />}
                        label={t('red')}
                        isActive={filters.color_label?.includes('red')}
                        onClick={() => getStore().setFilters({ color_label: ['red'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-yellow-500" />}
                        label={t('yellow')}
                        isActive={filters.color_label?.includes('yellow')}
                        onClick={() => getStore().setFilters({ color_label: ['yellow'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-green-500" />}
                        label={t('green')}
                        isActive={filters.color_label?.includes('green')}
                        onClick={() => getStore().setFilters({ color_label: ['green'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-blue-500" />}
                        label={t('blue')}
                        isActive={filters.color_label?.includes('blue')}
                        onClick={() => getStore().setFilters({ color_label: ['blue'] })}
                    />
                    <SidebarItem
                        icon={<div className="w-3 h-3 rounded-full bg-purple-500" />}
                        label={t('purple')}
                        isActive={filters.color_label?.includes('purple')}
                        onClick={() => getStore().setFilters({ color_label: ['purple'] })}
                    />
                </SidebarSection>

                {/* Folders Section */}
                <SidebarSection
                    title={t('folders')}
                    icon={<HardDrive size={16} />}
                    action={
                        <button
                            onClick={handleImportFolder}
                            className="p-1 text-gray-500 hover:text-white rounded"
                            title={t('importFolder')}
                        >
                            <Plus size={14} />
                        </button>
                    }
                >
                    <FolderTree />
                </SidebarSection>

                {/* Collections */}
                <SidebarSection
                    title={t('collections')}
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
                        <p className="px-3 py-2 text-xs text-gray-500">{t('noCollectionsYet')}</p>
                    ) : (
                        collections.map((collection) => (
                            <div
                                key={collection.id}
                                className="group flex items-center"
                            >
                                <button
                                    onClick={() => getStore().setActiveCollectionId(collection.id)}
                                    className={`flex-1 flex items-center justify-between px-3 py-1.5 text-sm rounded-l transition-colors
                                        ${activeCollectionId === collection.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <LayoutGrid size={14} />
                                        <span className="truncate">{collection.name}</span>
                                    </div>
                                    <span className={`text-xs ${activeCollectionId === collection.id ? 'text-blue-200' : 'text-gray-500'}`}>
                                        {collection.photo_count}
                                    </span>
                                </button>
                                <button
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete collection "${collection.name}"?`)) {
                                            await window.api.deleteCollection(collection.id);
                                            const updatedCollections = await window.api.getCollections();
                                            getStore().setCollections(updatedCollections);
                                            if (activeCollectionId === collection.id) {
                                                getStore().setActiveCollectionId(null);
                                            }
                                        }
                                    }}
                                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-r
                                               opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete collection"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))
                    )}
                </SidebarSection>

                {/* Keywords */}
                <SidebarSection
                    title={t('keywordsSection')}
                    icon={<Tag size={16} />}
                    defaultOpen={false}
                >
                    {keywords.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-500">{t('noKeywordsYet')}</p>
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

                {/* AIFACE - People Recognition */}
                <div className="mb-2">
                    <button
                        onClick={() => {
                            getStore().setViewMode('aiface');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium
                                   text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <ScanFace size={16} className="text-blue-400" />
                            <span>AIFACE</span>
                        </div>
                        {peopleCount > 0 && (
                            <span className="text-xs text-gray-500">{peopleCount}</span>
                        )}
                    </button>
                </div>

                {/* Albums / Photo Books */}
                <div className="mb-2">
                    <button
                        onClick={() => {
                            getStore().setViewMode('album');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium
                                   text-gray-300 hover:text-white hover:bg-gray-800 rounded transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <BookOpen size={16} className="text-blue-400" />
                            <span>Albums</span>
                        </div>
                    </button>
                </div>

                {/* Duplicates */}
                {duplicates.length > 0 && (
                    <SidebarSection
                        title={t('duplicates')}
                        icon={<Copy size={16} />}
                        defaultOpen={false}
                    >
                        <p className="px-3 py-2 text-xs text-gray-400">
                            {t('foundDuplicateGroups').replace('{count}', String(duplicates.length))}
                        </p>
                        {duplicates.slice(0, 10).map((dup, i) => (
                            <SidebarItem
                                key={i}
                                label={`${dup.photos.length} ${t('copies')}`}
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
                    {t('import')}
                </button>

                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg transition-all
                        hover:bg-gray-800"
                >
                    <Settings size={14} />
                    Settings
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
