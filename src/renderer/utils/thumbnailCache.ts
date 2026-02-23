import { LRUCache } from 'lru-cache';

/**
 * Multi-level thumbnail cache with persistence
 * L1: In-memory LRU cache (fast, limited)
 * L2: Browser cache (via fetch)
 * L3: localStorage persistence (survives restarts)
 */

interface CacheEntry {
    url: string;
    loaded: boolean;
    error: boolean;
}

// LRU Cache - 1000 entries, 15 min TTL
const cache = new LRUCache<string, CacheEntry>({
    max: 1000,
    ttl: 1000 * 60 * 15,
    updateAgeOnGet: true,
    updateAgeOnHas: true,
});

// Preload queue with priority support
interface PreloadItem {
    photoId: string;
    priority: number; // lower = higher priority (visible items first)
}

const preloadQueue: PreloadItem[] = [];
let isPreloading = false;
let scrollVelocity = 0;
let lastScrollTime = 0;

// Persistent cache key
const CACHE_STORAGE_KEY = 'photocatalog_thumb_cache';

/**
 * Initialize cache from localStorage on startup
 */
export function initPersistentCache(): void {
    try {
        const stored = localStorage.getItem(CACHE_STORAGE_KEY);
        if (stored) {
            const entries: Record<string, string> = JSON.parse(stored);
            for (const [photoId, url] of Object.entries(entries)) {
                if (!cache.has(photoId)) {
                    cache.set(photoId, { url, loaded: false, error: false });
                }
            }
        }
    } catch {
        // Corrupted cache, ignore
    }
}

/**
 * Persist current cache URLs to localStorage (call periodically)
 */
function persistCache(): void {
    try {
        const entries: Record<string, string> = {};
        let count = 0;
        for (const [key, entry] of cache.entries()) {
            if (entry.url && !entry.error && count < 2000) {
                entries[key] = entry.url;
                count++;
            }
        }
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // localStorage full or unavailable
    }
}

// Persist every 30 seconds
let persistTimer: ReturnType<typeof setInterval> | null = null;
function startPersistTimer(): void {
    if (!persistTimer) {
        persistTimer = setInterval(persistCache, 30000);
    }
}

/**
 * Get cached thumbnail URL or create entry
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

    const encodedPath = thumbnailPath.split('/').map(part => encodeURIComponent(part)).join('/');
    entry = {
        url: `local-image://${encodedPath}`,
        loaded: false,
        error: false
    };

    cache.set(cacheKey, entry);
    startPersistTimer();
    return entry;
}

/**
 * Report scroll velocity for adaptive preloading
 */
export function reportScrollVelocity(velocity: number): void {
    scrollVelocity = Math.abs(velocity);
    lastScrollTime = Date.now();
}

/**
 * Preload thumbnails with priority (visible items get priority 0, ahead items get 1, 2, etc.)
 */
export function preloadThumbnails(
    photos: { id: string; thumbnail_path?: string }[],
    priority: number = 1
): void {
    photos.forEach(photo => {
        if (photo.thumbnail_path && !cache.has(photo.id)) {
            // Remove duplicates and re-add with potentially higher priority
            const existingIdx = preloadQueue.findIndex(item => item.photoId === photo.id);
            if (existingIdx >= 0) {
                if (priority < preloadQueue[existingIdx].priority) {
                    preloadQueue[existingIdx].priority = priority;
                }
            } else {
                preloadQueue.push({ photoId: photo.id, priority });
            }
        }
    });

    // Sort by priority (lower = first)
    preloadQueue.sort((a, b) => a.priority - b.priority);

    if (!isPreloading) {
        processPreloadQueue();
    }
}

async function processPreloadQueue(): Promise<void> {
    if (preloadQueue.length === 0) {
        isPreloading = false;
        return;
    }

    // Pause preloading during fast scroll
    const timeSinceScroll = Date.now() - lastScrollTime;
    if (scrollVelocity > 500 && timeSinceScroll < 100) {
        isPreloading = true;
        setTimeout(processPreloadQueue, 50);
        return;
    }

    isPreloading = true;
    // Adaptive batch size: smaller during scroll, larger when idle
    const batchSize = scrollVelocity > 200 ? 3 : 8;
    const batch = preloadQueue.splice(0, batchSize);

    await Promise.all(batch.map(async ({ photoId }) => {
        const entry = cache.get(photoId);
        if (entry && !entry.loaded && !entry.error) {
            try {
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

    // Continue with next batch during idle time
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => processPreloadQueue(), { timeout: 150 });
    } else {
        setTimeout(processPreloadQueue, 16);
    }
}

/**
 * Clear cache
 */
export function clearThumbnailCache(): void {
    cache.clear();
    preloadQueue.length = 0;
    try {
        localStorage.removeItem(CACHE_STORAGE_KEY);
    } catch {}
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; max: number; queueLength: number } {
    return {
        size: cache.size,
        max: cache.max,
        queueLength: preloadQueue.length,
    };
}

export default {
    getCachedThumbnail,
    preloadThumbnails,
    clearThumbnailCache,
    getCacheStats,
    initPersistentCache,
    reportScrollVelocity,
};
