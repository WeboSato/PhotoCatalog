import { LRUCache } from 'lru-cache';

/**
 * Multi-level thumbnail cache inspired by Lightroom/Darktable
 * L1: In-memory LRU cache (fast, limited)
 * L2: Browser cache (via fetch)
 */

interface CacheEntry {
    url: string;
    loaded: boolean;
    error: boolean;
}

// LRU Cache configuration
const cache = new LRUCache<string, CacheEntry>({
    max: 500, // Maximum 500 thumbnails in memory
    ttl: 1000 * 60 * 10, // 10 minute TTL
    updateAgeOnGet: true,
    updateAgeOnHas: true,
});

// Preload queue for background loading
const preloadQueue: string[] = [];
let isPreloading = false;

/**
 * Get cached thumbnail URL or load it
 */
export function getCachedThumbnail(photoId: string, thumbnailPath: string | undefined): CacheEntry {
    if (!thumbnailPath) {
        return { url: '', loaded: false, error: true };
    }

    const cacheKey = photoId;
    let entry = cache.get(cacheKey);

    if (entry) {
        return entry;
    }

    // Create new entry
    const encodedPath = thumbnailPath.split('/').map(part => encodeURIComponent(part)).join('/');
    entry = {
        url: `local-image://${encodedPath}`,
        loaded: false,
        error: false
    };

    cache.set(cacheKey, entry);
    return entry;
}

/**
 * Preload thumbnails in background
 */
export function preloadThumbnails(photos: { id: string; thumbnail_path?: string }[]): void {
    photos.forEach(photo => {
        if (photo.thumbnail_path && !cache.has(photo.id)) {
            preloadQueue.push(photo.id);
        }
    });

    if (!isPreloading) {
        processPreloadQueue();
    }
}

async function processPreloadQueue(): Promise<void> {
    if (preloadQueue.length === 0) {
        isPreloading = false;
        return;
    }

    isPreloading = true;
    const batch = preloadQueue.splice(0, 5); // Process 5 at a time

    await Promise.all(batch.map(async (photoId) => {
        const entry = cache.get(photoId);
        if (entry && !entry.loaded && !entry.error) {
            try {
                // Preload image
                const img = new Image();
                img.decoding = 'async';
                img.src = entry.url;
                await img.decode();
                entry.loaded = true;
            } catch {
                entry.error = true;
            }
        }
    }));

    // Continue with next batch after small delay
    setTimeout(processPreloadQueue, 16);
}

/**
 * Clear cache (useful when memory is low)
 */
export function clearThumbnailCache(): void {
    cache.clear();
    preloadQueue.length = 0;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; max: number } {
    return {
        size: cache.size,
        max: cache.max
    };
}

export default {
    getCachedThumbnail,
    preloadThumbnails,
    clearThumbnailCache,
    getCacheStats
};
