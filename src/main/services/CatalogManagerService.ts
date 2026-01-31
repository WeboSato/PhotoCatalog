import fs from 'fs';
import path from 'path';
import { app, dialog } from 'electron';
import Database from 'better-sqlite3';
import { DATABASE_SCHEMA } from '../../database/schema';
import settingsService from './SettingsService';

export interface CatalogInfo {
    name: string;
    path: string;
    dbPath: string;
    previewsPath: string;
    size: number;
    photoCount: number;
    createdAt: string;
    lastOpened: string;
}

export interface NewCatalogOptions {
    name: string;
    location: string;
    copyCurrentData?: boolean;
}

/**
 * CatalogManagerService - Manages PhotoCatalog catalogs with Lightroom-like structure
 *
 * Structure created:
 * [location]/
 *   [name].pcdb                    - SQLite database
 *   [name] Previews/
 *     previews.db                  - Preview index database
 *     0/ 1/ 2/ ... F/             - 16 hex folders for thumbnails
 */
class CatalogManagerService {
    private readonly HEX_FOLDERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

    /**
     * Create a new catalog with Lightroom-like structure
     */
    async createNewCatalog(options: NewCatalogOptions): Promise<{ success: boolean; catalogPath?: string; error?: string }> {
        const { name, location, copyCurrentData = false } = options;

        try {
            // Validate catalog name
            const safeName = this.sanitizeCatalogName(name);
            if (!safeName) {
                return { success: false, error: 'Invalid catalog name' };
            }

            // Create catalog directory structure
            const catalogFolder = path.join(location, safeName);
            const dbPath = path.join(catalogFolder, `${safeName}.pcdb`);
            const previewsFolder = path.join(catalogFolder, `${safeName} Previews`);
            const previewsDbPath = path.join(previewsFolder, 'previews.db');

            // Check if catalog already exists
            if (fs.existsSync(catalogFolder)) {
                return { success: false, error: `A catalog "${safeName}" already exists at this location` };
            }

            // Create main catalog folder
            fs.mkdirSync(catalogFolder, { recursive: true });

            // Create previews folder with 16 hex subfolders
            fs.mkdirSync(previewsFolder, { recursive: true });
            for (const hex of this.HEX_FOLDERS) {
                fs.mkdirSync(path.join(previewsFolder, hex), { recursive: true });
            }

            // Create main catalog database
            await this.initializeCatalogDb(dbPath, safeName);

            // Create previews index database
            await this.initializePreviewsDb(previewsDbPath);

            // Copy current data if requested
            if (copyCurrentData) {
                const currentDbPath = settingsService.getCatalogDbPath();
                if (fs.existsSync(currentDbPath)) {
                    await this.copyDatabaseData(currentDbPath, dbPath);
                }
            }

            console.log(`[CatalogManager] Created new catalog: ${catalogFolder}`);

            return { success: true, catalogPath: catalogFolder };

        } catch (error) {
            console.error('[CatalogManager] Error creating catalog:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Initialize main catalog database with schema
     */
    private async initializeCatalogDb(dbPath: string, catalogName: string): Promise<void> {
        const db = new Database(dbPath);

        try {
            // Enable WAL mode for better performance
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
            db.pragma('cache_size = -64000'); // 64MB cache
            db.pragma('temp_store = MEMORY');

            // Execute schema
            db.exec(DATABASE_SCHEMA);

            // Update catalog name in metadata
            db.prepare(`
                UPDATE catalog_metadata SET value = ? WHERE key = 'catalog_name'
            `).run(catalogName);

            db.prepare(`
                INSERT OR REPLACE INTO catalog_metadata (key, value) VALUES ('catalog_version', '2.0.0')
            `).run();

            console.log(`[CatalogManager] Initialized catalog database: ${dbPath}`);
        } finally {
            db.close();
        }
    }

    /**
     * Initialize previews index database (like Lightroom's previews.db)
     */
    private async initializePreviewsDb(previewsDbPath: string): Promise<void> {
        const db = new Database(previewsDbPath);

        try {
            db.pragma('journal_mode = WAL');

            // Create previews index schema
            db.exec(`
                -- Preview index table
                CREATE TABLE IF NOT EXISTS preview_index (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    photo_id TEXT NOT NULL UNIQUE,
                    file_path TEXT NOT NULL,
                    thumb_path TEXT,
                    preview_path TEXT,
                    pyramid_path TEXT,
                    digest TEXT,
                    width INTEGER,
                    height INTEGER,
                    thumb_width INTEGER,
                    thumb_height INTEGER,
                    preview_width INTEGER,
                    preview_height INTEGER,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );

                -- Index for fast lookups
                CREATE INDEX IF NOT EXISTS idx_preview_photo_id ON preview_index(photo_id);
                CREATE INDEX IF NOT EXISTS idx_preview_digest ON preview_index(digest);

                -- Metadata
                CREATE TABLE IF NOT EXISTS previews_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );

                INSERT OR REPLACE INTO previews_metadata (key, value) VALUES
                    ('version', '1.0.0'),
                    ('created_at', datetime('now'));
            `);

            console.log(`[CatalogManager] Initialized previews database: ${previewsDbPath}`);
        } finally {
            db.close();
        }
    }

    /**
     * Copy data from one database to another
     */
    private async copyDatabaseData(sourcePath: string, destPath: string): Promise<void> {
        const sourceDb = new Database(sourcePath, { readonly: true });
        const destDb = new Database(destPath);

        try {
            // Attach source database
            destDb.exec(`ATTACH DATABASE '${sourcePath}' AS source`);

            // Copy all data from main tables
            const tables = ['photos', 'folders', 'collections', 'collection_photos',
                          'keywords', 'photo_keywords', 'people', 'faces',
                          'develop_settings', 'develop_presets', 'stacks', 'stack_photos'];

            for (const table of tables) {
                try {
                    destDb.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM source.${table}`);
                    console.log(`[CatalogManager] Copied table: ${table}`);
                } catch (e) {
                    // Table might not exist in source
                    console.log(`[CatalogManager] Skipped table ${table}: ${e}`);
                }
            }

            destDb.exec('DETACH DATABASE source');
        } finally {
            sourceDb.close();
            destDb.close();
        }
    }

    /**
     * Get hex folder for a given file path (using MD5 hash)
     */
    getPreviewFolder(filePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(filePath).digest('hex');
        // Use first character of hash (0-F) for folder
        return hash.charAt(0).toUpperCase();
    }

    /**
     * Open catalog selection dialog
     */
    async selectCatalogLocation(): Promise<string | null> {
        const result = await dialog.showOpenDialog({
            title: 'Choose catalog location',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Select'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    }

    /**
     * Open existing catalog
     */
    async openCatalog(catalogPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            // Find .pcdb file in catalog folder
            const files = fs.readdirSync(catalogPath);
            const pcdbFile = files.find(f => f.endsWith('.pcdb'));

            if (!pcdbFile) {
                return { success: false, error: 'No catalog file (.pcdb) found' };
            }

            const dbPath = path.join(catalogPath, pcdbFile);
            const catalogName = path.basename(pcdbFile, '.pcdb');
            const previewsPath = path.join(catalogPath, `${catalogName} Previews`);

            // Verify database exists
            if (!fs.existsSync(dbPath)) {
                return { success: false, error: 'Catalog database not found' };
            }

            // Update settings to use this catalog
            settingsService.set('catalogPath', catalogPath);

            // Set thumbnail path if previews folder exists
            if (fs.existsSync(previewsPath)) {
                settingsService.set('thumbnailPath', previewsPath);
            }

            console.log(`[CatalogManager] Opened catalog: ${catalogPath}`);
            return { success: true };

        } catch (error) {
            console.error('[CatalogManager] Error opening catalog:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get list of recent catalogs
     */
    getRecentCatalogs(): CatalogInfo[] {
        // For now, return empty - could be stored in electron-store
        return [];
    }

    /**
     * Sanitize catalog name for file system
     */
    private sanitizeCatalogName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
            .replace(/\s+/g, ' ')          // Normalize whitespace
            .trim()
            .substring(0, 100);            // Limit length
    }

    /**
     * Get catalog statistics
     */
    async getCatalogStats(catalogPath: string): Promise<CatalogInfo | null> {
        try {
            const files = fs.readdirSync(catalogPath);
            const pcdbFile = files.find(f => f.endsWith('.pcdb'));

            if (!pcdbFile) return null;

            const dbPath = path.join(catalogPath, pcdbFile);
            const catalogName = path.basename(pcdbFile, '.pcdb');
            const previewsPath = path.join(catalogPath, `${catalogName} Previews`);

            const db = new Database(dbPath, { readonly: true });
            let photoCount = 0;
            let createdAt = '';

            try {
                const countResult = db.prepare('SELECT COUNT(*) as count FROM photos').get() as { count: number };
                photoCount = countResult?.count || 0;

                const metaResult = db.prepare("SELECT value FROM catalog_metadata WHERE key = 'created_at'").get() as { value: string } | undefined;
                createdAt = metaResult?.value || '';
            } finally {
                db.close();
            }

            const stat = fs.statSync(dbPath);

            return {
                name: catalogName,
                path: catalogPath,
                dbPath,
                previewsPath,
                size: stat.size,
                photoCount,
                createdAt,
                lastOpened: stat.mtime.toISOString()
            };

        } catch (error) {
            console.error('[CatalogManager] Error getting catalog stats:', error);
            return null;
        }
    }
}

export const catalogManagerService = new CatalogManagerService();
export default catalogManagerService;
