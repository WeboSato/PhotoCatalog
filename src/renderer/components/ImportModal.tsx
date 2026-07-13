import React, { useEffect } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { X, FolderOpen, Loader2, Check, AlertCircle } from 'lucide-react';

export const ImportModal: React.FC = () => {
    const isImporting = useCatalogStore((s) => s.isImporting);
    const importProgress = useCatalogStore((s) => s.importProgress);
    const setIsImporting = useCatalogStore((s) => s.setIsImporting);
    const setImportProgress = useCatalogStore((s) => s.setImportProgress);

    useEffect(() => {
        const unsubscribe = window.api.onImportProgress((progress) => {
            setImportProgress(progress);
            if (progress.phase === 'complete' || progress.phase === 'error') {
                // Auto-close after completion
                setTimeout(() => {
                    setIsImporting(false);
                    setImportProgress(null);
                }, 2000);
            }
        });

        return () => unsubscribe();
    }, []);

    if (!isImporting || !importProgress) {
        return null;
    }

    const getPhaseLabel = (phase: string) => {
        switch (phase) {
            case 'scanning':
                return 'Scanning for photos...';
            case 'importing':
                return 'Importing photos...';
            case 'thumbnails':
                return 'Generating thumbnails...';
            case 'complete':
                return 'Import complete!';
            case 'error':
                return 'Import failed';
            default:
                return 'Processing...';
        }
    };

    const getProgressPercent = () => {
        if (importProgress.total === 0) return 0;
        return Math.round((importProgress.current / importProgress.total) * 100);
    };

    const isComplete = importProgress.phase === 'complete';
    const isError = importProgress.phase === 'error';

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${
                            isComplete ? 'bg-green-500/20 text-green-400' :
                            isError ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-gray-200'
                        }`}>
                            {isComplete ? <Check size={20} /> :
                             isError ? <AlertCircle size={20} /> :
                             <Loader2 size={20} className="animate-spin" />}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                {isComplete ? 'Import Complete' : isError ? 'Import Error' : 'Importing Photos'}
                            </h2>
                            <p className="text-sm text-gray-400">
                                {getPhaseLabel(importProgress.phase)}
                            </p>
                        </div>
                    </div>
                    {(isComplete || isError) && (
                        <button
                            onClick={() => {
                                setIsImporting(false);
                                setImportProgress(null);
                            }}
                            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Progress bar */}
                    <div className="mb-4">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-gray-400">
                                {importProgress.current} of {importProgress.total}
                            </span>
                            <span className="text-white font-medium">
                                {getProgressPercent()}%
                            </span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className={`progress-bar-fill ${
                                    isComplete ? 'bg-green-500' :
                                    isError ? 'bg-red-500' :
                                    'bg-white/10'
                                }`}
                                style={{ width: `${getProgressPercent()}%` }}
                            />
                        </div>
                    </div>

                    {/* Current file */}
                    {importProgress.currentFile && !isComplete && !isError && (
                        <div className="bg-gray-800 rounded-lg p-3 mb-4">
                            <p className="text-xs text-gray-500 mb-1">Current file:</p>
                            <p className="text-sm text-white truncate">{importProgress.currentFile}</p>
                        </div>
                    )}

                    {/* Statistics */}
                    {(importProgress.importedCount !== undefined || importProgress.skippedCount !== undefined) && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold text-green-400">
                                    {importProgress.importedCount || 0}
                                </p>
                                <p className="text-xs text-gray-500">Imported</p>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold text-yellow-400">
                                    {importProgress.skippedCount || 0}
                                </p>
                                <p className="text-xs text-gray-500">Skipped</p>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <p className="text-2xl font-bold text-red-400">
                                    {importProgress.errorCount || 0}
                                </p>
                                <p className="text-xs text-gray-500">Errors</p>
                            </div>
                        </div>
                    )}

                    {/* Errors */}
                    {importProgress.errors && importProgress.errors.length > 0 && (
                        <div className="mt-4 bg-red-900/20 border border-red-800 rounded-lg p-3">
                            <p className="text-sm font-medium text-red-400 mb-2">Errors:</p>
                            <ul className="text-xs text-red-300 max-h-32 overflow-y-auto">
                                {importProgress.errors.slice(0, 5).map((error, index) => (
                                    <li key={index} className="truncate mb-1">{error}</li>
                                ))}
                                {importProgress.errors.length > 5 && (
                                    <li className="text-red-400">
                                        ... and {importProgress.errors.length - 5} more errors
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {(isComplete || isError) && (
                    <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
                        <button
                            onClick={() => {
                                setIsImporting(false);
                                setImportProgress(null);
                            }}
                            className="btn btn-primary"
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImportModal;
