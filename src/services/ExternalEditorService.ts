import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import catalogDb from '../database/Database';
import thumbnailService from './ThumbnailService';
import importService from './ImportService';

export interface ExternalEditor {
    id: string;
    name: string;
    path: string;
    icon?: string;
    isDefault?: boolean;
    isInstalled: boolean;
}

export interface EditSession {
    photoId: string;
    originalPath: string;
    tempPath?: string;
    editorId: string;
    process?: ChildProcess;
    startedAt: Date;
    watcher?: fs.FSWatcher;
    folderPath: string;
}

// Callback type for when new edited files are detected
export type OnNewEditedFileCallback = (originalPhotoId: string, newFilePath: string) => void;

// Known editors and their typical installation paths
const KNOWN_EDITORS: { id: string; name: string; paths: Record<string, string[]> }[] = [
    {
        id: 'affinity-photo',
        name: 'Affinity Photo',
        paths: {
            darwin: [
                '/Applications/Affinity.app',
                '/Applications/Affinity Photo 2.app',
                '/Applications/Affinity Photo.app'
            ],
            win32: [
                'C:\\Program Files\\Affinity\\Photo 2\\Photo.exe',
                'C:\\Program Files\\Affinity\\Photo\\Photo.exe'
            ],
            linux: []
        }
    }
];

// Extensions for edited files to watch for
const EDITED_FILE_EXTENSIONS = ['.af', '.afphoto', '.psd', '.tiff', '.tif', '.jpg', '.jpeg', '.png'];

class ExternalEditorService {
    private editors: ExternalEditor[] = [];
    private customEditors: ExternalEditor[] = [];
    private activeSessions: Map<string, EditSession> = new Map();
    private onNewEditedFileCallback: OnNewEditedFileCallback | null = null;
    private knownFiles: Map<string, Set<string>> = new Map(); // folder -> known files

    // Set callback for when new edited files are detected
    setOnNewEditedFile(callback: OnNewEditedFileCallback): void {
        this.onNewEditedFileCallback = callback;
    }

    async initialize(): Promise<void> {
        await this.detectInstalledEditors();
        this.loadCustomEditors();
    }

    private async detectInstalledEditors(): Promise<void> {
        const platform = os.platform();
        this.editors = [];

        for (const editor of KNOWN_EDITORS) {
            const platformPaths = editor.paths[platform] || [];
            let installedPath: string | null = null;

            for (const editorPath of platformPaths) {
                if (this.checkPathExists(editorPath)) {
                    installedPath = editorPath;
                    break;
                }
            }

            this.editors.push({
                id: editor.id,
                name: editor.name,
                path: installedPath || '',
                isInstalled: installedPath !== null,
                isDefault: editor.id === 'affinity-photo' // Prefer Affinity Photo as default
            });
        }

        console.log('[ExternalEditorService] Detected editors:', this.editors.filter(e => e.isInstalled).map(e => e.name));
    }

    private checkPathExists(editorPath: string): boolean {
        try {
            return fs.existsSync(editorPath);
        } catch {
            return false;
        }
    }

    private loadCustomEditors(): void {
        // In a real app, this would load from user preferences
        this.customEditors = [];
    }

    getAvailableEditors(): ExternalEditor[] {
        return [...this.editors.filter(e => e.isInstalled), ...this.customEditors];
    }

    getDefaultEditor(): ExternalEditor | null {
        const available = this.getAvailableEditors();
        return available.find(e => e.isDefault) || available[0] || null;
    }

    addCustomEditor(editor: Omit<ExternalEditor, 'id' | 'isInstalled'>): ExternalEditor {
        const id = `custom-${Date.now()}`;
        const isInstalled = this.checkPathExists(editor.path);
        const customEditor: ExternalEditor = {
            ...editor,
            id,
            isInstalled
        };
        this.customEditors.push(customEditor);
        return customEditor;
    }

    removeCustomEditor(editorId: string): void {
        this.customEditors = this.customEditors.filter(e => e.id !== editorId);
    }

    setDefaultEditor(editorId: string): void {
        for (const editor of [...this.editors, ...this.customEditors]) {
            editor.isDefault = editor.id === editorId;
        }
    }

    /**
     * Create a copy of the original file for non-destructive editing
     * Returns the path to the copy
     * Priority: existing .afphoto > existing .af > existing _Edit copy > new copy
     */
    createEditCopy(originalPath: string): string | null {
        try {
            const dir = path.dirname(originalPath);
            const ext = path.extname(originalPath);
            const baseName = path.basename(originalPath, ext);

            // First, check if an Affinity file already exists (preferred for re-editing)
            const affinityExtensions = ['.afphoto', '.af'];
            for (const afExt of affinityExtensions) {
                // Check: baseName.afphoto
                const afPath = path.join(dir, baseName + afExt);
                if (fs.existsSync(afPath)) {
                    console.log(`[ExternalEditorService] Found existing Affinity file: ${afPath}`);
                    return afPath;
                }
                // Check: baseName_Edit.afphoto
                const afEditPath = path.join(dir, baseName + '_Edit' + afExt);
                if (fs.existsSync(afEditPath)) {
                    console.log(`[ExternalEditorService] Found existing Affinity edit file: ${afEditPath}`);
                    return afEditPath;
                }
            }

            // Check for existing edit copy with original extension
            const copyName = `${baseName}_Edit${ext}`;
            const copyPath = path.join(dir, copyName);

            if (fs.existsSync(copyPath)) {
                console.log(`[ExternalEditorService] Using existing edit copy: ${copyPath}`);
                return copyPath;
            }

            // Create new copy
            fs.copyFileSync(originalPath, copyPath);
            console.log(`[ExternalEditorService] Created edit copy: ${copyPath}`);
            return copyPath;
        } catch (error) {
            console.error('[ExternalEditorService] Failed to create edit copy:', error);
            return null;
        }
    }

    /**
     * Get the edit copy path for a photo (if it exists)
     */
    getEditCopyPath(originalPath: string): string | null {
        const dir = path.dirname(originalPath);
        const ext = path.extname(originalPath);
        const baseName = path.basename(originalPath, ext);
        const copyPath = path.join(dir, `${baseName}_Edit${ext}`);
        return fs.existsSync(copyPath) ? copyPath : null;
    }

    async openInEditor(
        photoPath: string,
        photoId: string,
        editorId?: string,
        createCopy: boolean = true
    ): Promise<{ session: EditSession; editCopyPath: string | null } | null> {
        const editor = editorId
            ? this.getAvailableEditors().find(e => e.id === editorId)
            : this.getDefaultEditor();

        if (!editor || !editor.isInstalled) {
            console.error('[ExternalEditorService] No editor available');
            return null;
        }

        // Check if file exists
        if (!fs.existsSync(photoPath)) {
            console.error(`[ExternalEditorService] File not found: ${photoPath}`);
            return null;
        }

        // Create a copy for non-destructive editing
        let pathToOpen = photoPath;
        let editCopyPath: string | null = null;

        if (createCopy) {
            editCopyPath = this.createEditCopy(photoPath);
            if (editCopyPath) {
                pathToOpen = editCopyPath;
            }
        }

        const session: EditSession = {
            photoId,
            originalPath: photoPath,
            editorId: editor.id,
            startedAt: new Date(),
            folderPath: path.dirname(photoPath)
        };

        try {
            const platform = os.platform();

            if (platform === 'darwin') {
                // macOS: Use AppleScript for better path handling with Affinity
                if (editor.id === 'affinity-photo' && editor.path.endsWith('.app')) {
                    // Use AppleScript to open in Affinity with proper path context
                    const appName = path.basename(editor.path, '.app');
                    const folderPath = path.dirname(pathToOpen);

                    // AppleScript that opens the file and sets the working directory
                    const appleScript = `
                        tell application "Finder"
                            set theFolder to POSIX file "${folderPath}" as alias
                        end tell

                        tell application "${appName}"
                            activate
                            open POSIX file "${pathToOpen}"
                        end tell

                        -- Set the default location for save dialogs by setting Finder's target
                        tell application "Finder"
                            try
                                set target of front Finder window to theFolder
                            end try
                        end tell
                    `;

                    try {
                        execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
                        console.log(`[ExternalEditorService] Opened ${pathToOpen} in ${editor.name} via AppleScript`);
                    } catch (appleScriptError) {
                        console.warn('[ExternalEditorService] AppleScript failed, falling back to open command:', appleScriptError);
                        // Fallback to open command
                        session.process = spawn('open', ['-a', editor.path, pathToOpen], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        session.process.unref();
                    }
                } else if (editor.path.endsWith('.app')) {
                    session.process = spawn('open', ['-a', editor.path, pathToOpen], {
                        detached: true,
                        stdio: 'ignore'
                    });
                    session.process.unref();
                } else {
                    session.process = spawn(editor.path, [pathToOpen], {
                        detached: true,
                        stdio: 'ignore'
                    });
                    session.process.unref();
                }
            } else if (platform === 'win32') {
                // Windows: Direct execution
                session.process = spawn(editor.path, [pathToOpen], {
                    detached: true,
                    stdio: 'ignore',
                    shell: true
                });
                session.process.unref();
            } else {
                // Linux
                session.process = spawn(editor.path, [pathToOpen], {
                    detached: true,
                    stdio: 'ignore'
                });
                session.process.unref();
            }

            this.activeSessions.set(photoId, session);

            console.log(`[ExternalEditorService] Opened ${pathToOpen} in ${editor.name}`);
            return { session, editCopyPath };

        } catch (error) {
            console.error('[ExternalEditorService] Failed to open editor:', error);
            return null;
        }
    }

    async openMultipleInEditor(
        photos: { path: string; id: string }[],
        editorId?: string
    ): Promise<EditSession[]> {
        const sessions: EditSession[] = [];

        for (const photo of photos) {
            const result = await this.openInEditor(photo.path, photo.id, editorId);
            if (result) {
                sessions.push(result.session);
            }
        }

        return sessions;
    }

    getActiveSession(photoId: string): EditSession | undefined {
        return this.activeSessions.get(photoId);
    }

    closeSession(photoId: string): void {
        const session = this.activeSessions.get(photoId);
        if (session) {
            if (session.process && !session.process.killed) {
                session.process.kill();
            }
            if (session.tempPath && fs.existsSync(session.tempPath)) {
                try {
                    fs.unlinkSync(session.tempPath);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            this.activeSessions.delete(photoId);
        }
    }

    // Specific method for Affinity Photo
    async openInAffinityPhoto(photoPath: string, photoId: string): Promise<{ session: EditSession; editCopyPath: string | null } | null> {
        const affinityEditor = this.editors.find(e => e.id === 'affinity-photo' && e.isInstalled);
        if (!affinityEditor) {
            console.error('[ExternalEditorService] Affinity Photo not found');
            return null;
        }
        return this.openInEditor(photoPath, photoId, affinityEditor.id);
    }

    // Export for external editing (creates a copy in a temp location)
    async exportForEditing(
        photoPath: string,
        photoId: string,
        format: 'tiff' | 'psd' | 'original' = 'original'
    ): Promise<string | null> {
        try {
            const tempDir = os.tmpdir();
            const ext = format === 'original' ? path.extname(photoPath) : `.${format}`;
            const tempFileName = `photocatalog_edit_${photoId}_${Date.now()}${ext}`;
            const tempPath = path.join(tempDir, tempFileName);

            if (format === 'original') {
                // Simple copy
                fs.copyFileSync(photoPath, tempPath);
            } else {
                // Would need image conversion here
                // For now, just copy the original
                fs.copyFileSync(photoPath, tempPath);
            }

            return tempPath;

        } catch (error) {
            console.error('[ExternalEditorService] Failed to export for editing:', error);
            return null;
        }
    }

    // ---- Lightroom-style linked edit copies --------------------------------
    // A "virtual copy" TIFF is created NEXT TO the original, registered in the
    // catalog (edited_from_id → source), and opened in the editor. TIFF is the
    // key: Affinity re-saves it in place with a plain Cmd+S — impossible with a
    // RAW. A poll watcher spots each save and refreshes the copy's thumbnails,
    // so the edit "comes back by itself", exactly like Lightroom.
    // Watched files: path → last seen stat, plus a settling stat so we never
    // regenerate from a file Affinity is still writing.
    private linkedEdits = new Map<string, {
        photoId: string;
        mtimeMs: number;
        size: number;
        pending?: { mtimeMs: number; size: number };
    }>();

    // Files we've handed to Affinity this session (path → mtime at last open).
    // Affinity keeps documents in memory: if the file changes on disk afterwards
    // (an AI retouch lands in it), Affinity still shows — and could Cmd+S over —
    // the OLD version. We defuse that on the next handoff.
    private affinityHandoffs = new Map<string, number>();

    wasHandedToAffinity(filePath: string): boolean {
        return this.affinityHandoffs.has(filePath);
    }

    /**
     * Open a linked copy in Affinity, defusing the stale-document trap: if the
     * file changed since we last handed it over, ask Affinity to close its
     * in-memory version first so the reopen shows the current pixels. Best
     * effort — Affinity's AppleScript support is thin; when the close fails we
     * return staleRisk so the UI can tell the user what to do.
     */
    async openLinkedCopyInAffinity(copyPath: string, copyPhotoId: string): Promise<{ opened: boolean; staleRisk: boolean }> {
        let staleRisk = false;
        try {
            const st = fs.statSync(copyPath);
            const last = this.affinityHandoffs.get(copyPath);
            if (last !== undefined && st.mtimeMs > last + 500) {
                staleRisk = true;
                const editor = this.getAvailableEditors().find(e => e.id === 'affinity-photo');
                if (editor?.path?.endsWith('.app')) {
                    const appName = path.basename(editor.path, '.app');
                    const docName = path.basename(copyPath).replace(/"/g, '');
                    try {
                        // No "saving no": if the user has unsaved work there,
                        // Affinity asks them instead of silently discarding it.
                        execSync(`osascript -e 'tell application "${appName}" to close (every document whose name is "${docName}")' 2>/dev/null`, { timeout: 4000 });
                        staleRisk = false;
                    } catch { /* Affinity ignored the request — warn via staleRisk */ }
                }
            }
        } catch { /* stat failed — openInEditor will surface the real error */ }

        const result = await this.openInEditor(copyPath, copyPhotoId, undefined, false);
        try { this.affinityHandoffs.set(copyPath, fs.statSync(copyPath).mtimeMs); } catch { /* keep old entry */ }
        return { opened: !!result, staleRisk };
    }

    /** Create (or reuse) the linked TIFF copy for a photo and register it. */
    async createLinkedEditCopy(photoId: string): Promise<{ copyPath: string; copyPhotoId: string } | { error: string }> {
        const original = catalogDb.getPhoto(photoId);
        if (!original) return { error: 'Photo introuvable' };
        if (!fs.existsSync(original.file_path)) return { error: `Fichier source manquant: ${original.file_path}` };

        // Re-editing an existing linked copy? Just reopen it.
        if (original.edited_from_id) {
            return { copyPath: original.file_path, copyPhotoId: original.id };
        }
        const existing = catalogDb.getDb()
            .prepare('SELECT id, file_path FROM photos WHERE edited_from_id = ? LIMIT 1')
            .get(photoId) as { id: string; file_path: string } | undefined;
        if (existing && fs.existsSync(existing.file_path)) {
            return { copyPath: existing.file_path, copyPhotoId: existing.id };
        }

        // Build a collision-safe "<name>-Edit.tif" next to the original.
        const dir = path.dirname(original.file_path);
        const base = path.basename(original.file_path, path.extname(original.file_path));
        let copyPath = path.join(dir, `${base}-Edit.tif`);
        let n = 2;
        while (fs.existsSync(copyPath)) copyPath = path.join(dir, `${base}-Edit-${n++}.tif`);

        const ok = await thumbnailService.renderEditableTiff(original.file_path, copyPath);
        if (!ok) return { error: 'Impossible de générer le TIFF de travail' };

        // Register the copy as a real catalog photo (metadata + thumbnails),
        // then glue it to the original: same capture date so it sits right next
        // to it in the grid, same rating/label, provenance via edited_from_id.
        const imported = await importService.importFiles([copyPath], {
            generateThumbnails: true,
            extractMetadata: true,
            skipDuplicates: false
        });
        const copyPhotoId = imported.importedIds[0];
        if (!copyPhotoId) return { error: imported.errors[0]?.error || 'Import de la copie impossible' };

        catalogDb.updatePhoto(copyPhotoId, {
            date_taken: original.date_taken,
            rating: original.rating,
            color_label: original.color_label,
            edited_from_id: original.id
        } as any);
        catalogDb.updatePhoto(original.id, { edit_copy_path: copyPath } as any);

        this.registerLinkedEdit(copyPath, copyPhotoId);
        return { copyPath, copyPhotoId };
    }

    /** Start watching a linked copy for saves from the editor. */
    registerLinkedEdit(filePath: string, photoId: string): void {
        try {
            const st = fs.statSync(filePath);
            this.linkedEdits.set(filePath, { photoId, mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* file gone — nothing to watch */ }
    }

    /** Re-arm watchers for every linked copy in the catalog (startup). A copy
     *  saved WHILE THE APP WAS CLOSED (file newer than its thumbnail) is armed
     *  as already-changed, so the first watcher ticks bring the edit in. */
    loadLinkedEditsFromCatalog(): number {
        try {
            const rows = catalogDb.getDb()
                .prepare('SELECT id, file_path, thumbnail_path FROM photos WHERE edited_from_id IS NOT NULL')
                .all() as { id: string; file_path: string; thumbnail_path: string | null }[];
            for (const r of rows) {
                this.registerLinkedEdit(r.file_path, r.id);
                try {
                    const fileM = fs.statSync(r.file_path).mtimeMs;
                    const thumbM = r.thumbnail_path && fs.existsSync(r.thumbnail_path)
                        ? fs.statSync(r.thumbnail_path).mtimeMs : 0;
                    if (fileM > thumbM + 1500) {
                        // Pretend our last-known state is ancient → change detected.
                        const e = this.linkedEdits.get(r.file_path);
                        if (e) { e.mtimeMs = 0; e.size = -1; }
                        console.log(`[LinkedEdit] ${path.basename(r.file_path)} was saved while the app was closed — catching up`);
                    }
                } catch { /* keep watching anyway */ }
            }
            return rows.length;
        } catch {
            return 0;
        }
    }

    /**
     * One watcher tick. A change is only acted on once the file has SETTLED
     * (same mtime+size on two consecutive ticks), so a TIFF Affinity is mid-way
     * through writing never produces a corrupt thumbnail. Returns the photoIds
     * whose thumbnails were refreshed.
     */
    async checkLinkedEditsOnce(): Promise<string[]> {
        const updated: string[] = [];
        for (const [filePath, entry] of this.linkedEdits) {
            let st: fs.Stats;
            try {
                st = fs.statSync(filePath);
            } catch { continue; } // unmounted / deleted — keep quiet, keep watching

            const changed = st.mtimeMs !== entry.mtimeMs || st.size !== entry.size;
            if (!changed) { entry.pending = undefined; continue; }

            if (entry.pending && entry.pending.mtimeMs === st.mtimeMs && entry.pending.size === st.size) {
                // Stable across two ticks → the save is finished.
                entry.mtimeMs = st.mtimeMs;
                entry.size = st.size;
                entry.pending = undefined;
                try {
                    const t = await thumbnailService.generateThumbnails(filePath, { forceRegenerate: true });
                    if (t) {
                        catalogDb.updatePhoto(entry.photoId, {
                            thumbnail_path: t.thumbnailPath,
                            preview_path: t.previewPath,
                            blur_hash: (t as any).blurHash || null,
                            width: t.width,
                            height: t.height
                        } as any);
                        updated.push(entry.photoId);
                        console.log(`[LinkedEdit] ${path.basename(filePath)} saved in editor → catalog refreshed`);
                    }
                } catch (e) {
                    console.error('[LinkedEdit] thumbnail refresh failed:', e);
                }
            } else {
                entry.pending = { mtimeMs: st.mtimeMs, size: st.size };
            }
        }
        return updated;
    }

    // Watch for changes to an edited file
    watchForChanges(
        filePath: string,
        callback: (eventType: string) => void
    ): fs.FSWatcher | null {
        try {
            return fs.watch(filePath, (eventType) => {
                callback(eventType);
            });
        } catch (error) {
            console.error('[ExternalEditorService] Failed to watch file:', error);
            return null;
        }
    }
}

export const externalEditorService = new ExternalEditorService();
export default externalEditorService;
