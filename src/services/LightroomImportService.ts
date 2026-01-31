import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import catalogDb from '../database/Database';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

export interface LightroomPhoto {
    id: number;
    rating: number;
    colorLabel: string;
    pick: number; // 1 = picked, -1 = rejected, 0 = none
    fileName: string;
    extension: string;
    folderPath: string;
    rootPath: string;
    captureTime?: string;
    cameraMake?: string;
    cameraModel?: string;
}

export interface LightroomImportResult {
    imported: number;
    skipped: number;
    errors: string[];
    collections: number;
    keywords: number;
}

interface CatalogInfo {
    path: string;
    name: string;
    size: number;
    modified: Date;
    photoCount?: number;
}

class LightroomImportService {
    private lrDb: Database.Database | null = null;

    /**
     * Find all Lightroom catalogs on the system
     */
    findAllCatalogs(): CatalogInfo[] {
        const catalogs: CatalogInfo[] = [];
        const homeDir = app?.getPath('home') || process.env.HOME || '';

        // Common Lightroom catalog locations
        const searchPaths = [
            path.join(homeDir, 'Pictures', 'Lightroom'),
            path.join(homeDir, 'Pictures'),
            path.join(homeDir, 'Documents'),
            path.join(homeDir, 'Desktop'),
            '/Volumes' // External drives
        ];

        const findCatalogs = (dir: string, depth: number = 0): void => {
            if (depth > 4) return; // Limit search depth

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    if (entry.name.startsWith('.')) continue;

                    const fullPath = path.join(dir, entry.name);

                    if (entry.isFile() && entry.name.endsWith('.lrcat')) {
                        try {
                            const stats = fs.statSync(fullPath);
                            catalogs.push({
                                path: fullPath,
                                name: entry.name.replace('.lrcat', ''),
                                size: stats.size,
                                modified: stats.mtime
                            });
                        } catch (e) {
                            // Skip inaccessible files
                        }
                    } else if (entry.isDirectory()) {
                        findCatalogs(fullPath, depth + 1);
                    }
                }
            } catch (e) {
                // Skip inaccessible directories
            }
        };

        for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
                findCatalogs(searchPath);
            }
        }

        // Sort by modification date (most recent first)
        catalogs.sort((a, b) => b.modified.getTime() - a.modified.getTime());

        // Get photo count for each catalog
        for (const catalog of catalogs) {
            try {
                const db = new Database(catalog.path, { readonly: true });
                const result = db.prepare('SELECT COUNT(*) as count FROM Adobe_images').get() as any;
                catalog.photoCount = result?.count || 0;
                db.close();
            } catch (e) {
                catalog.photoCount = 0;
            }
        }

        return catalogs;
    }

    /**
     * Get the most likely active Lightroom catalog
     */
    findBestCatalog(): CatalogInfo | null {
        const catalogs = this.findAllCatalogs();

        if (catalogs.length === 0) {
            return null;
        }

        // Prefer the most recently modified catalog with photos
        const withPhotos = catalogs.filter(c => (c.photoCount || 0) > 0);

        if (withPhotos.length > 0) {
            return withPhotos[0]; // Most recent with photos
        }

        return catalogs[0]; // Just return most recent
    }

    /**
     * Open a Lightroom catalog (.lrcat file)
     */
    openCatalog(catalogPath: string): boolean {
        try {
            // Close any existing connection
            if (this.lrDb) {
                this.lrDb.close();
            }

            // Open in read-only mode
            this.lrDb = new Database(catalogPath, { readonly: true });
            console.log(`[LightroomImport] Opened catalog: ${catalogPath}`);
            return true;
        } catch (error) {
            console.error(`[LightroomImport] Failed to open catalog:`, error);
            return false;
        }
    }

    /**
     * Get all photos from the Lightroom catalog
     */
    getPhotos(): LightroomPhoto[] {
        if (!this.lrDb) {
            throw new Error('No catalog opened');
        }

        const query = `
            SELECT
                ai.id_local as id,
                COALESCE(ai.rating, 0) as rating,
                COALESCE(ai.colorLabels, '') as colorLabel,
                COALESCE(ai.pick, 0) as pick,
                lf.baseName as fileName,
                lf.extension as extension,
                lfo.pathFromRoot as folderPath,
                lrf.absolutePath as rootPath,
                ai.captureTime as captureTime
            FROM Adobe_images ai
            JOIN AgLibraryFile lf ON ai.rootFile = lf.id_local
            JOIN AgLibraryFolder lfo ON lf.folder = lfo.id_local
            JOIN AgLibraryRootFolder lrf ON lfo.rootFolder = lrf.id_local
            ORDER BY ai.captureTime DESC
        `;

        try {
            const rows = this.lrDb.prepare(query).all() as any[];
            return rows.map(row => ({
                id: row.id,
                rating: row.rating || 0,
                colorLabel: this.mapColorLabel(row.colorLabel),
                pick: row.pick || 0,
                fileName: row.fileName,
                extension: row.extension,
                folderPath: row.folderPath || '',
                rootPath: row.rootPath || '',
                captureTime: row.captureTime
            }));
        } catch (error) {
            console.error('[LightroomImport] Failed to get photos:', error);
            return [];
        }
    }

    /**
     * Map Lightroom color label to our format
     */
    private mapColorLabel(lrColor: string): string {
        const colorMap: Record<string, string> = {
            'Red': 'red',
            'Yellow': 'yellow',
            'Green': 'green',
            'Blue': 'blue',
            'Purple': 'purple',
            '': 'none'
        };
        return colorMap[lrColor] || 'none';
    }

    /**
     * Map Lightroom pick flag to our format
     */
    private mapFlag(pick: number): 'none' | 'picked' | 'rejected' {
        if (pick === 1) return 'picked';
        if (pick === -1) return 'rejected';
        return 'none';
    }

    /**
     * Get collections from Lightroom catalog
     */
    getCollections(): { id: number; name: string; parent?: number }[] {
        if (!this.lrDb) {
            throw new Error('No catalog opened');
        }

        try {
            const query = `
                SELECT id_local as id, name, parent
                FROM AgLibraryCollection
                WHERE creationId = 'com.adobe.ag.library.collection'
                ORDER BY name
            `;
            return this.lrDb.prepare(query).all() as any[];
        } catch (error) {
            console.error('[LightroomImport] Failed to get collections:', error);
            return [];
        }
    }

    /**
     * Get keywords from Lightroom catalog
     */
    getKeywords(): { id: number; name: string; parent?: number }[] {
        if (!this.lrDb) {
            throw new Error('No catalog opened');
        }

        try {
            const query = `
                SELECT id_local as id, name, parent
                FROM AgLibraryKeyword
                ORDER BY name
            `;
            return this.lrDb.prepare(query).all() as any[];
        } catch (error) {
            console.error('[LightroomImport] Failed to get keywords:', error);
            return [];
        }
    }

    /**
     * Import photos from Lightroom catalog to our database
     */
    async importFromCatalog(
        catalogPath: string,
        options: {
            importRatings?: boolean;
            importFlags?: boolean;
            importColorLabels?: boolean;
            importCollections?: boolean;
            importKeywords?: boolean;
        } = {},
        onProgress?: (current: number, total: number, status: string) => void
    ): Promise<LightroomImportResult> {
        const {
            importRatings = true,
            importFlags = true,
            importColorLabels = true,
            importCollections = true,
            importKeywords = true
        } = options;

        const result: LightroomImportResult = {
            imported: 0,
            skipped: 0,
            errors: [],
            collections: 0,
            keywords: 0
        };

        // Open the catalog
        if (!this.openCatalog(catalogPath)) {
            result.errors.push('Failed to open Lightroom catalog');
            return result;
        }

        try {
            // Get all photos from Lightroom
            const lrPhotos = this.getPhotos();
            console.log(`[LightroomImport] Found ${lrPhotos.length} photos in Lightroom catalog`);

            // Process each photo
            for (let i = 0; i < lrPhotos.length; i++) {
                const lrPhoto = lrPhotos[i];
                onProgress?.(i + 1, lrPhotos.length, `Processing ${lrPhoto.fileName}.${lrPhoto.extension}`);

                // Construct full path
                const fullPath = path.join(
                    lrPhoto.rootPath.replace(/\/$/, ''),
                    lrPhoto.folderPath,
                    `${lrPhoto.fileName}.${lrPhoto.extension}`
                );

                // Check if file exists
                if (!fs.existsSync(fullPath)) {
                    result.skipped++;
                    continue;
                }

                // Check if already in our database
                const existing = catalogDb.getPhotoByPath(fullPath);

                if (existing) {
                    // Update existing photo with Lightroom metadata
                    const updates: any = {};

                    if (importRatings && lrPhoto.rating > 0) {
                        updates.rating = lrPhoto.rating;
                    }
                    if (importFlags && lrPhoto.pick !== 0) {
                        updates.flag = this.mapFlag(lrPhoto.pick);
                    }
                    if (importColorLabels && lrPhoto.colorLabel !== 'none') {
                        updates.color_label = lrPhoto.colorLabel;
                    }

                    if (Object.keys(updates).length > 0) {
                        catalogDb.updatePhoto(existing.id, updates);
                    }
                    result.skipped++;
                } else {
                    // Would need to import the photo first
                    // For now, just count as skipped if not in our catalog
                    result.skipped++;
                }
            }

            // Import collections if requested
            if (importCollections) {
                const collections = this.getCollections();
                for (const coll of collections) {
                    try {
                        catalogDb.createCollection({
                            name: coll.name,
                            is_smart: false
                        });
                        result.collections++;
                    } catch (e) {
                        // Collection might already exist
                    }
                }
            }

            // Import keywords if requested
            if (importKeywords) {
                const keywords = this.getKeywords();
                for (const kw of keywords) {
                    try {
                        catalogDb.createKeyword({
                            name: kw.name
                        });
                        result.keywords++;
                    } catch (e) {
                        // Keyword might already exist
                    }
                }
            }

            result.imported = lrPhotos.length - result.skipped;

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push(errorMsg);
        } finally {
            this.close();
        }

        return result;
    }

    /**
     * Sync ratings, flags, and color labels from Lightroom to existing photos
     * Uses batch transactions for performance
     */
    async syncMetadata(
        catalogPath: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<{ synced: number; notFound: number }> {
        const result = { synced: 0, notFound: 0 };

        if (!this.openCatalog(catalogPath)) {
            return result;
        }

        try {
            const lrPhotos = this.getPhotos();
            const BATCH_SIZE = 100;

            for (let batchStart = 0; batchStart < lrPhotos.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, lrPhotos.length);
                const batch = lrPhotos.slice(batchStart, batchEnd);

                // Update progress once per batch
                onProgress?.(batchEnd, lrPhotos.length);

                // Process batch in transaction
                catalogDb.runInTransaction(() => {
                    for (const lrPhoto of batch) {
                        const fullPath = path.join(
                            lrPhoto.rootPath.replace(/\/$/, ''),
                            lrPhoto.folderPath,
                            `${lrPhoto.fileName}.${lrPhoto.extension}`
                        );

                        const existing = catalogDb.getPhotoByPath(fullPath);

                        if (existing) {
                            catalogDb.updatePhoto(existing.id, {
                                rating: lrPhoto.rating,
                                flag: this.mapFlag(lrPhoto.pick),
                                color_label: lrPhoto.colorLabel as any
                            });
                            result.synced++;
                        } else {
                            result.notFound++;
                        }
                    }
                });

                // Let UI breathe between batches
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        } finally {
            this.close();
        }

        return result;
    }

    /**
     * Import ALL photos from Lightroom catalog (not just sync existing)
     * Uses batch transactions for performance
     */
    async importAllFromLightroom(
        catalogPath: string,
        onProgress?: (current: number, total: number, status: string) => void
    ): Promise<{ imported: number; skipped: number; notFound: number; errors: string[] }> {
        const result = { imported: 0, skipped: 0, notFound: 0, errors: [] as string[] };

        if (!this.openCatalog(catalogPath)) {
            result.errors.push('Failed to open Lightroom catalog');
            return result;
        }

        try {
            const lrPhotos = this.getPhotos();
            console.log(`[LightroomImport] Importing ${lrPhotos.length} photos from Lightroom`);

            const BATCH_SIZE = 100;

            // Process in batches for better performance
            for (let batchStart = 0; batchStart < lrPhotos.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, lrPhotos.length);
                const batch = lrPhotos.slice(batchStart, batchEnd);

                // Update progress once per batch (not per photo)
                onProgress?.(batchEnd, lrPhotos.length, `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}...`);

                // Process batch in a single transaction
                catalogDb.runInTransaction(() => {
                    for (const lrPhoto of batch) {
                        const fullPath = path.join(
                            lrPhoto.rootPath.replace(/\/$/, ''),
                            lrPhoto.folderPath,
                            `${lrPhoto.fileName}.${lrPhoto.extension}`
                        );

                        // Check if file exists on disk
                        if (!fs.existsSync(fullPath)) {
                            result.notFound++;
                            continue;
                        }

                        // Check if already in our database
                        const existing = catalogDb.getPhotoByPath(fullPath);

                        if (existing) {
                            // Update existing with Lightroom metadata
                            catalogDb.updatePhoto(existing.id, {
                                rating: lrPhoto.rating,
                                flag: this.mapFlag(lrPhoto.pick),
                                color_label: lrPhoto.colorLabel as any
                            });
                            result.skipped++;
                            continue;
                        }

                        // Import new photo
                        try {
                            const stats = fs.statSync(fullPath);
                            const ext = path.extname(fullPath).toLowerCase();
                            const isRaw = ['.nef', '.cr2', '.cr3', '.arw', '.orf', '.rw2', '.dng', '.raf'].includes(ext);

                            catalogDb.insertPhoto({
                                id: uuidv4(),
                                file_path: fullPath,
                                file_name: `${lrPhoto.fileName}.${lrPhoto.extension}`,
                                file_size: stats.size,
                                file_type: ext.replace('.', '').toUpperCase(),
                                date_taken: lrPhoto.captureTime,
                                rating: lrPhoto.rating,
                                flag: this.mapFlag(lrPhoto.pick),
                                color_label: lrPhoto.colorLabel as any,
                                is_raw: isRaw,
                                indexed: false
                            });

                            // Track folder
                            const folderPath = path.dirname(fullPath);
                            const folderName = path.basename(folderPath);
                            catalogDb.upsertFolder({
                                path: folderPath,
                                name: folderName
                            });

                            result.imported++;
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            result.errors.push(`${fullPath}: ${errorMsg}`);
                        }
                    }
                });

                // Small delay between batches to let UI breathe
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Import collections from Lightroom (in transaction)
            try {
                const collections = this.getCollections();
                catalogDb.runInTransaction(() => {
                    for (const coll of collections) {
                        try {
                            catalogDb.createCollection({
                                name: coll.name,
                                is_smart: false
                            });
                        } catch (e) {
                            // Collection might already exist
                        }
                    }
                });
            } catch (e) {
                console.error('[LightroomImport] Failed to import collections:', e);
            }

            // Import keywords from Lightroom (in transaction)
            try {
                const keywords = this.getKeywords();
                catalogDb.runInTransaction(() => {
                    for (const kw of keywords) {
                        try {
                            catalogDb.createKeyword({
                                name: kw.name
                            });
                        } catch (e) {
                            // Keyword might already exist
                        }
                    }
                });
            } catch (e) {
                console.error('[LightroomImport] Failed to import keywords:', e);
            }

            // Rebuild folder hierarchy based on unique root paths
            const uniqueRootPaths = new Set<string>();
            for (const lrPhoto of lrPhotos) {
                if (lrPhoto.rootPath) {
                    uniqueRootPaths.add(lrPhoto.rootPath.replace(/\/$/, ''));
                }
            }

            for (const rootPath of uniqueRootPaths) {
                console.log(`[LightroomImport] Rebuilding folder hierarchy for: ${rootPath}`);
                catalogDb.rebuildFolderHierarchy(rootPath);
            }

            console.log(`[LightroomImport] Folder hierarchy rebuilt for ${uniqueRootPaths.size} root paths`);

        } finally {
            this.close();
        }

        return result;
    }

    close(): void {
        if (this.lrDb) {
            this.lrDb.close();
            this.lrDb = null;
        }
    }
}

export const lightroomImportService = new LightroomImportService();
export default lightroomImportService;
