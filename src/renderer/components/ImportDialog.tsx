import React, { useState, useEffect } from 'react';
import { X, Camera, FolderOpen, Tag, FileText, Check, Loader2 } from 'lucide-react';

interface ImportDialogProps {
    isOpen: boolean;
    sourcePath: string;
    sourceName: string;
    photoCount: number;
    onClose: () => void;
    onImport: (options: ImportOptions) => void;
}

export interface ImportOptions {
    sourcePath: string;
    destinationPath: string;
    subfolderName: string;
    keywords: string[];
    renamePattern: 'original' | 'date' | 'custom';
    customPattern?: string;
    deleteAfterImport: boolean;
}

const defaultDestination = '';

export const ImportDialog: React.FC<ImportDialogProps> = ({
    isOpen,
    sourcePath,
    sourceName,
    photoCount,
    onClose,
    onImport
}) => {
    const [destinationPath, setDestinationPath] = useState(defaultDestination);
    const [subfolderName, setSubfolderName] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const [keywordsInput, setKeywordsInput] = useState('');
    const [renamePattern, setRenamePattern] = useState<'original' | 'date' | 'custom'>('original');
    const [customPattern, setCustomPattern] = useState('IMG_{date}_{sequence}');
    const [deleteAfterImport, setDeleteAfterImport] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Reset state when dialog opens
            const now = new Date();
            setSubfolderName(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
            setKeywordsInput('');
            setIsImporting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBrowseDestination = async () => {
        const result = await window.api.openDirectoryDialog();
        if (result) {
            setDestinationPath(result);
        }
    };

    const handleImport = () => {
        setIsImporting(true);
        const keywords = keywordsInput
            .split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0);

        onImport({
            sourcePath,
            destinationPath,
            subfolderName,
            keywords,
            renamePattern,
            customPattern: renamePattern === 'custom' ? customPattern : undefined,
            deleteAfterImport
        });
    };

    const finalPath = subfolderName
        ? `${destinationPath}/${subfolderName}`
        : destinationPath;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70" onClick={onClose} />

            {/* Dialog */}
            <div className="relative bg-gray-800 rounded-lg shadow-2xl border border-gray-700 w-[600px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-blue-900/30">
                    <div className="flex items-center gap-3">
                        <Camera size={24} className="text-blue-400" />
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                Importer depuis {sourceName}
                            </h2>
                            <p className="text-sm text-blue-300">
                                {photoCount} photos détectées
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        disabled={isImporting}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
                    {/* Destination */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
                            <FolderOpen size={16} />
                            Destination
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={destinationPath}
                                onChange={(e) => setDestinationPath(e.target.value)}
                                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white"
                                disabled={isImporting}
                            />
                            <button
                                onClick={handleBrowseDestination}
                                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                                disabled={isImporting}
                            >
                                Parcourir...
                            </button>
                        </div>
                    </div>

                    {/* Subfolder name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Nom du sous-dossier
                        </label>
                        <input
                            type="text"
                            value={subfolderName}
                            onChange={(e) => setSubfolderName(e.target.value)}
                            placeholder="Ex: 2024-01-15_Mariage"
                            className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white"
                            disabled={isImporting}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Chemin final: {finalPath}
                        </p>
                    </div>

                    {/* Keywords */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
                            <Tag size={16} />
                            Mots-clés (séparés par des virgules)
                        </label>
                        <input
                            type="text"
                            value={keywordsInput}
                            onChange={(e) => setKeywordsInput(e.target.value)}
                            placeholder="Ex: mariage, portrait, extérieur"
                            className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white"
                            disabled={isImporting}
                        />
                    </div>

                    {/* Rename options */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
                            <FileText size={16} />
                            Renommer les fichiers
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="rename"
                                    checked={renamePattern === 'original'}
                                    onChange={() => setRenamePattern('original')}
                                    className="text-blue-500"
                                    disabled={isImporting}
                                />
                                <span className="text-sm text-gray-300">Garder le nom original</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="rename"
                                    checked={renamePattern === 'date'}
                                    onChange={() => setRenamePattern('date')}
                                    className="text-blue-500"
                                    disabled={isImporting}
                                />
                                <span className="text-sm text-gray-300">Date + séquence (2024-01-15_001.jpg)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="rename"
                                    checked={renamePattern === 'custom'}
                                    onChange={() => setRenamePattern('custom')}
                                    className="text-blue-500"
                                    disabled={isImporting}
                                />
                                <span className="text-sm text-gray-300">Personnalisé</span>
                            </label>
                            {renamePattern === 'custom' && (
                                <input
                                    type="text"
                                    value={customPattern}
                                    onChange={(e) => setCustomPattern(e.target.value)}
                                    placeholder="{date}_{sequence}"
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white ml-6"
                                    disabled={isImporting}
                                />
                            )}
                        </div>
                    </div>

                    {/* Delete after import */}
                    <div className="pt-2 border-t border-gray-700">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={deleteAfterImport}
                                onChange={(e) => setDeleteAfterImport(e.target.checked)}
                                className="text-blue-500 rounded"
                                disabled={isImporting}
                            />
                            <span className="text-sm text-gray-300">
                                Supprimer les photos de la carte après l'import
                            </span>
                        </label>
                        {deleteAfterImport && (
                            <p className="mt-1 ml-6 text-xs text-yellow-500">
                                Attention: Cette action est irréversible!
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded"
                        disabled={isImporting}
                    >
                        Annuler
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={isImporting || !destinationPath}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isImporting ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Importation...
                            </>
                        ) : (
                            <>
                                <Check size={16} />
                                Importer {photoCount} photos
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportDialog;
