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
    Database
} from 'lucide-react';
import { useTranslation } from '../i18n';

interface OnboardingWizardProps {
    isOpen: boolean;
    onComplete: () => void;
}

type Step = 'welcome' | 'location' | 'import' | 'complete';

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
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setCurrentStep('welcome');
            setCatalogName('PhotoCatalog');
            setLocation('');
            setIsCreating(false);
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

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

    const steps: Step[] = ['welcome', 'location', 'import', 'complete'];
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

                            {/* Features */}
                            <div className="grid grid-cols-3 gap-4 mb-8">
                                <div className="p-4 bg-gray-700/50 rounded-xl">
                                    <Image size={28} className="text-blue-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-300">
                                        {language === 'fr' ? 'Organisez vos photos' : 'Organize your photos'}
                                    </p>
                                </div>
                                <div className="p-4 bg-gray-700/50 rounded-xl">
                                    <Palette size={28} className="text-purple-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-300">
                                        {language === 'fr' ? 'Éditez avec Affinity' : 'Edit with Affinity'}
                                    </p>
                                </div>
                                <div className="p-4 bg-gray-700/50 rounded-xl">
                                    <Database size={28} className="text-green-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-300">
                                        {language === 'fr' ? 'Catalogue local' : 'Local catalog'}
                                    </p>
                                </div>
                            </div>

                            {/* CTA Button */}
                            <button
                                onClick={() => setCurrentStep('location')}
                                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:scale-105"
                            >
                                {language === 'fr' ? 'Commencer' : 'Get Started'}
                                <ArrowRight size={20} />
                            </button>
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
