import React, { useState, useEffect } from 'react';
import {
    Camera,
    FolderOpen,
    Download,
    ArrowRight,
    ArrowLeft,
    Sparkles,
    CheckCircle2,
    Loader2,
    Image,
    Palette,
    Database,
    Search,
    HardDrive,
    Plus
} from 'lucide-react';
import { useTranslation } from '../i18n';

interface OnboardingWizardProps {
    isOpen: boolean;
    onComplete: () => void;
}

type Step = 'welcome' | 'existing' | 'location' | 'import' | 'complete';

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
    isOpen,
    onComplete
}) => {
    const { t, language } = useTranslation();
    const [currentStep, setCurrentStep] = useState<Step>('welcome');
    const [catalogName, setCatalogName] = useState('PhotoCatalog');
    const [location, setLocation] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [foundCatalogs, setFoundCatalogs] = useState<string[]>([]);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setCurrentStep('welcome');
            setCatalogName('PhotoCatalog');
            setLocation('');
            setIsCreating(false);
            setIsScanning(false);
            setFoundCatalogs([]);
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // Scan for existing catalogs
    const handleScanCatalogs = async () => {
        setIsScanning(true);
        setError(null);
        try {
            // Search common locations for catalog.db files
            const result = await window.api.scanForCatalogs();
            if (result && result.length > 0) {
                setFoundCatalogs(result);
            } else {
                setFoundCatalogs([]);
                setError(language === 'fr'
                    ? 'Aucun catalogue trouvé. Utilisez "Parcourir" pour localiser manuellement.'
                    : 'No catalogs found. Use "Browse" to locate manually.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Scan error');
        } finally {
            setIsScanning(false);
        }
    };

    // Browse for existing catalog
    const handleBrowseExisting = async () => {
        try {
            const result = await window.api.catalogSelectAndOpen();
            if (result.success) {
                localStorage.setItem('photocatalog-onboarding-complete', 'true');
                onComplete();
                window.location.reload();
            } else if (result.error && result.error !== 'Cancelled') {
                setError(result.error);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error opening catalog');
        }
    };

    // Open a found catalog
    const handleOpenFoundCatalog = async (catalogPath: string) => {
        try {
            const result = await window.api.catalogOpen(catalogPath);
            if (result.success) {
                localStorage.setItem('photocatalog-onboarding-complete', 'true');
                onComplete();
                window.location.reload();
            } else {
                setError(result.error || 'Error opening catalog');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error opening catalog');
        }
    };

    const handleSelectLocation = async () => {
        const result = await window.api.catalogSelectLocation();
        if (result) {
            setLocation(result);
        }
    };

    const handleCreateCatalog = async () => {
        if (!location) {
            setError(language === 'fr' ? 'Veuillez sélectionner un emplacement' : 'Please select a location');
            return;
        }

        setIsCreating(true);
        setError(null);

        try {
            const result = await window.api.catalogCreate({
                name: catalogName.trim() || 'PhotoCatalog',
                location: location,
                copyCurrentData: false
            });

            if (result.success && result.catalogPath) {
                const openResult = await window.api.catalogOpen(result.catalogPath);
                if (openResult.success) {
                    setCurrentStep('import');
                } else {
                    setError(openResult.error || 'Error opening catalog');
                }
            } else {
                setError(result.error || 'Error creating catalog');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleImportLightroom = async () => {
        setIsImporting(true);
        setError(null);

        try {
            // Find best Lightroom catalog
            const catalog = await window.api.lightroomFindBestCatalog();

            if (!catalog) {
                // No catalog found, let user select
                const selectedPath = await window.api.lightroomSelectCatalog();
                if (!selectedPath) {
                    setIsImporting(false);
                    return;
                }

                // Listen for progress
                const unsubscribe = window.api.onLightroomProgress((progress) => {
                    setImportProgress({ current: progress.current || 0, total: progress.total || 0 });
                });

                await window.api.lightroomImportAll(selectedPath);
                unsubscribe();
            } else {
                // Listen for progress
                const unsubscribe = window.api.onLightroomProgress((progress) => {
                    setImportProgress({ current: progress.current || 0, total: progress.total || 0 });
                });

                await window.api.lightroomImportAll(catalog.path);
                unsubscribe();
            }

            setCurrentStep('complete');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import error');
            setIsImporting(false);
        }
    };

    const handleSkipImport = () => {
        setCurrentStep('complete');
    };

    const handleFinish = () => {
        // Mark onboarding as complete
        localStorage.setItem('photocatalog-onboarding-complete', 'true');
        onComplete();
        window.location.reload();
    };

    const steps: Step[] = ['welcome', 'existing', 'location', 'import', 'complete'];
    const currentIndex = steps.indexOf(currentStep);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop with gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />

            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute top-20 left-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
                <div className="absolute top-1/2 left-1/2 w-48 h-48 bg-green-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
            </div>

            {/* Main container */}
            <div className="relative w-full max-w-2xl mx-4">
                {/* Progress bar */}
                <div className="mb-6 flex items-center justify-center gap-2">
                    {steps.map((step, index) => (
                        <React.Fragment key={step}>
                            <div
                                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                                    index <= currentIndex
                                        ? 'bg-blue-500 scale-100'
                                        : 'bg-gray-600 scale-75'
                                }`}
                            />
                            {index < steps.length - 1 && (
                                <div
                                    className={`w-12 h-0.5 transition-all duration-300 ${
                                        index < currentIndex ? 'bg-blue-500' : 'bg-gray-600'
                                    }`}
                                />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* Card */}
                <div className="bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-700/50 overflow-hidden">

                    {/* Welcome Step */}
                    {currentStep === 'welcome' && (
                        <div className="p-8 text-center">
                            {/* Logo/Icon */}
                            <div className="mb-6 inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25">
                                <Camera size={48} className="text-white" />
                            </div>

                            {/* Title */}
                            <h1 className="text-3xl font-bold text-white mb-3">
                                {language === 'fr' ? 'Bienvenue dans PhotoCatalog' : 'Welcome to PhotoCatalog'}
                            </h1>

                            {/* Subtitle */}
                            <p className="text-lg text-gray-300 mb-8 max-w-md mx-auto">
                                {language === 'fr'
                                    ? 'Votre alternative à Lightroom, optimisée pour Affinity Photo'
                                    : 'Your Lightroom alternative, optimized for Affinity Photo'}
                            </p>

                            {/* Choice: Existing or New */}
                            <div className="space-y-4 mb-6">
                                {/* Existing Catalog Option */}
                                <button
                                    onClick={() => setCurrentStep('existing')}
                                    className="w-full p-6 bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 border border-green-500/30 rounded-xl text-left transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-green-500/30 flex items-center justify-center">
                                            <HardDrive size={24} className="text-green-400" />
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-white mb-1">
                                                {language === 'fr' ? "J'ai déjà un catalogue" : 'I have an existing catalog'}
                                            </h3>
                                            <p className="text-sm text-gray-400">
                                                {language === 'fr'
                                                    ? 'Ouvrir un catalogue PhotoCatalog existant'
                                                    : 'Open an existing PhotoCatalog catalog'}
                                            </p>
                                        </div>
                                        <ArrowRight size={20} className="text-gray-400 group-hover:text-green-400 transition-colors" />
                                    </div>
                                </button>

                                {/* New Catalog Option */}
                                <button
                                    onClick={() => setCurrentStep('location')}
                                    className="w-full p-6 bg-gradient-to-r from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 border border-blue-500/30 rounded-xl text-left transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-blue-500/30 flex items-center justify-center">
                                            <Plus size={24} className="text-blue-400" />
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-white mb-1">
                                                {language === 'fr' ? 'Créer un nouveau catalogue' : 'Create a new catalog'}
                                            </h3>
                                            <p className="text-sm text-gray-400">
                                                {language === 'fr'
                                                    ? 'Commencer avec un catalogue vide'
                                                    : 'Start with an empty catalog'}
                                            </p>
                                        </div>
                                        <ArrowRight size={20} className="text-gray-400 group-hover:text-blue-400 transition-colors" />
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Existing Catalog Step */}
                    {currentStep === 'existing' && (
                        <div className="p-8">
                            {/* Header */}
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                                    <HardDrive size={32} className="text-green-400" />
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">
                                    {language === 'fr' ? 'Ouvrir un catalogue existant' : 'Open existing catalog'}
                                </h2>
                                <p className="text-gray-400">
                                    {language === 'fr'
                                        ? 'Scannez votre ordinateur ou parcourez manuellement'
                                        : 'Scan your computer or browse manually'}
                                </p>
                            </div>

                            {/* Options */}
                            <div className="space-y-4 mb-6">
                                {/* Scan Button */}
                                <button
                                    onClick={handleScanCatalogs}
                                    disabled={isScanning}
                                    className="w-full p-5 bg-gray-700/50 hover:bg-gray-700/70 border border-gray-600 rounded-xl text-left transition-all group disabled:opacity-50"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/30 flex items-center justify-center">
                                            {isScanning ? (
                                                <Loader2 size={20} className="text-blue-400 animate-spin" />
                                            ) : (
                                                <Search size={20} className="text-blue-400" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-white">
                                                {language === 'fr' ? 'Scanner mon ordinateur' : 'Scan my computer'}
                                            </h3>
                                            <p className="text-sm text-gray-400">
                                                {language === 'fr'
                                                    ? 'Recherche automatique des catalogues'
                                                    : 'Automatically search for catalogs'}
                                            </p>
                                        </div>
                                    </div>
                                </button>

                                {/* Browse Button */}
                                <button
                                    onClick={handleBrowseExisting}
                                    className="w-full p-5 bg-gray-700/50 hover:bg-gray-700/70 border border-gray-600 rounded-xl text-left transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-green-500/30 flex items-center justify-center">
                                            <FolderOpen size={20} className="text-green-400" />
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-white">
                                                {language === 'fr' ? 'Parcourir...' : 'Browse...'}
                                            </h3>
                                            <p className="text-sm text-gray-400">
                                                {language === 'fr'
                                                    ? 'Sélectionner manuellement le dossier du catalogue'
                                                    : 'Manually select the catalog folder'}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            </div>

                            {/* Found Catalogs */}
                            {foundCatalogs.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-medium text-gray-300 mb-3">
                                        {language === 'fr' ? 'Catalogues trouvés:' : 'Found catalogs:'}
                                    </h3>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {foundCatalogs.map((catalog, index) => (
                                            <button
                                                key={index}
                                                onClick={() => handleOpenFoundCatalog(catalog)}
                                                className="w-full p-3 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-lg text-left transition-all"
                                            >
                                                <p className="text-sm text-green-300 truncate">{catalog}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Error */}
                            {error && (
                                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 mb-4">
                                    {error}
                                </div>
                            )}

                            {/* Back button */}
                            <div className="flex justify-start">
                                <button
                                    onClick={() => {
                                        setCurrentStep('welcome');
                                        setFoundCatalogs([]);
                                        setError(null);
                                    }}
                                    className="inline-flex items-center gap-2 px-6 py-3 text-gray-400 hover:text-white transition-colors"
                                >
                                    <ArrowLeft size={18} />
                                    {language === 'fr' ? 'Retour' : 'Back'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Location Step */}
                    {currentStep === 'location' && (
                        <div className="p-8">
                            {/* Header */}
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                                    <FolderOpen size={32} className="text-green-400" />
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">
                                    {language === 'fr' ? 'Où stocker votre catalogue?' : 'Where to store your catalog?'}
                                </h2>
                                <p className="text-gray-400">
                                    {language === 'fr'
                                        ? 'Choisissez l\'emplacement de votre bibliothèque photo'
                                        : 'Choose where to store your photo library'}
                                </p>
                            </div>

                            {/* Form */}
                            <div className="space-y-4 mb-6">
                                {/* Catalog Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        {language === 'fr' ? 'Nom du catalogue' : 'Catalog Name'}
                                    </label>
                                    <input
                                        type="text"
                                        value={catalogName}
                                        onChange={(e) => setCatalogName(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                        placeholder="PhotoCatalog"
                                    />
                                </div>

                                {/* Location */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        {language === 'fr' ? 'Emplacement' : 'Location'}
                                    </label>
                                    <div className="flex gap-3">
                                        <input
                                            type="text"
                                            value={location}
                                            readOnly
                                            className="flex-1 px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none cursor-pointer"
                                            placeholder={language === 'fr' ? 'Cliquez pour sélectionner...' : 'Click to select...'}
                                            onClick={handleSelectLocation}
                                        />
                                        <button
                                            onClick={handleSelectLocation}
                                            className="px-4 py-3 bg-gray-600 hover:bg-gray-500 rounded-xl transition-colors flex items-center gap-2 text-white"
                                        >
                                            <FolderOpen size={18} />
                                            {language === 'fr' ? 'Parcourir' : 'Browse'}
                                        </button>
                                    </div>
                                </div>

                                {/* Preview */}
                                {location && (
                                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                                        <p className="text-sm text-blue-300">
                                            <span className="font-medium">
                                                {language === 'fr' ? 'Le catalogue sera créé dans:' : 'Catalog will be created in:'}
                                            </span>
                                            <br />
                                            <code className="text-blue-200">{location}/{catalogName || 'PhotoCatalog'}</code>
                                        </p>
                                    </div>
                                )}

                                {/* Error */}
                                {error && (
                                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
                                        {error}
                                    </div>
                                )}
                            </div>

                            {/* Buttons */}
                            <div className="flex justify-between">
                                <button
                                    onClick={() => setCurrentStep('welcome')}
                                    className="inline-flex items-center gap-2 px-6 py-3 text-gray-400 hover:text-white transition-colors"
                                >
                                    <ArrowLeft size={18} />
                                    {language === 'fr' ? 'Retour' : 'Back'}
                                </button>
                                <button
                                    onClick={handleCreateCatalog}
                                    disabled={!location || isCreating}
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all"
                                >
                                    {isCreating ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            {language === 'fr' ? 'Création...' : 'Creating...'}
                                        </>
                                    ) : (
                                        <>
                                            {language === 'fr' ? 'Créer le catalogue' : 'Create Catalog'}
                                            <ArrowRight size={18} />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Import Step */}
                    {currentStep === 'import' && (
                        <div className="p-8">
                            {/* Header */}
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/20 mb-4">
                                    <Download size={32} className="text-orange-400" />
                                </div>
                                <h2 className="text-2xl font-bold text-white mb-2">
                                    {language === 'fr' ? 'Importer depuis Lightroom?' : 'Import from Lightroom?'}
                                </h2>
                                <p className="text-gray-400 max-w-md mx-auto">
                                    {language === 'fr'
                                        ? 'Migrez facilement vos photos, notes et collections depuis votre catalogue Lightroom existant'
                                        : 'Easily migrate your photos, ratings and collections from your existing Lightroom catalog'}
                                </p>
                            </div>

                            {/* Import Options */}
                            {!isImporting ? (
                                <div className="space-y-4 mb-6">
                                    {/* Lightroom Import Option */}
                                    <button
                                        onClick={handleImportLightroom}
                                        className="w-full p-6 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 hover:from-orange-500/30 hover:to-yellow-500/30 border border-orange-500/30 rounded-xl text-left transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full bg-orange-500/30 flex items-center justify-center">
                                                <Download size={24} className="text-orange-400" />
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-white mb-1">
                                                    {language === 'fr' ? 'Importer depuis Lightroom' : 'Import from Lightroom'}
                                                </h3>
                                                <p className="text-sm text-gray-400">
                                                    {language === 'fr'
                                                        ? 'Détecte automatiquement votre catalogue Lightroom Classic'
                                                        : 'Automatically detects your Lightroom Classic catalog'}
                                                </p>
                                            </div>
                                            <ArrowRight size={20} className="text-gray-400 group-hover:text-orange-400 transition-colors" />
                                        </div>
                                    </button>

                                    {/* Skip Option */}
                                    <button
                                        onClick={handleSkipImport}
                                        className="w-full p-6 bg-gray-700/30 hover:bg-gray-700/50 border border-gray-600 rounded-xl text-left transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full bg-gray-600/50 flex items-center justify-center">
                                                <Sparkles size={24} className="text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-white mb-1">
                                                    {language === 'fr' ? 'Commencer à zéro' : 'Start Fresh'}
                                                </h3>
                                                <p className="text-sm text-gray-400">
                                                    {language === 'fr'
                                                        ? 'Créer un nouveau catalogue vide'
                                                        : 'Create a new empty catalog'}
                                                </p>
                                            </div>
                                            <ArrowRight size={20} className="text-gray-400 group-hover:text-white transition-colors" />
                                        </div>
                                    </button>
                                </div>
                            ) : (
                                /* Import Progress */
                                <div className="py-8">
                                    <div className="flex flex-col items-center">
                                        <Loader2 size={48} className="text-orange-400 animate-spin mb-4" />
                                        <p className="text-lg text-white mb-2">
                                            {language === 'fr' ? 'Importation en cours...' : 'Importing...'}
                                        </p>
                                        <p className="text-sm text-gray-400">
                                            {importProgress.total > 0
                                                ? `${importProgress.current} / ${importProgress.total}`
                                                : language === 'fr' ? 'Recherche du catalogue...' : 'Searching for catalog...'}
                                        </p>
                                        {importProgress.total > 0 && (
                                            <div className="w-full max-w-xs mt-4 h-2 bg-gray-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all"
                                                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Error */}
                            {error && (
                                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 mb-4">
                                    {error}
                                </div>
                            )}

                            {/* Back button */}
                            {!isImporting && (
                                <div className="flex justify-start">
                                    <button
                                        onClick={() => setCurrentStep('location')}
                                        className="inline-flex items-center gap-2 px-6 py-3 text-gray-400 hover:text-white transition-colors"
                                    >
                                        <ArrowLeft size={18} />
                                        {language === 'fr' ? 'Retour' : 'Back'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Complete Step */}
                    {currentStep === 'complete' && (
                        <div className="p-8 text-center">
                            {/* Success Icon */}
                            <div className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20">
                                <CheckCircle2 size={48} className="text-green-400" />
                            </div>

                            {/* Title */}
                            <h2 className="text-2xl font-bold text-white mb-3">
                                {language === 'fr' ? 'Tout est prêt!' : 'You\'re all set!'}
                            </h2>

                            {/* Message */}
                            <p className="text-gray-400 mb-8 max-w-md mx-auto">
                                {language === 'fr'
                                    ? 'Votre catalogue PhotoCatalog est prêt. Commencez à importer vos photos!'
                                    : 'Your PhotoCatalog is ready. Start importing your photos!'}
                            </p>

                            {/* Tips */}
                            <div className="bg-gray-700/30 rounded-xl p-6 mb-8 text-left">
                                <h3 className="font-semibold text-white mb-3">
                                    {language === 'fr' ? 'Conseils pour commencer:' : 'Tips to get started:'}
                                </h3>
                                <ul className="space-y-2 text-sm text-gray-300">
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400 mt-0.5">•</span>
                                        {language === 'fr'
                                            ? 'Glissez-déposez des photos ou dossiers pour les importer'
                                            : 'Drag and drop photos or folders to import them'}
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400 mt-0.5">•</span>
                                        {language === 'fr'
                                            ? 'Double-cliquez sur une photo pour l\'ouvrir dans Affinity Photo'
                                            : 'Double-click a photo to open it in Affinity Photo'}
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400 mt-0.5">•</span>
                                        {language === 'fr'
                                            ? 'Utilisez les étoiles (1-5) et drapeaux pour organiser'
                                            : 'Use stars (1-5) and flags to organize'}
                                    </li>
                                </ul>
                            </div>

                            {/* Finish Button */}
                            <button
                                onClick={handleFinish}
                                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold rounded-xl shadow-lg shadow-green-500/25 transition-all hover:scale-105"
                            >
                                {language === 'fr' ? 'Commencer à utiliser PhotoCatalog' : 'Start Using PhotoCatalog'}
                                <Sparkles size={20} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
