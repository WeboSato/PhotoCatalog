import React, { useState, useEffect, useRef } from 'react';
import { X, FolderOpen, HardDrive, Database, Image, AlertTriangle, Check, Loader2, RefreshCw, Plus, Folder, Terminal, Trash2, Copy, Download, Upload } from 'lucide-react';

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
                alert('Catalogue créé avec succès! Redémarrez l\'application pour l\'utiliser.');
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
                alert('Catalogue ouvert avec succès! Redémarrez l\'application pour appliquer les changements.');
                onClose();
            } else if (result.error && result.error !== 'Annulé') {
                alert('Erreur: ' + result.error);
            }
        } catch (e) {
            console.error('Failed to open catalog:', e);
        }
    };

    const handleRegenerateThumbnails = async () => {
        setIsRegenerating(true);
        setLightroomProgress({ current: 0, total: 0, status: 'Démarrage...' });

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
        setLightroomProgress({ current: 0, total: 0, status: 'Synchronisation...' });

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
        setLightroomProgress({ current: 0, total: 0, status: 'Import en cours...' });

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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-lg w-[600px] max-h-[80vh] overflow-hidden shadow-xl border border-gray-700">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-white">Paramètres</h2>
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
                            Emplacement du catalogue
                        </h3>

                        {loading ? (
                            <div className="flex items-center gap-2 text-gray-500">
                                <Loader2 size={16} className="animate-spin" />
                                Chargement...
                            </div>
                        ) : catalogInfo ? (
                            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                                <div>
                                    <p className="text-xs text-gray-500">Base de données</p>
                                    <p className="text-sm text-gray-300 font-mono break-all">{catalogInfo.dbPath}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Taille: {formatBytes(catalogInfo.dbSize)}
                                    </p>
                                </div>

                                <div className="border-t border-gray-700 pt-3">
                                    <p className="text-xs text-gray-500">Cache des vignettes</p>
                                    <p className="text-sm text-gray-300 font-mono break-all">{catalogInfo.thumbPath}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {catalogInfo.thumbCount.toLocaleString()} vignettes ({formatBytes(catalogInfo.thumbSize)})
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-gray-500">Impossible de charger les informations</p>
                        )}
                    </div>

                    {/* New Catalog / Open Catalog */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Plus size={16} />
                            Gestion des catalogues
                        </h3>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowNewCatalogForm(!showNewCatalogForm)}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm"
                            >
                                <Plus size={16} />
                                Nouveau catalogue
                            </button>
                            <button
                                onClick={handleOpenExistingCatalog}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                            >
                                <Folder size={16} />
                                Ouvrir un catalogue
                            </button>
                        </div>

                        {showNewCatalogForm && (
                            <div className="bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-700">
                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">Nom du catalogue</label>
                                    <input
                                        type="text"
                                        value={newCatalogName}
                                        onChange={(e) => setNewCatalogName(e.target.value)}
                                        placeholder="Mon Catalogue Photo"
                                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500 block mb-1">Emplacement</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newCatalogLocation}
                                            placeholder="Sélectionnez un dossier..."
                                            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                            readOnly
                                        />
                                        <button
                                            onClick={handleSelectNewCatalogLocation}
                                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                                        >
                                            Parcourir...
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="copyCurrentData"
                                        checked={copyCurrentData}
                                        onChange={(e) => setCopyCurrentData(e.target.checked)}
                                        className="rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-blue-500"
                                    />
                                    <label htmlFor="copyCurrentData" className="text-sm text-gray-400">
                                        Copier les données du catalogue actuel
                                    </label>
                                </div>

                                <p className="text-xs text-gray-500">
                                    Structure: [Nom].pcdb + [Nom] Previews/ (16 dossiers hex comme Lightroom)
                                </p>

                                <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
                                    <button
                                        onClick={() => setShowNewCatalogForm(false)}
                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        onClick={handleCreateNewCatalog}
                                        disabled={!newCatalogName || !newCatalogLocation || isCreatingCatalog}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded text-sm"
                                    >
                                        {isCreatingCatalog ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Création...
                                            </>
                                        ) : (
                                            <>
                                                <Plus size={16} />
                                                Créer le catalogue
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
                            Déplacer le catalogue
                        </h3>

                        <p className="text-xs text-gray-500">
                            Choisissez un nouvel emplacement pour votre catalogue. Tous les fichiers seront copiés vers le nouvel emplacement.
                        </p>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newPath}
                                onChange={(e) => setNewPath(e.target.value)}
                                placeholder="Sélectionnez un dossier..."
                                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                readOnly
                            />
                            <button
                                onClick={handleSelectPath}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                            >
                                Parcourir...
                            </button>
                        </div>

                        {newPath && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleMigrate}
                                    disabled={isMigrating}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded text-sm"
                                >
                                    {isMigrating ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            Migration en cours...
                                        </>
                                    ) : (
                                        <>
                                            <HardDrive size={16} />
                                            Déplacer le catalogue
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
                                        <span className="text-sm">Catalogue déplacé avec succès! Redémarrez l'application pour appliquer les changements.</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={16} className="mt-0.5" />
                                        <span className="text-sm">Erreur: {migrationResult.error}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Rebuild Folder Hierarchy */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <RefreshCw size={16} />
                            Hiérarchie des dossiers
                        </h3>

                        <p className="text-xs text-gray-500">
                            Reconstruire la hiérarchie des dossiers pour afficher l'arborescence correctement dans le panneau latéral.
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
                                        Reconstruction...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw size={16} />
                                        Reconstruire la hiérarchie
                                    </>
                                )}
                            </button>
                        </div>

                        {rebuildResult && (
                            <div className="flex items-start gap-2 p-3 rounded bg-green-900/50 text-green-300">
                                <Check size={16} className="mt-0.5" />
                                <span className="text-sm">
                                    Hiérarchie reconstruite: {rebuildResult.updated} dossiers mis à jour, {rebuildResult.created} créés
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Lightroom Sync */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Database size={16} />
                            Synchronisation Lightroom
                        </h3>

                        <p className="text-xs text-gray-500">
                            Synchronisez ou importez les photos depuis votre catalogue Lightroom Classic.
                        </p>

                        {lightroomProgress && (
                            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{lightroomProgress.status}</span>
                                    <span>{lightroomProgress.current} / {lightroomProgress.total}</span>
                                </div>
                                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 transition-all duration-300"
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
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm transition-all"
                            >
                                {isSyncingLightroom ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Synchronisation...
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
                                        Régénération...
                                    </>
                                ) : (
                                    <>
                                        <Image size={16} />
                                        Régénérer vignettes
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Storage Info */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                            <Image size={16} />
                            Statistiques
                        </h3>

                        {catalogInfo && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-800 rounded-lg p-3">
                                    <p className="text-2xl font-bold text-white">
                                        {catalogInfo.thumbCount.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-gray-500">Vignettes en cache</p>
                                </div>
                                <div className="bg-gray-800 rounded-lg p-3">
                                    <p className="text-2xl font-bold text-white">
                                        {formatBytes(catalogInfo.dbSize + catalogInfo.thumbSize)}
                                    </p>
                                    <p className="text-xs text-gray-500">Espace total utilisé</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Application Logs */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                <Terminal size={16} />
                                Journal de l'application
                            </h3>
                            <button
                                onClick={() => {
                                    setShowLogs(!showLogs);
                                    if (!showLogs) {
                                        setLogs([...appLogs]);
                                    }
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300"
                            >
                                {showLogs ? 'Masquer' : 'Afficher'}
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
                                            <option value="all">Tous</option>
                                            <option value="error">Erreurs</option>
                                            <option value="warn">Avertissements</option>
                                            <option value="log">Infos</option>
                                        </select>
                                        <span className="text-xs text-gray-500">
                                            {logs.filter(l => logFilter === 'all' || l.level === logFilter).length} entrées
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setLogs([...appLogs])}
                                            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                            title="Rafraîchir"
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
                                            title="Copier"
                                        >
                                            <Copy size={14} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                clearAppLogs();
                                                setLogs([]);
                                            }}
                                            className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                                            title="Effacer"
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
                                                    'text-blue-400'
                                                }`}>
                                                    [{log.level.toUpperCase()}]
                                                </span>
                                                {' '}
                                                <span className="break-all">{log.message}</span>
                                            </div>
                                        ))}
                                    {logs.length === 0 && (
                                        <div className="px-3 py-4 text-center text-gray-500">
                                            Aucun log disponible
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
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
