import React, { useState, useEffect, useRef } from 'react';
import { X, FolderOpen, HardDrive, Database, Image, AlertTriangle, Check, Loader2, RefreshCw, Plus, Folder, Terminal, Trash2, Copy, Download, Upload, Globe } from 'lucide-react';
import { useTranslation } from '../i18n';
import type { Language } from '../i18n';

// Global log storage
const appLogs: { timestamp: Date; level: string; message: string; source: string }[] = [];
const MAX_LOGS = 500;

// Override console methods to capture logs
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
};

function addLog(level: string, source: string, ...args: any[]) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    appLogs.unshift({ timestamp: new Date(), level, message, source });

    // Keep only last MAX_LOGS
    if (appLogs.length > MAX_LOGS) {
        appLogs.pop();
    }
}

// Intercept console calls
console.log = (...args) => { addLog('log', 'renderer', ...args); originalConsole.log(...args); };
console.warn = (...args) => { addLog('warn', 'renderer', ...args); originalConsole.warn(...args); };
console.error = (...args) => { addLog('error', 'renderer', ...args); originalConsole.error(...args); };
console.info = (...args) => { addLog('info', 'renderer', ...args); originalConsole.info(...args); };

export function getAppLogs() {
    return appLogs;
}

export function clearAppLogs() {
    appLogs.length = 0;
}

interface CatalogInfo {
    dbPath: string;
    thumbPath: string;
    dbSize: number;
    thumbCount: number;
    thumbSize: number;
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null);
    const [newPath, setNewPath] = useState<string>('');
    const [isMigrating, setIsMigrating] = useState(false);
    const [migrationResult, setMigrationResult] = useState<{ success: boolean; error?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRebuilding, setIsRebuilding] = useState(false);
    const [rebuildResult, setRebuildResult] = useState<{ updated: number; created: number } | null>(null);

    // New Catalog state
    const [showNewCatalogForm, setShowNewCatalogForm] = useState(false);
    const [newCatalogName, setNewCatalogName] = useState('');
    const [newCatalogLocation, setNewCatalogLocation] = useState('');
    const [copyCurrentData, setCopyCurrentData] = useState(false);
    const [isCreatingCatalog, setIsCreatingCatalog] = useState(false);
    const [catalogCreateResult, setCatalogCreateResult] = useState<{ success: boolean; error?: string } | null>(null);

    // Logs state
    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState<typeof appLogs>([]);
    const [logFilter, setLogFilter] = useState<'all' | 'error' | 'warn' | 'log'>('all');
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Lightroom state
    const [isSyncingLightroom, setIsSyncingLightroom] = useState(false);
    const [isImportingLightroom, setIsImportingLightroom] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [lightroomProgress, setLightroomProgress] = useState<{ current: number; total: number; status?: string } | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadCatalogInfo();
        }
    }, [isOpen]);

    const loadCatalogInfo = async () => {
        setLoading(true);
        try {
            const info = await window.api.settingsGetCatalogInfo();
            setCatalogInfo(info);
        } catch (e) {
            console.error('Failed to load catalog info:', e);
        }
        setLoading(false);
    };

    const handleSelectPath = async () => {
        const path = await window.api.settingsSelectCatalogPath();
        if (path) {
            setNewPath(path);
            setMigrationResult(null);
        }
    };

    const handleMigrate = async () => {
        if (!newPath) return;

        setIsMigrating(true);
        setMigrationResult(null);

        try {
            const result = await window.api.settingsMigrateCatalog(newPath);
            setMigrationResult(result);

            if (result.success) {
                // Reload catalog info
                await loadCatalogInfo();
                setNewPath('');
            }
        } catch (e) {
            setMigrationResult({
                success: false,
                error: e instanceof Error ? e.message : String(e)
            });
        }

        setIsMigrating(false);
    };

    const handleRebuildHierarchy = async () => {
        setIsRebuilding(true);
        setRebuildResult(null);

        try {
            // Rebuild with the default Lightroom root path
            const result = await window.api.rebuildFolderHierarchy('');
            setRebuildResult(result);
        } catch (e) {
            console.error('Failed to rebuild folder hierarchy:', e);
        }

        setIsRebuilding(false);
    };

    const handleSelectNewCatalogLocation = async () => {
        const location = await window.api.catalogSelectLocation();
        if (location) {
            setNewCatalogLocation(location);
            setCatalogCreateResult(null);
        }
    };

    const handleCreateNewCatalog = async () => {
        if (!newCatalogName || !newCatalogLocation) return;

        setIsCreatingCatalog(true);
        setCatalogCreateResult(null);

        try {
            const result = await window.api.catalogCreate({
                name: newCatalogName,
                location: newCatalogLocation,
                copyCurrentData
            });

            setCatalogCreateResult(result);

            if (result.success) {
                // Reset form
                setNewCatalogName('');
                setNewCatalogLocation('');
                setCopyCurrentData(false);
                setShowNewCatalogForm(false);

                // Ask user to restart
                alert('Catalog created successfully! Restart the application to use it.');
            }
        } catch (e) {
            setCatalogCreateResult({
                success: false,
                error: e instanceof Error ? e.message : String(e)
            });
        }

        setIsCreatingCatalog(false);
    };

    const handleOpenExistingCatalog = async () => {
        try {
            const result = await window.api.catalogSelectAndOpen();
            if (result.success) {
                alert('Catalog opened successfully! Restart the application to apply changes.');
                onClose();
            } else if (result.error && result.error !== 'Cancelled') {
                alert('Error: ' + result.error);
            }
        } catch (e) {
            console.error('Failed to open catalog:', e);
        }
    };

    const handleRegenerateThumbnails = async () => {
        setIsRegenerating(true);
        setLightroomProgress({ current: 0, total: 0, status: 'Starting...' });

        try {
            const unsubscribe = window.api.onImportProgress((progress) => {
                setLightroomProgress({
                    current: progress.current,
                    total: progress.total,
                    status: progress.status
                });
            });

            await window.api.regenerateThumbnails();
            unsubscribe();
            setLightroomProgress(null);
        } catch (e) {
            console.error('Failed to regenerate thumbnails:', e);
        }

        setIsRegenerating(false);
    };

    const handleSyncLightroom = async () => {
        setIsSyncingLightroom(true);
        setLightroomProgress({ current: 0, total: 0, status: 'Syncing...' });

        try {
            const unsubscribe = window.api.onImportProgress((progress) => {
                setLightroomProgress({
                    current: progress.current,
                    total: progress.total,
                    status: progress.status
                });
            });

            await window.api.syncLightroom();
            unsubscribe();
            setLightroomProgress(null);

            // Reload catalog info after sync
            await loadCatalogInfo();
        } catch (e) {
            console.error('Failed to sync Lightroom:', e);
        }

        setIsSyncingLightroom(false);
    };

    const handleImportLightroom = async () => {
        setIsImportingLightroom(true);
        setLightroomProgress({ current: 0, total: 0, status: 'Importing...' });

        try {
            const unsubscribe = window.api.onImportProgress((progress) => {
                setLightroomProgress({
                    current: progress.current,
                    total: progress.total,
                    status: progress.status
                });
            });

            await window.api.importLightroom();
            unsubscribe();
            setLightroomProgress(null);

            // Reload catalog info after import
            await loadCatalogInfo();
        } catch (e) {
            console.error('Failed to import Lightroom:', e);
        }

        setIsImportingLightroom(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-strong rounded-xl w-[600px] max-h-[80vh] overflow-hidden shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-white">Settings</h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
                    {/* Current Catalog Location */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Database size={16} />
                            Catalog Location
                        </h3>

                        {loading ? (
                            <div className="flex items-center gap-2 text-gray-500">
                                <Loader2 size={16} className="animate-spin" />
                                Loading...
                            </div>
                        ) : catalogInfo ? (
                            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                                <div>
                                    <p className="text-xs text-gray-500">Database</p>
                                    <p className="text-sm text-gray-300 font-mono break-all">{catalogInfo.dbPath}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Size: {formatBytes(catalogInfo.dbSize)}
                                    </p>
                                </div>

                                <div className="border-t border-gray-700 pt-3">
                                    <p className="text-xs text-gray-500">Thumbnail Cache</p>
                                    <p className="text-sm text-gray-300 font-mono break-all">{catalogInfo.thumbPath}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {catalogInfo.thumbCount.toLocaleString()} thumbnails ({formatBytes(catalogInfo.thumbSize)})
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-gray-500">Unable to load information</p>
                        )}
                    </div>

                    {/* New Catalog / Open Catalog */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Plus size={16} />
                            Catalog Management
                        </h3>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowNewCatalogForm(!showNewCatalogForm)}
                                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded text-sm"
                            >
                                <Plus size={16} />
                                New Catalog
                            </button>
                            <button
                                onClick={handleOpenExistingCatalog}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                            >
                                <Folder size={16} />
                                Open Catalog
                            </button>
                        </div>

                        {showNewCatalogForm && (
                            <div className="bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-700">
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">Catalog Name</label>
                                    <input
                                        type="text"
                                        value={newCatalogName}
                                        onChange={(e) => setNewCatalogName(e.target.value)}
                                        placeholder="My Photo Catalog"
                                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/40"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">Location</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newCatalogLocation}
                                            placeholder="Select a folder..."
                                            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/40"
                                            readOnly
                                        />
                                        <button
                                            onClick={handleSelectNewCatalogLocation}
                                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                                        >
                                            Browse...
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="copyCurrentData"
                                        checked={copyCurrentData}
                                        onChange={(e) => setCopyCurrentData(e.target.checked)}
                                        className="rounded border-gray-700 bg-gray-900 text-gray-300 focus:ring-white/30"
                                    />
                                    <label htmlFor="copyCurrentData" className="text-sm text-gray-400">
                                        Copy current catalog data
                                    </label>
                                </div>

                                <p className="text-xs text-gray-500">
                                    Structure: [Name].pcdb + [Name] Previews/ (16 hex folders like Lightroom)
                                </p>

                                <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
                                    <button
                                        onClick={() => setShowNewCatalogForm(false)}
                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleCreateNewCatalog}
                                        disabled={!newCatalogName || !newCatalogLocation || isCreatingCatalog}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 disabled:bg-white/10 disabled:cursor-not-allowed text-white rounded text-sm"
                                    >
                                        {isCreatingCatalog ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Creating...
                                            </>
                                        ) : (
                                            <>
                                                <Plus size={16} />
                                                Create Catalog
                                            </>
                                        )}
                                    </button>
                                </div>

                                {catalogCreateResult && !catalogCreateResult.success && (
                                    <div className="flex items-start gap-2 p-3 rounded bg-red-900/50 text-red-300">
                                        <AlertTriangle size={16} className="mt-0.5" />
                                        <span className="text-sm">{catalogCreateResult.error}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Migrate Catalog */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <FolderOpen size={16} />
                            Move Catalog
                        </h3>

                        <p className="text-xs text-gray-500">
                            Choose a new location for your catalog. All files will be copied to the new location.
                        </p>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newPath}
                                onChange={(e) => setNewPath(e.target.value)}
                                placeholder="Select a folder..."
                                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/40"
                                readOnly
                            />
                            <button
                                onClick={handleSelectPath}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                            >
                                Browse...
                            </button>
                        </div>

                        {newPath && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleMigrate}
                                    disabled={isMigrating}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 disabled:bg-white/10 text-white rounded text-sm"
                                >
                                    {isMigrating ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            Migration in progress...
                                        </>
                                    ) : (
                                        <>
                                            <HardDrive size={16} />
                                            Move Catalog
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {migrationResult && (
                            <div className={`flex items-start gap-2 p-3 rounded ${
                                migrationResult.success
                                    ? 'bg-green-900/50 text-green-300'
                                    : 'bg-red-900/50 text-red-300'
                            }`}>
                                {migrationResult.success ? (
                                    <>
                                        <Check size={16} className="mt-0.5" />
                                        <span className="text-sm">Catalog moved successfully! Restart the application to apply changes.</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={16} className="mt-0.5" />
                                        <span className="text-sm">Error: {migrationResult.error}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Rebuild Folder Hierarchy */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <RefreshCw size={16} />
                            Folder Hierarchy
                        </h3>

                        <p className="text-xs text-gray-500">
                            Rebuild the folder hierarchy to display the tree correctly in the sidebar.
                        </p>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleRebuildHierarchy}
                                disabled={isRebuilding}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded text-sm"
                            >
                                {isRebuilding ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Rebuilding...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw size={16} />
                                        Rebuild Hierarchy
                                    </>
                                )}
                            </button>
                        </div>

                        {rebuildResult && (
                            <div className="flex items-start gap-2 p-3 rounded bg-green-900/50 text-green-300">
                                <Check size={16} className="mt-0.5" />
                                <span className="text-sm">
                                    Hierarchy rebuilt: {rebuildResult.updated} folders updated, {rebuildResult.created} created
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Lightroom Sync */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Database size={16} />
                            Lightroom Sync
                        </h3>

                        <p className="text-xs text-gray-500">
                            Sync or import photos from your Lightroom Classic catalog.
                        </p>

                        {lightroomProgress && (
                            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{lightroomProgress.status}</span>
                                    <span>{lightroomProgress.current} / {lightroomProgress.total}</span>
                                </div>
                                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-white/10 transition-all duration-300"
                                        style={{
                                            width: lightroomProgress.total > 0
                                                ? `${(lightroomProgress.current / lightroomProgress.total) * 100}%`
                                                : '0%'
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleSyncLightroom}
                                disabled={isSyncingLightroom || isImportingLightroom || isRegenerating}
                                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15/30 border border-white/25/30 text-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm transition-all"
                            >
                                {isSyncingLightroom ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw size={16} />
                                        Sync Lightroom
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleImportLightroom}
                                disabled={isSyncingLightroom || isImportingLightroom || isRegenerating}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm transition-all"
                            >
                                {isImportingLightroom ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Import...
                                    </>
                                ) : (
                                    <>
                                        <Download size={16} />
                                        Import Lightroom
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleRegenerateThumbnails}
                                disabled={isSyncingLightroom || isImportingLightroom || isRegenerating}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isRegenerating ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Regenerating...
                                    </>
                                ) : (
                                    <>
                                        <Image size={16} />
                                        Regenerate Thumbnails
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Storage Info */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Image size={16} />
                            Statistics
                        </h3>

                        {catalogInfo && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-800 rounded-lg p-3">
                                    <p className="text-2xl font-bold text-white">
                                        {catalogInfo.thumbCount.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-gray-500">Cached thumbnails</p>
                                </div>
                                <div className="bg-gray-800 rounded-lg p-3">
                                    <p className="text-2xl font-bold text-white">
                                        {formatBytes(catalogInfo.dbSize + catalogInfo.thumbSize)}
                                    </p>
                                    <p className="text-xs text-gray-500">Total space used</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Language Settings */}
                    <LanguageSection />

                    {/* Application Logs */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                <Terminal size={16} />
                                Application Log
                            </h3>
                            <button
                                onClick={() => {
                                    setShowLogs(!showLogs);
                                    if (!showLogs) {
                                        setLogs([...appLogs]);
                                    }
                                }}
                                className="text-xs text-gray-200 hover:text-white"
                            >
                                {showLogs ? 'Hide' : 'Show'}
                            </button>
                        </div>

                        {showLogs && (
                            <div className="bg-gray-800 rounded-lg border border-gray-700">
                                {/* Log controls */}
                                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={logFilter}
                                            onChange={(e) => setLogFilter(e.target.value as any)}
                                            className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-300"
                                        >
                                            <option value="all">All</option>
                                            <option value="error">Errors</option>
                                            <option value="warn">Warnings</option>
                                            <option value="log">Info</option>
                                        </select>
                                        <span className="text-xs text-gray-500">
                                            {logs.filter(l => logFilter === 'all' || l.level === logFilter).length} entries
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setLogs([...appLogs])}
                                            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                            title="Refresh"
                                        >
                                            <RefreshCw size={14} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                const text = logs
                                                    .filter(l => logFilter === 'all' || l.level === logFilter)
                                                    .map(l => `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] ${l.message}`)
                                                    .join('\n');
                                                navigator.clipboard.writeText(text);
                                            }}
                                            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                            title="Copy"
                                        >
                                            <Copy size={14} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                clearAppLogs();
                                                setLogs([]);
                                            }}
                                            className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                                            title="Clear"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Log entries */}
                                <div className="h-64 overflow-y-auto font-mono text-xs">
                                    {logs
                                        .filter(l => logFilter === 'all' || l.level === logFilter)
                                        .map((log, i) => (
                                            <div
                                                key={i}
                                                className={`px-3 py-1 border-b border-gray-700/50 ${
                                                    log.level === 'error' ? 'bg-red-900/20 text-red-300' :
                                                    log.level === 'warn' ? 'bg-yellow-900/20 text-yellow-300' :
                                                    'text-gray-400'
                                                }`}
                                            >
                                                <span className="text-gray-600">
                                                    {log.timestamp.toLocaleTimeString()}
                                                </span>
                                                {' '}
                                                <span className={`font-bold ${
                                                    log.level === 'error' ? 'text-red-400' :
                                                    log.level === 'warn' ? 'text-yellow-400' :
                                                    'text-gray-200'
                                                }`}>
                                                    [{log.level.toUpperCase()}]
                                                </span>
                                                {' '}
                                                <span className="break-all">{log.message}</span>
                                            </div>
                                        ))}
                                    {logs.length === 0 && (
                                        <div className="px-3 py-4 text-center text-gray-500">
                                            No logs available
                                        </div>
                                    )}
                                    <div ref={logsEndRef} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end px-6 py-4 border-t border-gray-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// Language Settings Component
const LanguageSection: React.FC = () => {
    const { language, setLanguage } = useTranslation();

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Globe size={16} />
                Language / Langue
            </h3>
            <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-3">
                    Choose your preferred language / Choisissez votre langue préférée
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={() => setLanguage('en')}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                            language === 'en'
                                ? 'bg-white/10 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        English
                    </button>
                    <button
                        onClick={() => setLanguage('fr')}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                            language === 'fr'
                                ? 'bg-white/10 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        Français
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
