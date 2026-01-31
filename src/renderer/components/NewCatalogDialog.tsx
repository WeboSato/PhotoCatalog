import React, { useState, useEffect } from 'react';
import { X, FolderPlus, FolderOpen, Loader2 } from 'lucide-react';

interface NewCatalogDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
}

export const NewCatalogDialog: React.FC<NewCatalogDialogProps> = ({
    isOpen,
    onClose,
    onCreated
}) => {
    const [catalogName, setCatalogName] = useState('Mon Catalogue');
    const [location, setLocation] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setCatalogName('Mon Catalogue');
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

    const handleCreate = async () => {
        if (!catalogName.trim()) {
            setError('Veuillez entrer un nom pour le catalogue');
            return;
        }
        if (!location) {
            setError('Veuillez sélectionner un emplacement');
            return;
        }

        setIsCreating(true);
        setError(null);

        try {
            const result = await window.api.catalogCreate({
                name: catalogName.trim(),
                location: location,
                copyCurrentData: false
            });

            if (result.success && result.catalogPath) {
                // Open the newly created catalog
                const openResult = await window.api.catalogOpen(result.catalogPath);
                if (openResult.success) {
                    onCreated();
                } else {
                    setError(openResult.error || 'Erreur lors de l\'ouverture du catalogue');
                    setIsCreating(false);
                }
            } else {
                setError(result.error || 'Erreur lors de la création du catalogue');
                setIsCreating(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur inconnue');
            setIsCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70" onClick={onClose} />

            {/* Dialog */}
            <div className="relative bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-green-900/30">
                    <div className="flex items-center gap-3">
                        <FolderPlus size={24} className="text-green-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                Nouveau catalogue
                            </h2>
                            <p className="text-sm text-green-300">
                                Créer un nouveau catalogue PhotoCatalog
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
                        disabled={isCreating}
                    >
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Catalog Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Nom du catalogue
                        </label>
                        <input
                            type="text"
                            value={catalogName}
                            onChange={(e) => setCatalogName(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                            placeholder="Mon Catalogue"
                            disabled={isCreating}
                        />
                    </div>

                    {/* Location */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Emplacement
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={location}
                                readOnly
                                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none"
                                placeholder="Sélectionner un dossier..."
                            />
                            <button
                                onClick={handleSelectLocation}
                                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors flex items-center gap-2"
                                disabled={isCreating}
                            >
                                <FolderOpen size={16} />
                                Parcourir
                            </button>
                        </div>
                        {location && (
                            <p className="mt-2 text-xs text-gray-400">
                                Le catalogue sera créé dans: {location}/{catalogName.trim() || 'Mon Catalogue'}
                            </p>
                        )}
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        disabled={isCreating}
                    >
                        Annuler
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating || !catalogName.trim() || !location}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                    >
                        {isCreating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Création...
                            </>
                        ) : (
                            <>
                                <FolderPlus size={16} />
                                Créer le catalogue
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
