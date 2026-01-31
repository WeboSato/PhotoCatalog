import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
