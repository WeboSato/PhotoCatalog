import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

interface AppSettings {
    catalogPath: string;
    thumbnailPath: string;
    theme: 'dark' | 'light';
    gridSize: number;
    language: string;
    showArchived: boolean;
}

const defaultSettings: AppSettings = {
    catalogPath: '', // Empty = use default (userData)
    thumbnailPath: '', // Empty = use default (userData/thumbnails)
    theme: 'dark',
    gridSize: 150,
    language: 'fr',
    showArchived: false
};

// Use any type to avoid TS issues with electron-store
type StoreType = Store<AppSettings> & {
    get: <K extends keyof AppSettings>(key: K) => AppSettings[K];
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    store: AppSettings;
};

class SettingsService {
    private store: StoreType;

    constructor() {
        this.store = new Store<AppSettings>({
            name: 'settings',
            defaults: defaultSettings
        }) as StoreType;
    }

    get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.store.get(key);
    }

    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.store.set(key, value);
    }

    getAll(): AppSettings {
        return this.store.store;
    }

    setAll(settings: Partial<AppSettings>): void {
        for (const [key, value] of Object.entries(settings)) {
            this.store.set(key as keyof AppSettings, value);
        }
    }

    // Get the actual catalog database path
    getCatalogDbPath(): string {
        const customPath = this.store.get('catalogPath');
        console.log('[SettingsService] catalogPath from store:', customPath);
        if (customPath && customPath.length > 0) {
            const dbPath = path.join(customPath, 'catalog.db');
            console.log('[SettingsService] Using custom DB path:', dbPath);
            return dbPath;
        }
        const defaultPath = path.join(app.getPath('userData'), 'catalog.db');
        console.log('[SettingsService] Using default DB path:', defaultPath);
        return defaultPath;
    }

    // Get the actual thumbnail directory path
    getThumbnailBasePath(): string {
        const customPath = this.store.get('thumbnailPath');
        if (customPath && customPath.length > 0) {
            return customPath;
        }
        const catalogPath = this.store.get('catalogPath');
        if (catalogPath && catalogPath.length > 0) {
            return path.join(catalogPath, 'thumbnails');
        }
        return path.join(app.getPath('userData'), 'thumbnails');
    }

    // Migrate catalog to new location (includes Images folder)
    async migrateCatalog(newPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            const currentDbPath = this.getCatalogDbPath();
            const currentThumbPath = this.getThumbnailBasePath();

            const newDbPath = path.join(newPath, 'catalog.db');
            const newThumbPath = path.join(newPath, 'thumbnails');
            const newImagesPath = path.join(newPath, 'Images');

            // Ensure new directories exist
            fs.mkdirSync(newPath, { recursive: true });
            fs.mkdirSync(newThumbPath, { recursive: true });
            fs.mkdirSync(newImagesPath, { recursive: true });

            // Copy database if exists
            if (fs.existsSync(currentDbPath)) {
                fs.copyFileSync(currentDbPath, newDbPath);
                // Also copy WAL files if they exist
                if (fs.existsSync(currentDbPath + '-wal')) {
                    fs.copyFileSync(currentDbPath + '-wal', newDbPath + '-wal');
                }
                if (fs.existsSync(currentDbPath + '-shm')) {
                    fs.copyFileSync(currentDbPath + '-shm', newDbPath + '-shm');
                }
            }

            // Copy thumbnails directory
            if (fs.existsSync(currentThumbPath)) {
                await this.copyDirectory(currentThumbPath, newThumbPath);
            }

            // Images folder migration is handled separately by the user
            // No hardcoded paths - users configure their own image locations

            // Update settings
            this.set('catalogPath', newPath);
            this.set('thumbnailPath', newThumbPath);

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // Update photo paths in database after migration
    private async updatePhotoPaths(dbPath: string, oldBasePath: string, newBasePath: string): Promise<void> {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);

        try {
            // Update all photo paths
            db.prepare(`
                UPDATE photos
                SET file_path = replace(file_path, ?, ?)
                WHERE file_path LIKE ?
            `).run(oldBasePath, newBasePath, oldBasePath + '%');

            // Update all folder paths
            db.prepare(`
                UPDATE folders
                SET path = replace(path, ?, ?)
                WHERE path LIKE ?
            `).run(oldBasePath, newBasePath, oldBasePath + '%');

            console.log('[Settings] Photo and folder paths updated successfully');
        } finally {
            db.close();
        }
    }

    // Helper to copy directory recursively
    private async copyDirectory(src: string, dest: string): Promise<void> {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    // Get catalog info
    getCatalogInfo(): {
        dbPath: string;
        thumbPath: string;
        dbSize: number;
        thumbCount: number;
        thumbSize: number;
    } {
        const dbPath = this.getCatalogDbPath();
        const thumbPath = this.getThumbnailBasePath();

        let dbSize = 0;
        let thumbCount = 0;
        let thumbSize = 0;

        if (fs.existsSync(dbPath)) {
            dbSize = fs.statSync(dbPath).size;
        }

        if (fs.existsSync(thumbPath)) {
            const countFiles = (dir: string): { count: number; size: number } => {
                let count = 0;
                let size = 0;
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            const sub = countFiles(fullPath);
                            count += sub.count;
                            size += sub.size;
                        } else if (entry.name.endsWith('.webp')) {
                            count++;
                            size += fs.statSync(fullPath).size;
                        }
                    }
                } catch (e) {
                    // Ignore errors
                }
                return { count, size };
            };
            const result = countFiles(thumbPath);
            thumbCount = result.count;
            thumbSize = result.size;
        }

        return { dbPath, thumbPath, dbSize, thumbCount, thumbSize };
    }
}

export const settingsService = new SettingsService();
export default settingsService;
