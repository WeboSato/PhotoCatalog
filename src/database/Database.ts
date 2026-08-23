import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { DATABASE_SCHEMA } from './schema';
import { v4 as uuidv4 } from 'uuid';
import type { Album, AlbumPage } from '../shared/albumTypes';

export interface Photo {
    id: string;
    file_path: string;
    file_name: string;
    file_size?: number;
    file_type?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    orientation?: number;
    date_taken?: string;
    date_imported?: string;
    date_modified?: string;
    camera_make?: string;
    camera_model?: string;
    lens_model?: string;
    focal_length?: number;
    aperture?: number;
    shutter_speed?: string;
    iso?: number;
    flash_used?: number;
    gps_latitude?: number;
    gps_longitude?: number;
    gps_altitude?: number;
    rating: number;
    flag: 'none' | 'picked' | 'rejected';
    color_label: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
    title?: string;
    caption?: string;
    copyright?: string;
    creator?: string;
    is_raw: boolean;
    raw_type?: string;
    thumbnail_path?: string;
    preview_path?: string;
    blur_hash?: string;
    edit_copy_path?: string;
    edited_from_id?: string; // set on a linked edit copy: id of the source photo
    keywords?: string[];
    indexed: boolean;
    develop_settings?: string; // JSON string of develop settings
}

export interface Collection {
    id: string;
    name: string;
    description?: string;
    parent_id?: string;
    is_smart: boolean;
    smart_criteria?: object;
    sort_order: number;
    cover_photo_id?: string;
    photo_count?: number;
}

export interface Keyword {
    id: string;
    name: string;
    parent_id?: string;
    synonyms?: string[];
    include_on_export: boolean;
    photo_count?: number;
}

export interface Folder {
    id: string;
    path: string;
    name: string;
    parent_id?: string;
    is_watched: boolean;
    photo_count: number;
}

export interface FilterCriteria {
    rating?: { min?: number; max?: number };
    flag?: ('none' | 'picked' | 'rejected')[];
    color_label?: ('none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple')[];
    date_range?: { start?: string; end?: string };
    camera_model?: string[];
    is_raw?: boolean;
    has_affinity_edit?: boolean;
    affinity_date?: string; // Format: YYYY-MM-DD
    keywords?: string[];
    search_text?: string;
    collection_id?: string;
    folder_path?: string;
    imported_within_days?: number; // "recent imports" view
}

class CatalogDatabase {
    private db: Database.Database | null = null;
    private dbPath: string = '';
    private searchCache = new Map<string, { data: Photo[]; timestamp: number }>();
    private cacheTimeout = 300000; // 5 minutes (was 30s - trop court)
    private stmtCache = new Map<string, Database.Statement>();

    initialize(catalogPath?: string): void {
        if (this.db) {
            this.db.close();
        }

        // Vider le cache et les statements prepares
        this.searchCache.clear();
        this.stmtCache.clear();

        this.dbPath = catalogPath || path.join(
            app?.getPath('userData') || process.cwd(),
            'catalog.db'
        );

        this.db = new Database(this.dbPath);

        // Pragmas de performance
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -20000'); // 20MB cache (optimise memoire)
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('mmap_size = 536870912'); // 512MB memory-mapped I/O
        this.db.pragma('page_size = 4096');
        this.db.pragma('foreign_keys = ON');

        this.db.exec(DATABASE_SCHEMA);

        // Run migrations for existing databases
        this.runMigrations();

        // Index supplementaires
        this.createOptimizedIndexes();

        // Verification de sante
        this.checkDatabaseHealth();

        console.log(`[Database] Initialized at ${this.dbPath}`);
    }

    private runMigrations(): void {
        // Migration: Add edit_copy_path column if it doesn't exist
        try {
            const columns = this.db!.pragma('table_info(photos)') as { name: string }[];
            const hasEditCopyPath = columns.some(col => col.name === 'edit_copy_path');
            if (!hasEditCopyPath) {
                this.db!.exec('ALTER TABLE photos ADD COLUMN edit_copy_path TEXT');
                console.log('[Database] Migration: Added edit_copy_path column');
            }
        } catch (e) {
            console.warn('[Database] Migration check failed:', e);
        }

        // Migration: Add blur_hash column if it doesn't exist
        try {
            const columns2 = this.db!.pragma('table_info(photos)') as { name: string }[];
            const hasBlurHash = columns2.some(col => col.name === 'blur_hash');
            if (!hasBlurHash) {
                this.db!.exec('ALTER TABLE photos ADD COLUMN blur_hash TEXT');
                console.log('[Database] Migration: Added blur_hash column');
            }
        } catch (e) {
            console.warn('[Database] Migration blur_hash check failed:', e);
        }

        // Migration: Add face_crop_path column to faces if it doesn't exist
        try {
            const fcols = this.db!.pragma('table_info(faces)') as { name: string }[];
            if (!fcols.some(col => col.name === 'face_crop_path')) {
                this.db!.exec('ALTER TABLE faces ADD COLUMN face_crop_path TEXT');
                console.log('[Database] Migration: Added face_crop_path column');
            }
        } catch (e) {
            console.warn('[Database] Migration face_crop_path check failed:', e);
        }

        // Migration: photos.develop_settings — the code has always read/written
        // this COLUMN, but fresh databases never created it (only a separate,
        // unused develop_settings TABLE existed). Old catalogs picked it up by
        // accident; new ones crashed on the first develop save.
        try {
            const cols = this.db!.pragma('table_info(photos)') as { name: string }[];
            if (!cols.some(col => col.name === 'develop_settings')) {
                this.db!.exec('ALTER TABLE photos ADD COLUMN develop_settings TEXT');
                console.log('[Database] Migration: Added develop_settings column');
            }
        } catch (e) {
            console.warn('[Database] Migration develop_settings check failed:', e);
        }

        // Migration: linked edit copies ("virtual copies" sent to Affinity) point
        // back at the photo they were made from.
        try {
            const cols = this.db!.pragma('table_info(photos)') as { name: string }[];
            if (!cols.some(col => col.name === 'edited_from_id')) {
                this.db!.exec('ALTER TABLE photos ADD COLUMN edited_from_id TEXT');
                console.log('[Database] Migration: Added edited_from_id column');
            }
        } catch (e) {
            console.warn('[Database] Migration edited_from_id check failed:', e);
        }
    }

    private createOptimizedIndexes(): void {
        const indexes = [
            // Index supplementaires pour requetes frequentes
            'CREATE INDEX IF NOT EXISTS idx_photos_file_path ON photos(file_path)',
            'CREATE INDEX IF NOT EXISTS idx_photos_edit_copy_path ON photos(edit_copy_path)',
            'CREATE INDEX IF NOT EXISTS idx_photos_hash ON photos(hash)',
            'CREATE INDEX IF NOT EXISTS idx_photos_date_taken_desc ON photos(date_taken DESC)',
            // Composite index covering the grid's exact sort key (full-library load).
            'CREATE INDEX IF NOT EXISTS idx_photos_taken_imported ON photos(date_taken DESC, date_imported DESC)',
            // Index composite pour les filtres combines
            'CREATE INDEX IF NOT EXISTS idx_photos_rating_flag ON photos(rating, flag)',
            'CREATE INDEX IF NOT EXISTS idx_photos_rating_color ON photos(rating, color_label)',
            // Index pour les folders
            'CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id)',
            // Index pour collections
            'CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id)',
        ];

        for (const sql of indexes) {
            try {
                this.db!.exec(sql);
            } catch (e) {
                // Index existe deja ou erreur non-critique
            }
        }
    }

    private checkDatabaseHealth(): void {
        try {
            const result = this.db!.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
            if (result.integrity_check !== 'ok') {
                console.warn('[Database] Integrity check failed:', result);
            }
        } catch (e) {
            console.error('[Database] Health check failed:', e);
        }
    }

    // Invalider le cache quand les donnees changent
    invalidateCache(): void {
        this.searchCache.clear();
    }

    getDb(): Database.Database {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.db;
    }

    // Prepared statement cache - réutilise au lieu de re-préparer à chaque appel
    // LRU-style: evict oldest when cache exceeds 100 entries
    private stmt(sql: string): Database.Statement {
        let s = this.stmtCache.get(sql);
        if (!s) {
            s = this.getDb().prepare(sql);
            this.stmtCache.set(sql, s);
            // Evict oldest entries if cache grows too large
            if (this.stmtCache.size > 100) {
                const firstKey = this.stmtCache.keys().next().value;
                if (firstKey) this.stmtCache.delete(firstKey);
            }
        }
        return s;
    }

    // Run multiple operations in a single transaction for performance
    runInTransaction<T>(fn: () => T): T {
        return this.getDb().transaction(fn)();
    }

    // ===== PHOTO OPERATIONS =====

    insertPhoto(photo: Partial<Photo>): string {
        const id = photo.id || uuidv4();
        const stmt = this.getDb().prepare(`
            INSERT INTO photos (
                id, file_path, file_name, file_size, file_type, mime_type,
                width, height, orientation, date_taken, date_modified,
                camera_make, camera_model, lens_model, focal_length, aperture,
                shutter_speed, iso, flash_used, gps_latitude, gps_longitude,
                gps_altitude, rating, flag, color_label, title, caption,
                copyright, creator, is_raw, raw_type, thumbnail_path, preview_path,
                indexed, hash
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?
            )
        `);

        stmt.run(
            id, photo.file_path, photo.file_name, photo.file_size, photo.file_type, photo.mime_type,
            photo.width, photo.height, photo.orientation || 1, photo.date_taken, photo.date_modified,
            photo.camera_make, photo.camera_model, photo.lens_model, photo.focal_length, photo.aperture,
            photo.shutter_speed, photo.iso, photo.flash_used ? 1 : 0, photo.gps_latitude, photo.gps_longitude,
            photo.gps_altitude, photo.rating || 0, photo.flag || 'none', photo.color_label || 'none',
            photo.title, photo.caption, photo.copyright, photo.creator,
            photo.is_raw ? 1 : 0, photo.raw_type, photo.thumbnail_path, photo.preview_path,
            photo.indexed ? 1 : 0, null
        );

        this.invalidateCache();
        return id;
    }

    updatePhoto(id: string, updates: Partial<Photo>): void {
        const allowedFields = [
            'rating', 'flag', 'color_label', 'title', 'caption', 'copyright', 'creator',
            'thumbnail_path', 'preview_path', 'indexed', 'width', 'height', 'orientation',
            'is_raw', 'develop_settings', 'edit_copy_path', 'blur_hash',
            'date_taken', 'edited_from_id'
        ];

        const fields: string[] = [];
        const values: any[] = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key) && value !== undefined) {
                fields.push(`${key} = ?`);
                if (typeof value === 'boolean') {
                    values.push(value ? 1 : 0);
                } else {
                    values.push(value);
                }
            }
        }

        if (fields.length === 0) return;

        // Any update stamps updated_at — the renderer versions image URLs with
        // it, so regenerated thumbnails (same path) show fresh pixels at once
        // instead of the browser's long-max-age cached bitmap.
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        const stmt = this.getDb().prepare(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...values);
        this.invalidateCache();
    }

    deletePhoto(id: string): void {
        this.stmt('DELETE FROM photos WHERE id = ?').run(id);
        this.invalidateCache();
    }

    deletePhotos(ids: string[]): void {
        const placeholders = ids.map(() => '?').join(',');
        this.getDb().prepare(`DELETE FROM photos WHERE id IN (${placeholders})`).run(...ids);
        this.invalidateCache();
    }

    getPhoto(id: string): Photo | undefined {
        return this.stmt('SELECT * FROM photos WHERE id = ?').get(id) as Photo | undefined;
    }

    getPhotoByPath(filePath: string): Photo | undefined {
        return this.stmt('SELECT * FROM photos WHERE file_path = ?').get(filePath) as Photo | undefined;
    }

    // Duplicate check that survives copying: a card photo imported to a folder
    // gets a new path, so path equality alone re-imports the same shot every
    // time. Name+size is a solid fingerprint for camera files.
    findPhotoByNameAndSize(fileName: string, fileSize: number): Photo | undefined {
        return this.stmt('SELECT * FROM photos WHERE file_name = ? AND file_size = ? LIMIT 1')
            .get(fileName, fileSize) as Photo | undefined;
    }

    getAllPhotos(limit: number = 1000, offset: number = 0): Photo[] {
        return this.stmt(`
            SELECT * FROM photos
            ORDER BY date_taken DESC, date_imported DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset) as Photo[];
    }

    getPhotoCount(): number {
        const result = this.stmt('SELECT COUNT(*) as count FROM photos').get() as { count: number };
        return result.count;
    }

    searchPhotos(criteria: FilterCriteria, limit: number = 1000, offset: number = 0): Photo[] {
        // Verifier le cache
        const cacheKey = JSON.stringify({ criteria, limit, offset });
        const cached = this.searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        const conditions: string[] = ['1=1'];
        const params: any[] = [];

        if (criteria.rating?.min !== undefined) {
            conditions.push('rating >= ?');
            params.push(criteria.rating.min);
        }
        if (criteria.rating?.max !== undefined) {
            conditions.push('rating <= ?');
            params.push(criteria.rating.max);
        }

        if (criteria.flag && criteria.flag.length > 0) {
            conditions.push(`flag IN (${criteria.flag.map(() => '?').join(',')})`);
            params.push(...criteria.flag);
        }

        if (criteria.color_label && criteria.color_label.length > 0) {
            conditions.push(`color_label IN (${criteria.color_label.map(() => '?').join(',')})`);
            params.push(...criteria.color_label);
        }

        if (criteria.date_range?.start) {
            conditions.push('date_taken >= ?');
            params.push(criteria.date_range.start);
        }
        if (criteria.date_range?.end) {
            conditions.push('date_taken <= ?');
            params.push(criteria.date_range.end);
        }

        if (criteria.camera_model && criteria.camera_model.length > 0) {
            conditions.push(`camera_model IN (${criteria.camera_model.map(() => '?').join(',')})`);
            params.push(...criteria.camera_model);
        }

        if (criteria.is_raw !== undefined) {
            conditions.push('is_raw = ?');
            params.push(criteria.is_raw ? 1 : 0);
        }

        if (criteria.has_affinity_edit === true) {
            conditions.push("(edit_copy_path IS NOT NULL AND (LOWER(edit_copy_path) LIKE '%.afphoto' OR LOWER(edit_copy_path) LIKE '%.af'))");
        }

        if (criteria.affinity_date) {
            // Filter by specific date (YYYY-MM-DD format)
            const [year, month, day] = criteria.affinity_date.split('-');
            conditions.push("(edit_copy_path IS NOT NULL AND (LOWER(edit_copy_path) LIKE '%.afphoto' OR LOWER(edit_copy_path) LIKE '%.af'))");
            conditions.push(`strftime('%Y', COALESCE(updated_at, date_taken)) = ?`);
            conditions.push(`strftime('%m', COALESCE(updated_at, date_taken)) = ?`);
            conditions.push(`strftime('%d', COALESCE(updated_at, date_taken)) = ?`);
            params.push(year, month, day);
        }

        if (criteria.folder_path) {
            conditions.push('file_path LIKE ?');
            params.push(`${criteria.folder_path}%`);
        }

        if (criteria.search_text) {
            // Search in file_name, title, caption, AND keywords
            conditions.push(`(
                file_name LIKE ? OR title LIKE ? OR caption LIKE ? OR
                photos.id IN (
                    SELECT pk.photo_id FROM photo_keywords pk
                    JOIN keywords k ON pk.keyword_id = k.id
                    WHERE k.name LIKE ?
                )
            )`);
            const searchPattern = `%${criteria.search_text}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        // Filter by specific keywords
        if (criteria.keywords && criteria.keywords.length > 0) {
            const keywordPlaceholders = criteria.keywords.map(() => '?').join(',');
            conditions.push(`photos.id IN (
                SELECT pk.photo_id FROM photo_keywords pk
                JOIN keywords k ON pk.keyword_id = k.id
                WHERE k.name IN (${keywordPlaceholders})
            )`);
            params.push(...criteria.keywords);
        }

        // "Recent imports": photos imported in the last N days. Sorted by import
        // time — an old photo imported yesterday belongs at the top of this view.
        if (criteria.imported_within_days && criteria.imported_within_days > 0) {
            conditions.push(`date_imported >= datetime('now', ?)`);
            params.push(`-${Math.floor(criteria.imported_within_days)} days`);
        }

        params.push(limit, offset);

        const orderBy = criteria.imported_within_days
            ? 'date_imported DESC, date_taken DESC'
            : 'date_taken DESC, date_imported DESC';
        const sql = `
            SELECT * FROM photos
            WHERE ${conditions.join(' AND ')}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `;

        const results = this.getDb().prepare(sql).all(...params) as Photo[];

        // Mettre en cache
        this.searchCache.set(cacheKey, { data: results, timestamp: Date.now() });

        // Limiter la taille du cache (max 50 entrees)
        if (this.searchCache.size > 50) {
            const firstKey = this.searchCache.keys().next().value;
            if (firstKey) this.searchCache.delete(firstKey);
        }

        return results;
    }

    getPhotosByCollection(collectionId: string): Photo[] {
        return this.stmt(`
            SELECT p.* FROM photos p
            INNER JOIN collection_photos cp ON p.id = cp.photo_id
            WHERE cp.collection_id = ?
            ORDER BY cp.sort_order, p.date_taken DESC
        `).all(collectionId) as Photo[];
    }

    // ===== COLLECTION OPERATIONS =====

    createCollection(collection: Partial<Collection>): string {
        const id = collection.id || uuidv4();
        this.getDb().prepare(`
            INSERT INTO collections (id, name, description, parent_id, is_smart, smart_criteria, sort_order, cover_photo_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, collection.name, collection.description, collection.parent_id,
            collection.is_smart ? 1 : 0, collection.smart_criteria ? JSON.stringify(collection.smart_criteria) : null,
            collection.sort_order || 0, collection.cover_photo_id
        );
        return id;
    }

    updateCollection(id: string, updates: Partial<Collection>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.cover_photo_id !== undefined) { fields.push('cover_photo_id = ?'); values.push(updates.cover_photo_id); }
        if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }

        if (fields.length === 0) return;

        values.push(id);
        this.getDb().prepare(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteCollection(id: string): void {
        this.getDb().prepare('DELETE FROM collections WHERE id = ?').run(id);
    }

    getCollections(): Collection[] {
        return this.stmt(`
            SELECT c.*, COUNT(cp.photo_id) as photo_count
            FROM collections c
            LEFT JOIN collection_photos cp ON c.id = cp.collection_id
            GROUP BY c.id
            ORDER BY c.sort_order, c.name
        `).all() as Collection[];
    }

    addPhotosToCollection(collectionId: string, photoIds: string[]): void {
        const stmt = this.getDb().prepare(`
            INSERT OR IGNORE INTO collection_photos (collection_id, photo_id, sort_order)
            VALUES (?, ?, ?)
        `);
        const transaction = this.getDb().transaction((ids: string[]) => {
            ids.forEach((photoId, index) => {
                stmt.run(collectionId, photoId, index);
            });
        });
        transaction(photoIds);
    }

    removePhotosFromCollection(collectionId: string, photoIds: string[]): void {
        const placeholders = photoIds.map(() => '?').join(',');
        this.getDb().prepare(`
            DELETE FROM collection_photos
            WHERE collection_id = ? AND photo_id IN (${placeholders})
        `).run(collectionId, ...photoIds);
    }

    // ===== ALBUM / PHOTO BOOK OPERATIONS =====
    // Mirrors the collection pattern: writes via getDb().prepare(), reads via
    // this.stmt(), page saves wrapped in a transaction. JSON is parsed in the
    // getters (unlike the smart_criteria latent bug) because the render pipeline
    // needs real objects. Album writes NEVER call invalidateCache() — searchCache
    // is photo-query-keyed and clearing it would re-run the full-library query.

    createAlbum(a: Partial<Album>): string {
        const id = a.id || uuidv4();
        this.getDb().prepare(`
            INSERT INTO albums (id, name, description, page_format, target_type, cover_photo_id, settings, agent_summary, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, a.name, a.description ?? null, a.page_format ?? '4x6', a.target_type ?? 'book',
            a.cover_photo_id ?? null, a.settings ? JSON.stringify(a.settings) : null,
            a.agent_summary ?? null, a.sort_order ?? 0
        );
        return id;
    }

    updateAlbum(id: string, u: Partial<Album>): void {
        const fields: string[] = [];
        const values: any[] = [];
        if (u.name !== undefined) { fields.push('name = ?'); values.push(u.name); }
        if (u.description !== undefined) { fields.push('description = ?'); values.push(u.description); }
        if (u.page_format !== undefined) { fields.push('page_format = ?'); values.push(u.page_format); }
        if (u.target_type !== undefined) { fields.push('target_type = ?'); values.push(u.target_type); }
        if (u.cover_photo_id !== undefined) { fields.push('cover_photo_id = ?'); values.push(u.cover_photo_id); }
        if (u.settings !== undefined) { fields.push('settings = ?'); values.push(JSON.stringify(u.settings)); }
        if (u.agent_summary !== undefined) { fields.push('agent_summary = ?'); values.push(u.agent_summary); }
        if (fields.length === 0) return;
        values.push(id);
        this.getDb().prepare(`UPDATE albums SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteAlbum(id: string): void {
        // album_pages + album_page_photos cascade via ON DELETE CASCADE
        this.getDb().prepare('DELETE FROM albums WHERE id = ?').run(id);
    }

    getAlbums(): Album[] {
        const rows = this.stmt(`
            SELECT a.*, COUNT(DISTINCT ap.id) as page_count
            FROM albums a
            LEFT JOIN album_pages ap ON ap.album_id = a.id
            GROUP BY a.id
            ORDER BY a.sort_order, a.updated_at DESC
        `).all() as any[];
        return rows.map(r => ({ ...r, settings: r.settings ? JSON.parse(r.settings) : undefined }));
    }

    getAlbumPages(albumId: string): AlbumPage[] {
        const pages = this.stmt(`SELECT * FROM album_pages WHERE album_id = ? ORDER BY page_index`).all(albumId) as any[];
        const photoStmt = this.stmt(`SELECT photo_id, slot_index, crop_data FROM album_page_photos WHERE page_id = ? ORDER BY slot_index`);
        return pages.map(p => ({
            ...p,
            layout_data: p.layout_data ? JSON.parse(p.layout_data) : { slots: [] },
            photos: (photoStmt.all(p.id) as any[]).map(x => ({
                photo_id: x.photo_id,
                slot_index: x.slot_index,
                crop_data: x.crop_data ? JSON.parse(x.crop_data) : undefined
            }))
        }));
    }

    // Full replace of an album's pages in one transaction (caller sends the full desired state).
    saveAlbumPages(albumId: string, pages: AlbumPage[]): void {
        const db = this.getDb();
        const delPages = db.prepare('DELETE FROM album_pages WHERE album_id = ?');
        const insPage = db.prepare(`INSERT INTO album_pages (id, album_id, page_index, page_kind, layout_template, layout_data) VALUES (?, ?, ?, ?, ?, ?)`);
        const insPhoto = db.prepare(`INSERT INTO album_page_photos (page_id, photo_id, slot_index, crop_data) VALUES (?, ?, ?, ?)`);
        db.transaction(() => {
            delPages.run(albumId);
            pages.forEach((pg, i) => {
                const pid = pg.id || uuidv4();
                insPage.run(pid, albumId, i, pg.page_kind || 'photo', pg.layout_template || 'full-bleed-1', JSON.stringify(pg.layout_data || { slots: [] }));
                (pg.photos || []).forEach(s => insPhoto.run(pid, s.photo_id, s.slot_index, s.crop_data ? JSON.stringify(s.crop_data) : null));
            });
        })();
    }

    // Fetch full photo rows by id list (preserves the given order). Used by album build/export.
    getPhotosByIds(ids: string[]): Photo[] {
        if (!ids.length) return [];
        const placeholders = ids.map(() => '?').join(',');
        const rows = this.getDb().prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`).all(...ids) as Photo[];
        const byId = new Map(rows.map(r => [r.id, r]));
        return ids.map(id => byId.get(id)).filter((p): p is Photo => !!p);
    }

    // Batch signal fetch for album auto-curation (single indexed query, not N round-trips).
    getKeywordsForPhotos(ids: string[]): Record<string, string[]> {
        if (!ids.length) return {};
        const ph = ids.map(() => '?').join(',');
        const rows = this.getDb().prepare(
            `SELECT pk.photo_id as pid, k.name as name FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id IN (${ph})`
        ).all(...ids) as { pid: string; name: string }[];
        const out: Record<string, string[]> = {};
        for (const r of rows) (out[r.pid] ||= []).push(r.name);
        return out;
    }

    getFacesForPhotos(ids: string[]): Record<string, { person_id: string | null; box: number[] }[]> {
        if (!ids.length) return {};
        const ph = ids.map(() => '?').join(',');
        const rows = this.getDb().prepare(
            `SELECT photo_id, person_id, box_x, box_y, box_width, box_height FROM faces WHERE photo_id IN (${ph})`
        ).all(...ids) as any[];
        const out: Record<string, { person_id: string | null; box: number[] }[]> = {};
        for (const r of rows) (out[r.photo_id] ||= []).push({ person_id: r.person_id, box: [r.box_x, r.box_y, r.box_width, r.box_height] });
        return out;
    }

    // ===== KEYWORD OPERATIONS =====

    createKeyword(keyword: Partial<Keyword>): string {
        const id = keyword.id || uuidv4();
        this.getDb().prepare(`
            INSERT INTO keywords (id, name, parent_id, synonyms, include_on_export)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            id, keyword.name, keyword.parent_id,
            keyword.synonyms ? JSON.stringify(keyword.synonyms) : null,
            keyword.include_on_export !== false ? 1 : 0
        );
        return id;
    }

    getKeywords(): Keyword[] {
        return this.stmt(`
            SELECT k.*, COUNT(pk.photo_id) as photo_count
            FROM keywords k
            LEFT JOIN photo_keywords pk ON k.id = pk.keyword_id
            GROUP BY k.id
            ORDER BY k.name
        `).all() as Keyword[];
    }

    getOrCreateKeywordByName(name: string): string {
        const existing = this.stmt(`
            SELECT id FROM keywords WHERE LOWER(name) = LOWER(?)
        `).get(name) as { id: string } | undefined;

        if (existing) {
            return existing.id;
        }

        return this.createKeyword({ name: name.toLowerCase() });
    }

    addKeywordsByNameToPhoto(photoId: string, keywordNames: string[]): void {
        const keywordIds = keywordNames.map(name => this.getOrCreateKeywordByName(name));
        this.addKeywordsToPhoto(photoId, keywordIds);
    }

    addKeywordsToPhoto(photoId: string, keywordIds: string[]): void {
        const stmt = this.getDb().prepare(`
            INSERT OR IGNORE INTO photo_keywords (photo_id, keyword_id)
            VALUES (?, ?)
        `);
        const transaction = this.getDb().transaction((ids: string[]) => {
            ids.forEach((keywordId) => {
                stmt.run(photoId, keywordId);
            });
        });
        transaction(keywordIds);
    }

    removeKeywordsFromPhoto(photoId: string, keywordIds: string[]): void {
        const placeholders = keywordIds.map(() => '?').join(',');
        this.getDb().prepare(`
            DELETE FROM photo_keywords
            WHERE photo_id = ? AND keyword_id IN (${placeholders})
        `).run(photoId, ...keywordIds);
    }

    getPhotoKeywords(photoId: string): Keyword[] {
        return this.stmt(`
            SELECT k.* FROM keywords k
            INNER JOIN photo_keywords pk ON k.id = pk.keyword_id
            WHERE pk.photo_id = ?
        `).all(photoId) as Keyword[];
    }

    // ===== FOLDER OPERATIONS =====

    upsertFolder(folder: Partial<Folder>): string {
        const id = folder.id || uuidv4();
        this.getDb().prepare(`
            INSERT INTO folders (id, path, name, parent_id, is_watched)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                is_watched = excluded.is_watched
        `).run(id, folder.path, folder.name, folder.parent_id, folder.is_watched ? 1 : 0);
        return id;
    }

    getFolders(): Folder[] {
        // Optimized: use path || '/% to avoid matching partial folder names
        // and use subquery instead of expensive LEFT JOIN + LIKE + GROUP BY
        return this.stmt(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM photos p
                    WHERE p.file_path LIKE f.path || '/%') as photo_count
            FROM folders f
            ORDER BY f.path
        `).all() as Folder[];
    }

    // Get folders with proper hierarchy for tree display
    getFoldersHierarchy(): Folder[] {
        return this.stmt(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM photos p WHERE p.file_path LIKE f.path || '/%'
                    AND p.file_path NOT LIKE f.path || '/%/%') as photo_count
            FROM folders f
            ORDER BY f.path
        `).all() as Folder[];
    }

    // Rebuild folder hierarchy based on path structure
    rebuildFolderHierarchy(rootPath?: string): { updated: number; created: number } {
        let updated = 0;
        let created = 0;

        const normalizedRoot = rootPath
            ? (rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath)
            : null;

        // Get all folders
        const folders = this.getDb().prepare('SELECT id, path, name FROM folders ORDER BY path').all() as Folder[];

        // Create a map of path -> folder for quick lookup
        const pathToFolder = new Map<string, Folder>();
        for (const folder of folders) {
            const normalizedPath = folder.path.endsWith('/') ? folder.path.slice(0, -1) : folder.path;
            pathToFolder.set(normalizedPath, folder);
        }

        // Helper function to ensure a folder path exists (creates all parent folders recursively)
        const ensureFolderExists = (folderPath: string): string | null => {
            const normalizedPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;

            // Check if already exists
            if (pathToFolder.has(normalizedPath)) {
                return pathToFolder.get(normalizedPath)!.id;
            }

            // Don't create folders above the root
            if (normalizedRoot && !normalizedPath.startsWith(normalizedRoot)) {
                return null;
            }

            // Stop at root or filesystem root
            if (normalizedPath === normalizedRoot || normalizedPath === '/' || normalizedPath === '.') {
                return null;
            }

            // Create this folder
            const folderName = path.basename(normalizedPath);
            const folderId = uuidv4();

            this.getDb().prepare(`
                INSERT OR IGNORE INTO folders (id, path, name, parent_id, is_watched)
                VALUES (?, ?, ?, NULL, 0)
            `).run(folderId, normalizedPath, folderName);

            pathToFolder.set(normalizedPath, {
                id: folderId,
                path: normalizedPath,
                name: folderName,
                is_watched: false,
                photo_count: 0
            });
            created++;

            return folderId;
        };

        // If rootPath provided, ensure it exists as root folder
        if (normalizedRoot) {
            ensureFolderExists(normalizedRoot);
        }

        // First pass: Create all missing parent folders
        for (const folder of folders) {
            const folderPath = folder.path.endsWith('/') ? folder.path.slice(0, -1) : folder.path;

            // Walk up the path and ensure all parents exist
            let currentPath = path.dirname(folderPath);
            while (currentPath && currentPath !== '/' && currentPath !== '.') {
                if (normalizedRoot && !currentPath.startsWith(normalizedRoot)) {
                    break;
                }
                if (currentPath === normalizedRoot) {
                    ensureFolderExists(currentPath);
                    break;
                }
                ensureFolderExists(currentPath);
                currentPath = path.dirname(currentPath);
            }
        }

        // Second pass: Update parent_id for all folders
        const updateStmt = this.getDb().prepare('UPDATE folders SET parent_id = ? WHERE id = ?');

        // Refresh folder list after creating missing ones
        const allFolders = this.getDb().prepare('SELECT id, path, name FROM folders ORDER BY path').all() as Folder[];
        const refreshedPathToFolder = new Map<string, Folder>();
        for (const folder of allFolders) {
            const normalizedPath = folder.path.endsWith('/') ? folder.path.slice(0, -1) : folder.path;
            refreshedPathToFolder.set(normalizedPath, folder);
        }

        const updateTransaction = this.getDb().transaction(() => {
            for (const folder of allFolders) {
                const folderPath = folder.path.endsWith('/') ? folder.path.slice(0, -1) : folder.path;
                const parentPath = path.dirname(folderPath);

                // Don't update if at root level
                if (parentPath === folderPath || parentPath === '.' || parentPath === '/') {
                    continue;
                }

                // Don't set parent if above the root
                if (normalizedRoot && !parentPath.startsWith(normalizedRoot) && parentPath !== normalizedRoot) {
                    continue;
                }

                const parentFolder = refreshedPathToFolder.get(parentPath);
                if (parentFolder) {
                    updateStmt.run(parentFolder.id, folder.id);
                    updated++;
                }
            }
        });

        updateTransaction();

        console.log(`[Database] Folder hierarchy rebuilt: ${updated} updated, ${created} created`);
        return { updated, created };
    }

    // Get child folders of a parent
    getChildFolders(parentId: string | null): Folder[] {
        if (parentId === null) {
            return this.stmt(`
                SELECT f.*,
                       (SELECT COUNT(*) FROM photos p WHERE p.file_path LIKE f.path || '/%'
                        AND p.file_path NOT LIKE f.path || '/%/%') as photo_count
                FROM folders f
                WHERE f.parent_id IS NULL
                ORDER BY f.name
            `).all() as Folder[];
        }
        return this.stmt(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM photos p WHERE p.file_path LIKE f.path || '/%'
                    AND p.file_path NOT LIKE f.path || '/%/%') as photo_count
            FROM folders f
            WHERE f.parent_id = ?
            ORDER BY f.name
        `).all(parentId) as Folder[];
    }

    // Get folder by path
    getFolderByPath(folderPath: string): Folder | null {
        const normalizedPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
        const result = this.stmt(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM photos p WHERE p.file_path LIKE f.path || '/%') as photo_count
            FROM folders f
            WHERE f.path = ?
        `).get(normalizedPath) as Folder | undefined;
        return result || null;
    }

    // Delete folder from database
    deleteFolder(folderId: string): void {
        // First delete all child folders recursively
        const children = this.getChildFolders(folderId);
        for (const child of children) {
            this.deleteFolder(child.id);
        }
        // Then delete this folder
        this.stmt('DELETE FROM folders WHERE id = ?').run(folderId);
    }

    // Get all folders (flat list)
    getAllFolders(): Folder[] {
        return this.stmt(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM photos p WHERE p.file_path LIKE f.path || '/%') as photo_count
            FROM folders f
            ORDER BY f.path
        `).all() as Folder[];
    }

    // Update folder
    updateFolder(folderId: string, updates: Partial<Folder>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.path !== undefined) {
            fields.push('path = ?');
            values.push(updates.path);
        }
        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.parent_id !== undefined) {
            fields.push('parent_id = ?');
            values.push(updates.parent_id);
        }
        if (updates.is_watched !== undefined) {
            fields.push('is_watched = ?');
            values.push(updates.is_watched ? 1 : 0);
        }

        if (fields.length > 0) {
            values.push(folderId);
            this.getDb().prepare(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        }
    }

    // ===== STATISTICS =====

    getStatistics(): {
        totalPhotos: number;
        totalRaw: number;
        totalCollections: number;
        totalKeywords: number;
        ratingDistribution: Record<number, number>;
        cameraModels: { model: string; count: number }[];
        dateDistribution: { month: string; count: number }[];
    } {
        const totalPhotos = this.getPhotoCount();
        const totalRaw = (this.getDb().prepare('SELECT COUNT(*) as count FROM photos WHERE is_raw = 1').get() as { count: number }).count;
        const totalCollections = (this.getDb().prepare('SELECT COUNT(*) as count FROM collections').get() as { count: number }).count;
        const totalKeywords = (this.getDb().prepare('SELECT COUNT(*) as count FROM keywords').get() as { count: number }).count;

        const ratingRows = this.getDb().prepare(`
            SELECT rating, COUNT(*) as count FROM photos GROUP BY rating
        `).all() as { rating: number; count: number }[];
        const ratingDistribution: Record<number, number> = {};
        ratingRows.forEach(row => { ratingDistribution[row.rating] = row.count; });

        const cameraModels = this.getDb().prepare(`
            SELECT camera_model as model, COUNT(*) as count
            FROM photos
            WHERE camera_model IS NOT NULL
            GROUP BY camera_model
            ORDER BY count DESC
            LIMIT 10
        `).all() as { model: string; count: number }[];

        const dateDistribution = this.getDb().prepare(`
            SELECT strftime('%Y-%m', date_taken) as month, COUNT(*) as count
            FROM photos
            WHERE date_taken IS NOT NULL
            GROUP BY month
            ORDER BY month DESC
            LIMIT 24
        `).all() as { month: string; count: number }[];

        return {
            totalPhotos,
            totalRaw,
            totalCollections,
            totalKeywords,
            ratingDistribution,
            cameraModels,
            dateDistribution
        };
    }

    // ===== BULK OPERATIONS =====

    bulkInsertPhotos(photos: Partial<Photo>[]): string[] {
        const ids: string[] = [];
        const stmt = this.getDb().prepare(`
            INSERT INTO photos (
                id, file_path, file_name, file_size, file_type, mime_type,
                width, height, orientation, date_taken, date_modified,
                camera_make, camera_model, lens_model, focal_length, aperture,
                shutter_speed, iso, flash_used, gps_latitude, gps_longitude,
                gps_altitude, rating, flag, color_label, title, caption,
                copyright, creator, is_raw, raw_type, thumbnail_path, preview_path,
                indexed
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?
            )
        `);

        const transaction = this.getDb().transaction((photosToInsert: Partial<Photo>[]) => {
            for (const photo of photosToInsert) {
                const id = photo.id || uuidv4();
                ids.push(id);
                stmt.run(
                    id, photo.file_path, photo.file_name, photo.file_size, photo.file_type, photo.mime_type,
                    photo.width, photo.height, photo.orientation || 1, photo.date_taken, photo.date_modified,
                    photo.camera_make, photo.camera_model, photo.lens_model, photo.focal_length, photo.aperture,
                    photo.shutter_speed, photo.iso, photo.flash_used ? 1 : 0, photo.gps_latitude, photo.gps_longitude,
                    photo.gps_altitude, photo.rating || 0, photo.flag || 'none', photo.color_label || 'none',
                    photo.title, photo.caption, photo.copyright, photo.creator,
                    photo.is_raw ? 1 : 0, photo.raw_type, photo.thumbnail_path, photo.preview_path,
                    photo.indexed ? 1 : 0
                );
            }
        });

        transaction(photos);
        this.invalidateCache();
        return ids;
    }

    bulkUpdateRating(photoIds: string[], rating: number): void {
        const placeholders = photoIds.map(() => '?').join(',');
        this.getDb().prepare(`UPDATE photos SET rating = ? WHERE id IN (${placeholders})`).run(rating, ...photoIds);
        this.invalidateCache();
    }

    bulkUpdateFlag(photoIds: string[], flag: 'none' | 'picked' | 'rejected'): void {
        const placeholders = photoIds.map(() => '?').join(',');
        this.getDb().prepare(`UPDATE photos SET flag = ? WHERE id IN (${placeholders})`).run(flag, ...photoIds);
        this.invalidateCache();
    }

    bulkUpdateColorLabel(photoIds: string[], colorLabel: 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple'): void {
        const placeholders = photoIds.map(() => '?').join(',');
        this.getDb().prepare(`UPDATE photos SET color_label = ? WHERE id IN (${placeholders})`).run(colorLabel, ...photoIds);
        this.invalidateCache();
    }

    // ===== PEOPLE OPERATIONS =====

    createPerson(name: string): string {
        const id = uuidv4();
        this.getDb().prepare(`
            INSERT INTO people (id, name) VALUES (?, ?)
        `).run(id, name);
        return id;
    }

    updatePerson(id: string, name: string): void {
        this.getDb().prepare(`UPDATE people SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, id);
    }

    deletePerson(id: string): void {
        this.getDb().prepare('DELETE FROM people WHERE id = ?').run(id);
    }

    getPeople(): { id: string; name: string; face_count: number; thumbnail_face_id?: string }[] {
        return this.stmt(`
            SELECT p.*, COUNT(f.id) as face_count
            FROM people p
            LEFT JOIN faces f ON p.id = f.person_id
            GROUP BY p.id
            ORDER BY p.name
        `).all() as any[];
    }

    getPerson(id: string): { id: string; name: string; face_count: number; thumbnail_face_id?: string } | undefined {
        return this.stmt(`
            SELECT p.*, COUNT(f.id) as face_count
            FROM people p
            LEFT JOIN faces f ON p.id = f.person_id
            WHERE p.id = ?
            GROUP BY p.id
        `).get(id) as any;
    }

    // ===== FACE OPERATIONS =====

    insertFace(face: {
        id: string;
        photo_id: string;
        person_id?: string;
        box_x: number;
        box_y: number;
        box_width: number;
        box_height: number;
        descriptor?: string;
        confidence: number;
    }): void {
        this.getDb().prepare(`
            INSERT INTO faces (id, photo_id, person_id, box_x, box_y, box_width, box_height, descriptor, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            face.id, face.photo_id, face.person_id ?? null,
            face.box_x, face.box_y, face.box_width, face.box_height,
            face.descriptor, face.confidence
        );
    }

    setFaceCropPath(faceId: string, cropPath: string): void {
        this.getDb().prepare('UPDATE faces SET face_crop_path = ? WHERE id = ?').run(cropPath, faceId);
    }

    // People-view backfill queue: only the representative faces the cards show
    // (JOIN people on thumbnail_face_id => ~119 rows, not all faces), and only
    // those whose photo has a decodable thumbnail so a crop source exists.
    getFacesNeedingCrops(): {
        id: string; photo_id: string; file_path: string; thumbnail_path: string | null;
        box_x: number; box_y: number; box_width: number; box_height: number;
    }[] {
        return this.stmt(`
            SELECT f.id, f.photo_id, f.box_x, f.box_y, f.box_width, f.box_height,
                   p.file_path, p.thumbnail_path
            FROM faces f
            JOIN photos p  ON f.photo_id = p.id
            JOIN people pe ON pe.thumbnail_face_id = f.id
            WHERE f.face_crop_path IS NULL AND p.thumbnail_path IS NOT NULL
        `).all() as any[];
    }

    assignFaceToPerson(faceId: string, personId: string, confirmed: boolean = false): void {
        this.getDb().prepare(`
            UPDATE faces SET person_id = ?, is_confirmed = ? WHERE id = ?
        `).run(personId, confirmed ? 1 : 0, faceId);
    }

    getFacesForPhoto(photoId: string): any[] {
        return this.stmt(`
            SELECT f.*, p.name as person_name
            FROM faces f
            LEFT JOIN people p ON f.person_id = p.id
            WHERE f.photo_id = ?
        `).all(photoId) as any[];
    }

    getUnidentifiedFaces(): any[] {
        return this.stmt(`
            SELECT f.*, ph.file_path, ph.thumbnail_path
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NULL
            ORDER BY f.confidence DESC
            LIMIT 100
        `).all() as any[];
    }

    getPhotosByPerson(personId: string): Photo[] {
        return this.stmt(`
            SELECT DISTINCT p.*
            FROM photos p
            JOIN faces f ON p.id = f.photo_id
            WHERE f.person_id = ?
            ORDER BY p.date_taken DESC
        `).all(personId) as Photo[];
    }

    deleteFace(faceId: string): void {
        this.stmt('DELETE FROM faces WHERE id = ?').run(faceId);
    }

    // ===== DUPLICATE DETECTION =====

    findDuplicatesByHash(): { hash: string; photos: Photo[] }[] {
        const duplicates = this.getDb().prepare(`
            SELECT hash, COUNT(*) as count
            FROM photos
            WHERE hash IS NOT NULL
            GROUP BY hash
            HAVING count > 1
        `).all() as { hash: string; count: number }[];

        return duplicates.map(dup => ({
            hash: dup.hash,
            photos: this.getDb().prepare(`
                SELECT * FROM photos WHERE hash = ?
            `).all(dup.hash) as Photo[]
        }));
    }

    updatePhotoHash(photoId: string, hash: string): void {
        this.getDb().prepare('UPDATE photos SET hash = ? WHERE id = ?').run(hash, photoId);
    }

    // ===== FACE CLUSTERING =====

    // Get all faces with descriptors for clustering
    // Cached face queries
    getAllFacesWithDescriptors(): {
        id: string;
        photo_id: string;
        person_id: string | null;
        descriptor: string;
        thumbnail_path: string | null;
        box_x: number;
        box_y: number;
        box_width: number;
        box_height: number;
        confidence: number;
    }[] {
        return this.stmt(`
            SELECT f.id, f.photo_id, f.person_id, f.descriptor,
                   f.box_x, f.box_y, f.box_width, f.box_height, f.confidence,
                   p.thumbnail_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.descriptor IS NOT NULL
            ORDER BY f.confidence DESC
        `).all() as any[];
    }

    // Get unassigned faces with descriptors
    getUnassignedFacesWithDescriptors(): {
        id: string;
        photo_id: string;
        descriptor: string;
        thumbnail_path: string | null;
        box_x: number;
        box_y: number;
        box_width: number;
        box_height: number;
        confidence: number;
    }[] {
        return this.stmt(`
            SELECT f.id, f.photo_id, f.descriptor,
                   f.box_x, f.box_y, f.box_width, f.box_height, f.confidence,
                   p.thumbnail_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.descriptor IS NOT NULL AND f.person_id IS NULL
            ORDER BY f.confidence DESC
        `).all() as any[];
    }

    // Bulk assign faces to a person
    bulkAssignFacesToPerson(faceIds: string[], personId: string): void {
        if (faceIds.length === 0) return;
        const placeholders = faceIds.map(() => '?').join(',');
        this.getDb().prepare(`
            UPDATE faces SET person_id = ? WHERE id IN (${placeholders})
        `).run(personId, ...faceIds);
    }

    // Update person thumbnail
    updatePersonThumbnail(personId: string, faceId: string): void {
        this.getDb().prepare(`
            UPDATE people SET thumbnail_face_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(faceId, personId);
    }

    // Get face count
    getFaceCount(): number {
        const result = this.getDb().prepare('SELECT COUNT(*) as count FROM faces').get() as { count: number };
        return result.count;
    }

    // Get unassigned face count
    getUnassignedFaceCount(): number {
        const result = this.getDb().prepare('SELECT COUNT(*) as count FROM faces WHERE person_id IS NULL').get() as { count: number };
        return result.count;
    }

    // Clear all face data (for re-scanning)
    clearAllFaces(): void {
        this.getDb().prepare('DELETE FROM faces').run();
        this.getDb().prepare('DELETE FROM people').run();
    }

    // Get face by ID with photo info
    getFaceWithPhoto(faceId: string): any {
        return this.stmt(`
            SELECT f.*, p.file_path, p.thumbnail_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id = ?
        `).get(faceId);
    }

    // Get person with their thumbnail face data
    getPersonWithThumbnailFace(personId: string): any {
        const person = this.getPerson(personId);
        if (!person) return null;

        let faceData = null;

        // If person has a thumbnail_face_id, get that face
        if (person.thumbnail_face_id) {
            faceData = this.getFaceWithPhoto(person.thumbnail_face_id);
        }

        // If no thumbnail_face_id or face not found, get the first face for this person
        if (!faceData) {
            faceData = this.getDb().prepare(`
                SELECT f.*, p.file_path, p.thumbnail_path
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ?
                ORDER BY f.confidence DESC
                LIMIT 1
            `).get(personId);
        }

        return {
            ...person,
            face: faceData
        };
    }

    // Get all people with their thumbnail face data
    getPeopleWithThumbnails(): any[] {
        const people = this.getPeople();
        return people.map(person => {
            let faceData = null;

            if (person.thumbnail_face_id) {
                faceData = this.getFaceWithPhoto(person.thumbnail_face_id);
            }

            if (!faceData) {
                faceData = this.getDb().prepare(`
                    SELECT f.*, p.file_path, p.thumbnail_path
                    FROM faces f
                    JOIN photos p ON f.photo_id = p.id
                    WHERE f.person_id = ?
                    ORDER BY f.confidence DESC
                    LIMIT 1
                `).get(person.id);
            }

            return {
                ...person,
                face: faceData
            };
        });
    }

    // Optimiser la base de donnees (VACUUM + ANALYZE)
    optimize(): void {
        try {
            this.getDb().exec('ANALYZE');
            console.log('[Database] ANALYZE completed');
        } catch (e) {
            console.warn('[Database] Optimize failed:', e);
        }
    }

    // Obtenir la taille de la base de donnees
    getDatabaseSize(): number {
        try {
            const pageCount = (this.getDb().prepare('PRAGMA page_count').get() as any).page_count;
            const pageSize = (this.getDb().prepare('PRAGMA page_size').get() as any).page_size;
            return pageCount * pageSize;
        } catch (e) {
            return 0;
        }
    }

    close(): void {
        if (this.db) {
            this.searchCache.clear();
            this.stmtCache.clear();
            this.db.close();
            this.db = null;
        }
    }
}

export const catalogDb = new CatalogDatabase();
export default catalogDb;
