import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import catalogDb from '../database/Database';

export interface FolderNode {
    id: string;
    path: string;
    name: string;
    parent_id: string | null;
    children: FolderNode[];
    photo_count: number;
    is_expanded?: boolean;
    depth: number;
}

export interface FolderYearGroup {
    year: string;
    folders: FolderNode[];
    total_photos: number;
}

class FolderService {
    /**
     * Build hierarchical folder structure from flat folder list
     */
    buildFolderTree(folders: any[]): FolderNode[] {
        // Create a map for quick lookup
        const folderMap = new Map<string, FolderNode>();
        const rootFolders: FolderNode[] = [];

        // First pass: Create nodes
        for (const folder of folders) {
            const node: FolderNode = {
                id: folder.id,
                path: folder.path,
                name: folder.name,
                parent_id: folder.parent_id,
                children: [],
                photo_count: folder.photo_count || 0,
                depth: 0
            };
            folderMap.set(folder.path, node);
        }

        // Second pass: Build hierarchy based on path
        for (const folder of folders) {
            const node = folderMap.get(folder.path)!;
            const parentPath = path.dirname(folder.path);
            const parentNode = folderMap.get(parentPath);

            if (parentNode) {
                node.parent_id = parentNode.id;
                node.depth = parentNode.depth + 1;
                parentNode.children.push(node);
            } else {
                // This is a root folder
                rootFolders.push(node);
            }
        }

        // Sort children alphabetically
        const sortChildren = (nodes: FolderNode[]) => {
            nodes.sort((a, b) => a.name.localeCompare(b.name));
            nodes.forEach(node => sortChildren(node.children));
        };
        sortChildren(rootFolders);

        return rootFolders;
    }

    /**
     * Group folders by year (based on folder name or path)
     */
    groupFoldersByYear(folders: FolderNode[]): FolderYearGroup[] {
        const yearGroups = new Map<string, FolderNode[]>();
        const yearRegex = /\b(20\d{2}|19\d{2})\b/;

        const processFolder = (folder: FolderNode, inheritedYear?: string) => {
            // Try to extract year from folder name or path
            const match = folder.name.match(yearRegex) || folder.path.match(yearRegex);
            const year = match ? match[1] : inheritedYear || 'Other';

            if (!yearGroups.has(year)) {
                yearGroups.set(year, []);
            }

            // Only add top-level folders to groups
            if (folder.depth === 0 || !inheritedYear) {
                yearGroups.get(year)!.push(folder);
            }

            // Process children with inherited year
            folder.children.forEach(child => processFolder(child, year));
        };

        folders.forEach(folder => processFolder(folder));

        // Convert to array and sort by year descending
        const result: FolderYearGroup[] = [];
        const sortedYears = Array.from(yearGroups.keys()).sort((a, b) => {
            if (a === 'Other') return 1;
            if (b === 'Other') return -1;
            return parseInt(b) - parseInt(a);
        });

        for (const year of sortedYears) {
            const folders = yearGroups.get(year)!;
            const total_photos = this.countPhotosRecursive(folders);
            result.push({ year, folders, total_photos });
        }

        return result;
    }

    private countPhotosRecursive(folders: FolderNode[]): number {
        let count = 0;
        for (const folder of folders) {
            count += folder.photo_count;
            count += this.countPhotosRecursive(folder.children);
        }
        return count;
    }

    /**
     * Scan and import folder structure
     */
    async scanAndImportFolderStructure(rootPath: string): Promise<void> {
        const folders: { path: string; name: string; parent_path: string | null }[] = [];

        const scanDir = (dirPath: string, parentPath: string | null) => {
            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        const fullPath = path.join(dirPath, entry.name);
                        folders.push({
                            path: fullPath,
                            name: entry.name,
                            parent_path: parentPath
                        });
                        // Recursively scan subdirectories
                        scanDir(fullPath, fullPath);
                    }
                }
            } catch (error) {
                console.error(`[FolderService] Error scanning ${dirPath}:`, error);
            }
        };

        // Add root folder first
        folders.push({
            path: rootPath,
            name: path.basename(rootPath),
            parent_path: null
        });

        // Scan subdirectories
        scanDir(rootPath, rootPath);

        // Import folders to database
        const db = catalogDb.getDb();
        const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO folders (id, path, name, parent_id, is_watched)
            VALUES (?, ?, ?, ?, 1)
        `);

        // First, create all folders
        const pathToId = new Map<string, string>();

        for (const folder of folders) {
            const id = uuidv4();
            pathToId.set(folder.path, id);
        }

        // Then insert with correct parent_id
        const transaction = db.transaction(() => {
            for (const folder of folders) {
                const id = pathToId.get(folder.path)!;
                const parentId = folder.parent_path ? pathToId.get(folder.parent_path) : null;
                insertStmt.run(id, folder.path, folder.name, parentId);
            }
        });

        transaction();
        console.log(`[FolderService] Imported ${folders.length} folders`);
    }

    /**
     * Get folder hierarchy from database
     */
    getFolderHierarchy(): FolderNode[] {
        const db = catalogDb.getDb();

        // Get all folders with photo counts
        const folders = db.prepare(`
            SELECT
                f.id,
                f.path,
                f.name,
                f.parent_id,
                COUNT(DISTINCT p.id) as photo_count
            FROM folders f
            LEFT JOIN photos p ON p.file_path LIKE f.path || '/%'
            GROUP BY f.id
            ORDER BY f.path
        `).all();

        return this.buildFolderTree(folders);
    }

    /**
     * Get folders grouped by year
     */
    getFoldersGroupedByYear(): FolderYearGroup[] {
        const hierarchy = this.getFolderHierarchy();
        return this.groupFoldersByYear(hierarchy);
    }

    /**
     * Update folder photo count
     */
    updateFolderPhotoCounts(): void {
        const db = catalogDb.getDb();
        db.exec(`
            UPDATE folders SET photo_count = (
                SELECT COUNT(*) FROM photos
                WHERE photos.file_path LIKE folders.path || '/%'
            )
        `);
    }

    /**
     * Get photos in a specific folder (non-recursive)
     */
    getPhotosInFolder(folderPath: string): any[] {
        const db = catalogDb.getDb();
        return db.prepare(`
            SELECT * FROM photos
            WHERE file_path LIKE ? || '/%'
            AND file_path NOT LIKE ? || '/%/%'
            ORDER BY date_taken DESC
        `).all(folderPath, folderPath);
    }

    /**
     * Get photos in folder recursively
     */
    getPhotosInFolderRecursive(folderPath: string): any[] {
        const db = catalogDb.getDb();
        return db.prepare(`
            SELECT * FROM photos
            WHERE file_path LIKE ? || '/%'
            ORDER BY date_taken DESC
        `).all(folderPath);
    }

    /**
     * Watch folder for changes
     */
    setFolderWatched(folderId: string, isWatched: boolean): void {
        const db = catalogDb.getDb();
        db.prepare('UPDATE folders SET is_watched = ? WHERE id = ?').run(isWatched ? 1 : 0, folderId);
    }

    /**
     * Remove folder from catalog (not from disk)
     */
    removeFolder(folderId: string): void {
        const db = catalogDb.getDb();
        // Get folder path first
        const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(folderId) as { path: string } | undefined;
        if (!folder) return;

        // Remove photos in this folder
        db.prepare('DELETE FROM photos WHERE file_path LIKE ? || \'/%\'').run(folder.path);

        // Remove folder and subfolders
        db.prepare('DELETE FROM folders WHERE path LIKE ? || \'/%\' OR path = ?').run(folder.path, folder.path);
    }
}

export const folderService = new FolderService();
export default folderService;
