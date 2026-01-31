import React, { useState, useEffect, useCallback } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { Tag, Plus, X, Check, Search } from 'lucide-react';

interface Keyword {
    id: string;
    name: string;
    parent_id: string | null;
    photo_count?: number;
}

export const KeywordPanel: React.FC = () => {
    const [keywords, setKeywords] = useState<Keyword[]>([]);
    const [selectedPhotoKeywords, setSelectedPhotoKeywords] = useState<string[]>([]);
    const [newKeyword, setNewKeyword] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const selectedPhotoIds = useCatalogStore((s) => s.selectedPhotoIds);
    const photos = useCatalogStore((s) => s.photos);
    const updatePhoto = useCatalogStore((s) => s.updatePhoto);

    // Load all keywords
    const loadKeywords = useCallback(async () => {
        try {
            const allKeywords = await window.api.getKeywords();
            setKeywords(allKeywords);
        } catch (error) {
            console.error('Failed to load keywords:', error);
        }
    }, []);

    // Load keywords for selected photos
    const loadSelectedPhotoKeywords = useCallback(async () => {
        if (selectedPhotoIds.size === 0) {
            setSelectedPhotoKeywords([]);
            return;
        }

        try {
            // Get keywords that are common to all selected photos
            const selectedIds = Array.from(selectedPhotoIds);
            const keywordSets: Set<string>[] = [];

            for (const photoId of selectedIds) {
                const photoKeywords = await window.api.getPhotoKeywords(photoId);
                keywordSets.push(new Set(photoKeywords.map((k: Keyword) => k.id)));
            }

            // Find intersection (keywords present in ALL selected photos)
            if (keywordSets.length > 0) {
                const common = [...keywordSets[0]].filter(id =>
                    keywordSets.every(set => set.has(id))
                );
                setSelectedPhotoKeywords(common);
            }
        } catch (error) {
            console.error('Failed to load photo keywords:', error);
        }
    }, [selectedPhotoIds]);

    useEffect(() => {
        loadKeywords();
    }, [loadKeywords]);

    useEffect(() => {
        loadSelectedPhotoKeywords();
    }, [loadSelectedPhotoKeywords]);

    // Add keyword to selected photos
    const handleAddKeyword = async (keywordId: string) => {
        if (selectedPhotoIds.size === 0) return;

        setIsLoading(true);
        try {
            const selectedIds = Array.from(selectedPhotoIds);
            const keyword = keywords.find(k => k.id === keywordId);

            if (keyword) {
                await window.api.bulkAddKeywords(selectedIds, [keyword.name]);
                await loadSelectedPhotoKeywords();
                await loadKeywords();
            }
        } catch (error) {
            console.error('Failed to add keyword:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Remove keyword from selected photos
    const handleRemoveKeyword = async (keywordId: string) => {
        if (selectedPhotoIds.size === 0) return;

        setIsLoading(true);
        try {
            const selectedIds = Array.from(selectedPhotoIds);
            const keyword = keywords.find(k => k.id === keywordId);

            if (keyword) {
                await window.api.bulkRemoveKeywords(selectedIds, [keyword.name]);
                await loadSelectedPhotoKeywords();
                await loadKeywords();
            }
        } catch (error) {
            console.error('Failed to remove keyword:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Create and add new keyword
    const handleCreateKeyword = async () => {
        if (!newKeyword.trim() || selectedPhotoIds.size === 0) return;

        setIsLoading(true);
        try {
            const selectedIds = Array.from(selectedPhotoIds);

            // Add keyword (will be created if it doesn't exist)
            await window.api.bulkAddKeywords(selectedIds, [newKeyword.trim()]);

            setNewKeyword('');
            setIsAdding(false);
            await loadKeywords();
            await loadSelectedPhotoKeywords();
        } catch (error) {
            console.error('Failed to create keyword:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Filter keywords by search term
    const filteredKeywords = keywords.filter(k =>
        k.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Keywords applied to selected photos
    const appliedKeywords = keywords.filter(k => selectedPhotoKeywords.includes(k.id));

    // Keywords not applied to selected photos
    const availableKeywords = filteredKeywords.filter(k => !selectedPhotoKeywords.includes(k.id));

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Tag size={14} />
                    <span>Keywords</span>
                </div>
                {selectedPhotoIds.size > 0 && (
                    <span className="text-xs text-gray-500">
                        {selectedPhotoIds.size} selected
                    </span>
                )}
            </div>

            {selectedPhotoIds.size === 0 ? (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-xs text-gray-500 text-center">
                        Select photos to manage keywords
                    </p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    {/* Applied keywords */}
                    {appliedKeywords.length > 0 && (
                        <div className="p-2">
                            <div className="text-xs text-gray-500 mb-2 px-1">Applied</div>
                            <div className="flex flex-wrap gap-1">
                                {appliedKeywords.map(keyword => (
                                    <button
                                        key={keyword.id}
                                        onClick={() => handleRemoveKeyword(keyword.id)}
                                        disabled={isLoading}
                                        className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-full hover:bg-blue-700 transition-colors group"
                                    >
                                        <span>{keyword.name}</span>
                                        <X size={12} className="opacity-60 group-hover:opacity-100" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Add new keyword */}
                    <div className="p-2 border-b border-gray-700">
                        {isAdding ? (
                            <div className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={newKeyword}
                                    onChange={(e) => setNewKeyword(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateKeyword();
                                        if (e.key === 'Escape') {
                                            setIsAdding(false);
                                            setNewKeyword('');
                                        }
                                    }}
                                    placeholder="New keyword..."
                                    autoFocus
                                    className="flex-1 px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={handleCreateKeyword}
                                    disabled={!newKeyword.trim() || isLoading}
                                    className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    onClick={() => {
                                        setIsAdding(false);
                                        setNewKeyword('');
                                    }}
                                    className="p-1 text-gray-400 hover:text-gray-300"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsAdding(true)}
                                className="flex items-center gap-2 w-full px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            >
                                <Plus size={12} />
                                <span>Add keyword</span>
                            </button>
                        )}
                    </div>

                    {/* Search */}
                    {keywords.length > 5 && (
                        <div className="p-2 border-b border-gray-700">
                            <div className="flex items-center gap-2 px-2 py-1 bg-gray-700 rounded">
                                <Search size={12} className="text-gray-500" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search keywords..."
                                    className="flex-1 text-xs bg-transparent text-white placeholder-gray-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Available keywords */}
                    {availableKeywords.length > 0 && (
                        <div className="p-2">
                            <div className="text-xs text-gray-500 mb-2 px-1">Available</div>
                            <div className="space-y-0.5">
                                {availableKeywords.map(keyword => (
                                    <button
                                        key={keyword.id}
                                        onClick={() => handleAddKeyword(keyword.id)}
                                        disabled={isLoading}
                                        className="flex items-center justify-between w-full px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
                                    >
                                        <span>{keyword.name}</span>
                                        <Plus size={12} className="text-gray-500" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty state */}
                    {keywords.length === 0 && !isAdding && (
                        <div className="p-4 text-center">
                            <p className="text-xs text-gray-500">
                                No keywords yet. Add your first keyword above.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* XMP sync button */}
            {selectedPhotoIds.size > 0 && (
                <div className="p-2 border-t border-gray-700">
                    <button
                        onClick={async () => {
                            setIsLoading(true);
                            try {
                                const selectedIds = Array.from(selectedPhotoIds);
                                const result = await window.api.xmpBatchWrite(selectedIds);
                                console.log(`XMP written: ${result.success} success, ${result.failed} failed`);
                            } catch (error) {
                                console.error('Failed to write XMP:', error);
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={isLoading}
                        className="w-full px-3 py-1.5 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
                    >
                        Write XMP Sidecars
                    </button>
                </div>
            )}
        </div>
    );
};

export default KeywordPanel;
