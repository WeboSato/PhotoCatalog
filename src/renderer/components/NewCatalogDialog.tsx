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
    const [catalogName, setCatalogName] = useState('My Catalog');
    const [location, setLocation] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setCatalogName('My Catalog');
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
            setError('Please enter a catalog name');
            return;
        }
        if (!location) {
            setError('Please select a location');
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
                    setError(openResult.error || 'Error opening catalog');
                    setIsCreating(false);
                }
            } else {
                setError(result.error || 'Error creating catalog');
                setIsCreating(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setIsCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70" onClick={onClose} />

            {/* Dialog */}
            <div className="relative glass-strong rounded-xl shadow-2xl w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-green-900/30">
                    <div className="flex items-center gap-3">
                        <FolderPlus size={24} className="text-green-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                New Catalog
                            </h2>
                            <p className="text-sm text-green-300">
                                Create a new PhotoCatalog catalog
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
                            Catalog Name
                        </label>
                        <input
                            type="text"
                            value={catalogName}
                            onChange={(e) => setCatalogName(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                            placeholder="My Catalog"
                            disabled={isCreating}
                        />
                    </div>

                    {/* Location */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Location
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={location}
                                readOnly
                                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none"
                                placeholder="Select a folder..."
                            />
                            <button
                                onClick={handleSelectLocation}
                                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors flex items-center gap-2"
                                disabled={isCreating}
                            >
                                <FolderOpen size={16} />
                                Browse
                            </button>
                        </div>
                        {location && (
                            <p className="mt-2 text-xs text-gray-400">
                                The catalog will be created in: {location}/{catalogName.trim() || 'My Catalog'}
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
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating || !catalogName.trim() || !location}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                    >
                        {isCreating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <FolderPlus size={16} />
                                Create Catalog
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
