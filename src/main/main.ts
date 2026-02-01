// Suppress EPIPE errors FIRST before any other imports
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err: Error & { code?: string }) => {
    if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return;
    console.error('Uncaught Exception:', err);
});

import { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

import catalogDb from '../database/Database';
import thumbnailService from '../services/ThumbnailService';
import importService, { ImportOptions, ImportProgress } from '../services/ImportService';
import externalEditorService from '../services/ExternalEditorService';
import metadataService from '../services/MetadataService';
import folderService from '../services/FolderService';
import lightroomImportService from '../services/LightroomImportService';
import { XmpService } from './services/XmpService';
import settingsService from './services/SettingsService';
import catalogManagerService from './services/CatalogManagerService';
import { updateService } from './services/UpdateService';
import crypto from 'crypto';

let mainWindow: BrowserWindow | null = null;

// Recover thumbnails that exist on disk but not in DB (crash recovery)
async function recoverExistingThumbnails(photos: any[]): Promise<number> {
    const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails', 'thumbs');
    let recovered = 0;

    for (const photo of photos) {
        if (photo.thumbnail_path) continue; // Already has thumbnail

        // Generate expected thumbnail path based on file hash
        const hash = crypto.createHash('md5').update(photo.file_path).digest('hex');
        const subDir1 = hash.substring(0, 2);
        const subDir2 = hash.substring(2, 4);
        const expectedPath = path.join(thumbnailDir, subDir1, subDir2, `${hash}.webp`);

        // Check if file exists on disk
        if (fs.existsSync(expectedPath)) {
            // Update DB with existing thumbnail
            catalogDb.updatePhoto(photo.id, {
                thumbnail_path: expectedPath,
                indexed: true
            });
            recovered++;
        }
    }

    return recovered;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
    // Get screen dimensions to start maximized
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#1a1a1a',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true
        },
        show: false
    });

    mainWindow.once('ready-to-show', () => {
        // Maximize the window on startup
        mainWindow?.maximize();
        mainWindow?.show();
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load from the app resources
        const indexPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
        mainWindow.loadFile(indexPath);
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize update service
    updateService.setMainWindow(mainWindow);

    // Check for updates silently on startup (after 5 seconds)
    setTimeout(() => {
        updateService.checkForUpdates(true);
    }, 5000);

    createMenu();
}

function createMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'PhotoCatalog',
            submenu: [
                { role: 'about' },
                {
                    label: 'Check for Updates...',
                    click: () => updateService.checkForUpdates(false)
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Catalog...',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => mainWindow?.webContents.send('menu:new-catalog')
                },
                {
                    label: 'Open Catalog...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => mainWindow?.webContents.send('menu:open-catalog')
                },
                { type: 'separator' },
                {
                    label: 'Import Photos...',
                    accelerator: 'CmdOrCtrl+I',
                    click: () => mainWindow?.webContents.send('menu:import')
                },
                {
                    label: 'Import Folder...',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => mainWindow?.webContents.send('menu:import-folder')
                },
                { type: 'separator' },
                {
                    label: 'Export Selected...',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => mainWindow?.webContents.send('menu:export')
                },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Edit in Affinity Photo',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => mainWindow?.webContents.send('menu:edit-external')
                }
            ]
        },
        {
            label: 'Photo',
            submenu: [
                {
                    label: 'Set Rating',
                    submenu: [
                        { label: 'No Rating', accelerator: '0', click: () => mainWindow?.webContents.send('photo:rating', 0) },
                        { label: '1 Star', accelerator: '1', click: () => mainWindow?.webContents.send('photo:rating', 1) },
                        { label: '2 Stars', accelerator: '2', click: () => mainWindow?.webContents.send('photo:rating', 2) },
                        { label: '3 Stars', accelerator: '3', click: () => mainWindow?.webContents.send('photo:rating', 3) },
                        { label: '4 Stars', accelerator: '4', click: () => mainWindow?.webContents.send('photo:rating', 4) },
                        { label: '5 Stars', accelerator: '5', click: () => mainWindow?.webContents.send('photo:rating', 5) }
                    ]
                },
                {
                    label: 'Set Flag',
                    submenu: [
                        { label: 'Picked', accelerator: 'P', click: () => mainWindow?.webContents.send('photo:flag', 'picked') },
                        { label: 'Unflagged', accelerator: 'U', click: () => mainWindow?.webContents.send('photo:flag', 'none') },
                        { label: 'Rejected', accelerator: 'X', click: () => mainWindow?.webContents.send('photo:flag', 'rejected') }
                    ]
                },
                {
                    label: 'Set Color Label',
                    submenu: [
                        { label: 'None', accelerator: '6', click: () => mainWindow?.webContents.send('photo:color', 'none') },
                        { label: 'Red', accelerator: '7', click: () => mainWindow?.webContents.send('photo:color', 'red') },
                        { label: 'Yellow', accelerator: '8', click: () => mainWindow?.webContents.send('photo:color', 'yellow') },
                        { label: 'Green', accelerator: '9', click: () => mainWindow?.webContents.send('photo:color', 'green') },
                        { label: 'Blue', click: () => mainWindow?.webContents.send('photo:color', 'blue') },
                        { label: 'Purple', click: () => mainWindow?.webContents.send('photo:color', 'purple') }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Delete Photo',
                    accelerator: 'Delete',
                    click: () => mainWindow?.webContents.send('photo:delete')
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Grid View',
                    accelerator: 'G',
                    click: () => mainWindow?.webContents.send('view:mode', 'grid')
                },
                {
                    label: 'Loupe View',
                    accelerator: 'E',
                    click: () => mainWindow?.webContents.send('view:mode', 'loupe')
                },
                {
                    label: 'Rating',
                    accelerator: 'N',
                    click: () => mainWindow?.webContents.send('view:mode', 'survey')
                },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' }
            ]
        },
        {
            label: 'Info',
            submenu: [
                {
                    label: 'Catalog',
                    click: () => {
                        const catalogPath = settingsService.get('catalogPath') || 'Not defined';
                        shell.showItemInFolder(catalogPath);
                    }
                },
                {
                    label: 'Images',
                    click: () => {
                        const catalogPath = settingsService.get('catalogPath') || '';
                        const imagesPath = path.join(catalogPath, 'Images');
                        if (fs.existsSync(imagesPath)) {
                            shell.showItemInFolder(imagesPath);
                        } else {
                            shell.showItemInFolder(catalogPath);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Copy Paths',
                    click: () => {
                        const { clipboard } = require('electron');
                        const catalogPath = settingsService.get('catalogPath') || 'Not defined';
                        const paths = `Catalog: ${catalogPath}
Images: ${path.join(catalogPath, 'Images')}`;
                        clipboard.writeText(paths);
                        dialog.showMessageBox(mainWindow!, {
                            type: 'info',
                            title: 'Paths Copied',
                            message: 'Paths have been copied to clipboard.',
                            detail: paths
                        });
                    }
                }
            ]
        },
        {
            label: 'Language',
            submenu: [
                {
                    label: 'English',
                    type: 'radio',
                    checked: true,
                    click: () => mainWindow?.webContents.send('language:change', 'en')
                },
                {
                    label: 'Français',
                    type: 'radio',
                    click: () => mainWindow?.webContents.send('language:change', 'fr')
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// Register custom protocol for local images and models
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-image',
        privileges: {
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true
        }
    },
    {
        scheme: 'local-model',
        privileges: {
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true
        }
    }
]);

// Track known volumes to detect new ones
let knownVolumes = new Set<string>();
let volumeWatcher: fs.FSWatcher | null = null;

// Check if a volume looks like a camera SD card
function isCameraCard(volumePath: string): { isCamera: boolean; dcimPath?: string; photoCount?: number } {
    const dcimPath = path.join(volumePath, 'DCIM');
    if (!fs.existsSync(dcimPath)) {
        return { isCamera: false };
    }

    // Count photos in DCIM
    let photoCount = 0;
    const photoExtensions = ['.jpg', '.jpeg', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.rw2', '.orf'];

    const countPhotos = (dir: string) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    countPhotos(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (photoExtensions.includes(ext)) {
                        photoCount++;
                    }
                }
            }
        } catch (e) {
            // Ignore permission errors
        }
    };

    countPhotos(dcimPath);
    return { isCamera: true, dcimPath, photoCount };
}

// Get current volumes
function getCurrentVolumes(): string[] {
    const volumesDir = '/Volumes';
    try {
        return fs.readdirSync(volumesDir)
            .map(name => path.join(volumesDir, name))
            .filter(p => {
                try {
                    return fs.statSync(p).isDirectory();
                } catch {
                    return false;
                }
            });
    } catch {
        return [];
    }
}

// Setup volume watcher for SD card detection
function setupVolumeWatcher() {
    // Initialize known volumes
    knownVolumes = new Set(getCurrentVolumes());

    // Watch /Volumes directory for changes
    try {
        volumeWatcher = fs.watch('/Volumes', (eventType, filename) => {
            if (!filename) return;

            // Debounce - wait a bit for the volume to fully mount
            setTimeout(() => {
                const currentVolumes = new Set(getCurrentVolumes());

                // Find new volumes
                for (const vol of currentVolumes) {
                    if (!knownVolumes.has(vol)) {
                        // Check if it's a camera card
                        const cameraCheck = isCameraCard(vol);
                        if (cameraCheck.isCamera) {
                            // Notify renderer
                            mainWindow?.webContents.send('volume:camera-detected', {
                                volumePath: vol,
                                volumeName: path.basename(vol),
                                dcimPath: cameraCheck.dcimPath,
                                photoCount: cameraCheck.photoCount
                            });
                        }
                    }
                }

                // Update known volumes
                knownVolumes = currentVolumes;
            }, 1500); // Wait 1.5s for volume to fully mount
        });

    } catch (e) {
        console.error('[Main] Failed to setup volume watcher:', e);
    }
}

// Initialize services
app.whenReady().then(async () => {
    // Register protocol handler for local images
    protocol.handle('local-image', async (request) => {
        // Remove the protocol prefix and decode each path component
        const rawPath = request.url.replace('local-image://', '');
        const filePath = rawPath.split('/').map(part => decodeURIComponent(part)).join('/');

        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            console.error('[Protocol] File not found:', filePath.substring(0, 100));
            return new Response('File not found', { status: 404 });
        }

        // Read file directly and return with correct content-type
        try {
            const data = fs.readFileSync(filePath);
            const ext = filePath.split('.').pop()?.toLowerCase();
            const mimeTypes: Record<string, string> = {
                'webp': 'image/webp',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'tiff': 'image/tiff',
                'tif': 'image/tiff'
            };
            const contentType = mimeTypes[ext || ''] || 'application/octet-stream';

            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'max-age=3600'
                }
            });
        } catch (err) {
            console.error('[Protocol] Error reading file:', err);
            return new Response('Error reading file', { status: 500 });
        }
    });

    // Register protocol handler for AI models
    protocol.handle('local-model', async (request) => {
        // Handle both local-model:// and local-model:/ formats
        const fileName = request.url.replace('local-model://', '').replace('local-model:/', '');

        // Try multiple locations for models
        const resourcesPath = process.resourcesPath || '';
        const possiblePaths = [
            path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'renderer', 'models', fileName),
            path.join(app.getAppPath(), 'dist', 'renderer', 'models', fileName),
            path.join(app.getAppPath(), 'public', 'models', fileName),
            path.join(__dirname, '..', 'renderer', 'models', fileName),
            path.join(resourcesPath, 'models', fileName),
        ];

        let modelPath = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                modelPath = p;
                break;
            }
        }

        if (!modelPath) {
            console.error('[Protocol] Model not found:', fileName);
            return new Response('Model not found', { status: 404 });
        }

        try {
            const data = fs.readFileSync(modelPath);
            const ext = fileName.split('.').pop()?.toLowerCase();
            const contentType = ext === 'json' ? 'application/json' : 'application/octet-stream';

            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'max-age=86400'
                }
            });
        } catch (err) {
            console.error('[Protocol] Error reading model:', err);
            return new Response('Error reading model', { status: 500 });
        }
    });

    // Initialize database with path from settings
    const catalogPath = settingsService.getCatalogDbPath();
    catalogDb.initialize(catalogPath);

    // Initialize thumbnail service with path from settings
    const thumbnailBasePath = settingsService.getThumbnailBasePath();
    thumbnailService.initialize(thumbnailBasePath);

    // Initialize external editor service
    await externalEditorService.initialize();

    // Create window
    createWindow();

    // Setup Affinity file watchers after a short delay (let DB load first)
    setTimeout(() => {
        setupAffinityFileWatchers();
    }, 5000);

    // Auto-regenerate missing thumbnails in background (low priority)
    setTimeout(async () => {
        const photos = catalogDb.getAllPhotos(999999, 0);

        // First: check if thumbnails exist on disk but not in DB (crash recovery)
        const recoveredCount = await recoverExistingThumbnails(photos);

        // Re-fetch to get updated list
        const updatedPhotos = catalogDb.getAllPhotos(999999, 0);
        const missingThumbnails = updatedPhotos.filter(p => !p.thumbnail_path);

        if (missingThumbnails.length > 0) {
            const BATCH_SIZE = 3; // Process 3 at a time (lower to reduce CPU load)
            let completed = 0;

            for (let i = 0; i < missingThumbnails.length; i += BATCH_SIZE) {
                const batch = missingThumbnails.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (photo) => {
                    try {
                        const result = await thumbnailService.generateThumbnails(photo.file_path);
                        if (result) {
                            catalogDb.updatePhoto(photo.id, {
                                thumbnail_path: result.thumbnailPath,
                                preview_path: result.previewPath,
                                width: result.width || photo.width,
                                height: result.height || photo.height,
                                indexed: true
                            });
                        }
                    } catch {
                        // Silent fail for missing files
                    }
                    completed++;
                }));

                // Small delay between batches to keep UI responsive
                await new Promise(r => setTimeout(r, 50));

                // Send progress to renderer every batch
                mainWindow?.webContents.send('thumbnails:progress', {
                    current: completed,
                    total: missingThumbnails.length
                });

                // Notify renderer to refresh photos every 50 thumbnails for live update
                if (completed % 50 === 0) {
                    mainWindow?.webContents.send('photos:refresh');
                }
            }

            mainWindow?.webContents.send('thumbnails:progress', { current: 0, total: 0, done: true });
            mainWindow?.webContents.send('photos:refresh');
        }
    }, 3000);

    // Watch for SD card / external drive insertions
    setupVolumeWatcher();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        catalogDb.close();
        app.quit();
    }
});

// ===== IPC Handlers =====

// Dialog handlers
ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('dialog:openFiles', async (_, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile', 'multiSelections'],
        filters: filters || [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'bmp', 'heic', 'heif'] },
            { name: 'RAW Files', extensions: ['cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'dng', 'pef', 'raw'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return result.filePaths;
});

ipcMain.handle('dialog:saveFile', async (_, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result.filePath || null;
});

// Photo operations
ipcMain.handle('photos:getAll', (_, limit?: number, offset?: number) => {
    return catalogDb.getAllPhotos(limit, offset);
});

ipcMain.handle('photos:get', (_, id: string) => {
    return catalogDb.getPhoto(id);
});

ipcMain.handle('photos:search', (_, criteria: any, limit?: number, offset?: number) => {
    return catalogDb.searchPhotos(criteria, limit, offset);
});

ipcMain.handle('photos:getCount', () => {
    return catalogDb.getPhotoCount();
});

ipcMain.handle('photos:update', (_, id: string, updates: any) => {
    catalogDb.updatePhoto(id, updates);

    // Auto-write XMP sidecar file with updated metadata
    const photo = catalogDb.getPhoto(id);
    if (photo && photo.file_path) {
        try {
            // Get existing keywords for this photo
            const keywords = catalogDb.getPhotoKeywords(id);
            const keywordNames = keywords.map((k: any) => k.name);

            // Build XMP metadata
            const xmpMetadata: any = {};

            if (updates.rating !== undefined || photo.rating) {
                xmpMetadata.rating = updates.rating !== undefined ? updates.rating : photo.rating;
            }
            if (updates.color_label !== undefined || photo.color_label) {
                xmpMetadata.label = updates.color_label !== undefined ? updates.color_label : photo.color_label;
            }
            if (keywordNames.length > 0) {
                xmpMetadata.keywords = keywordNames;
            }
            if (updates.develop_settings || photo.develop_settings) {
                const devSettings = updates.develop_settings || photo.develop_settings;
                if (typeof devSettings === 'string') {
                    try {
                        xmpMetadata.develop = JSON.parse(devSettings);
                    } catch (e) {}
                } else {
                    xmpMetadata.develop = devSettings;
                }
            }
            if (photo.gps_latitude && photo.gps_longitude) {
                xmpMetadata.gpsLatitude = photo.gps_latitude;
                xmpMetadata.gpsLongitude = photo.gps_longitude;
            }

            XmpService.updateXmp(photo.file_path, xmpMetadata);
        } catch (error) {
            console.error('[XMP] Failed to update sidecar:', error);
        }
    }

    return true;
});

ipcMain.handle('photos:delete', (_, ids: string[], deleteFromDisk: boolean = false) => {
    if (deleteFromDisk) {
        // Get file paths before deleting from database
        for (const id of ids) {
            const photo = catalogDb.getPhoto(id);
            if (photo && photo.file_path) {
                try {
                    const fs = require('fs');
                    if (fs.existsSync(photo.file_path)) {
                        fs.unlinkSync(photo.file_path);
                    }
                    // Also delete thumbnail and preview if they exist
                    if (photo.thumbnail_path && fs.existsSync(photo.thumbnail_path)) {
                        fs.unlinkSync(photo.thumbnail_path);
                    }
                    if (photo.preview_path && fs.existsSync(photo.preview_path)) {
                        fs.unlinkSync(photo.preview_path);
                    }
                } catch (error) {
                    console.error(`[Delete] Failed to delete file ${photo.file_path}:`, error);
                }
            }
        }
    }
    catalogDb.deletePhotos(ids);
    return true;
});

ipcMain.handle('photos:bulkUpdateRating', (_, ids: string[], rating: number) => {
    catalogDb.bulkUpdateRating(ids, rating);
    return true;
});

ipcMain.handle('photos:bulkUpdateFlag', (_, ids: string[], flag: 'none' | 'picked' | 'rejected') => {
    catalogDb.bulkUpdateFlag(ids, flag);
    return true;
});

ipcMain.handle('photos:bulkUpdateColorLabel', (_, ids: string[], colorLabel: string) => {
    catalogDb.bulkUpdateColorLabel(ids, colorLabel as any);
    return true;
});

// Get Affinity photos grouped by date
ipcMain.handle('photos:getAffinityByDate', () => {
    const db = catalogDb.getDb();
    const photos = db.prepare(`
        SELECT id, file_name, date_taken, edit_copy_path, updated_at
        FROM photos
        WHERE edit_copy_path IS NOT NULL
        AND (LOWER(edit_copy_path) LIKE '%.afphoto' OR LOWER(edit_copy_path) LIKE '%.af')
        ORDER BY COALESCE(updated_at, date_taken) DESC
    `).all() as any[];

    // Group by year, month, day
    const grouped: Record<string, Record<string, Record<string, any[]>>> = {};

    for (const photo of photos) {
        const date = new Date(photo.updated_at || photo.date_taken || Date.now());
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = {};
        if (!grouped[year][month][day]) grouped[year][month][day] = [];

        grouped[year][month][day].push(photo);
    }

    return { grouped, total: photos.length };
});

// Rotation - updates orientation in database (EXIF orientation values 1-8)
// Clockwise: 1->6->3->8->1, Counter-clockwise: 1->8->3->6->1
ipcMain.handle('photos:rotate', (_, ids: string[], direction: 'cw' | 'ccw') => {
    const db = catalogDb.getDb();
    const rotationMap: Record<string, Record<number, number>> = {
        cw:  { 1: 6, 6: 3, 3: 8, 8: 1, 2: 5, 5: 4, 4: 7, 7: 2 },
        ccw: { 1: 8, 8: 3, 3: 6, 6: 1, 2: 7, 7: 4, 4: 5, 5: 2 }
    };

    for (const id of ids) {
        const photo = db.prepare('SELECT orientation FROM photos WHERE id = ?').get(id) as { orientation: number } | undefined;
        const currentOrientation = photo?.orientation || 1;
        const newOrientation = rotationMap[direction][currentOrientation] || currentOrientation;
        db.prepare('UPDATE photos SET orientation = ? WHERE id = ?').run(newOrientation, id);
    }

    // Notify renderer to refresh
    if (mainWindow) {
        mainWindow.webContents.send('photos:refresh');
    }

    return true;
});

// Collection operations
ipcMain.handle('collections:getAll', () => {
    return catalogDb.getCollections();
});

ipcMain.handle('collections:create', (_, collection: any) => {
    return catalogDb.createCollection(collection);
});

ipcMain.handle('collections:update', (_, id: string, updates: any) => {
    catalogDb.updateCollection(id, updates);
    return true;
});

ipcMain.handle('collections:delete', (_, id: string) => {
    catalogDb.deleteCollection(id);
    return true;
});

ipcMain.handle('collections:getPhotos', (_, collectionId: string) => {
    return catalogDb.getPhotosByCollection(collectionId);
});

ipcMain.handle('collections:addPhotos', (_, collectionId: string, photoIds: string[]) => {
    catalogDb.addPhotosToCollection(collectionId, photoIds);
    return true;
});

ipcMain.handle('collections:removePhotos', (_, collectionId: string, photoIds: string[]) => {
    catalogDb.removePhotosFromCollection(collectionId, photoIds);
    return true;
});

// Keyword operations
ipcMain.handle('keywords:getAll', () => {
    return catalogDb.getKeywords();
});

ipcMain.handle('keywords:create', (_, keyword: any) => {
    return catalogDb.createKeyword(keyword);
});

ipcMain.handle('keywords:getForPhoto', (_, photoId: string) => {
    return catalogDb.getPhotoKeywords(photoId);
});

ipcMain.handle('keywords:addToPhoto', (_, photoId: string, keywordIds: string[]) => {
    catalogDb.addKeywordsToPhoto(photoId, keywordIds);
    return true;
});

ipcMain.handle('keywords:removeFromPhoto', (_, photoId: string, keywordIds: string[]) => {
    catalogDb.removeKeywordsFromPhoto(photoId, keywordIds);
    return true;
});

// Folder operations
ipcMain.handle('folders:getAll', () => {
    return catalogDb.getFolders();
});

ipcMain.handle('folders:getHierarchy', () => {
    return folderService.getFolderHierarchy();
});

ipcMain.handle('folders:getGroupedByYear', () => {
    return folderService.getFoldersGroupedByYear();
});

ipcMain.handle('folders:getPhotos', (_, folderPath: string) => {
    return folderService.getPhotosInFolderRecursive(folderPath);
});

ipcMain.handle('folders:scanAndImport', async (_, rootPath: string) => {
    await folderService.scanAndImportFolderStructure(rootPath);
    return true;
});

ipcMain.handle('folders:remove', (_, folderId: string) => {
    folderService.removeFolder(folderId);
    return true;
});

ipcMain.handle('folders:rebuildHierarchy', (_, rootPath?: string) => {
    return catalogDb.rebuildFolderHierarchy(rootPath);
});

ipcMain.handle('folders:getChildren', (_, parentId: string | null) => {
    return catalogDb.getChildFolders(parentId);
});

// Delete folder (with optional disk deletion)
ipcMain.handle('folders:delete', async (_, folderPath: string, deleteFromDisk: boolean) => {
    // Get all photos in this folder recursively
    const photos = folderService.getPhotosInFolderRecursive(folderPath);

    // Delete photos from database (and optionally disk)
    for (const photo of photos) {
        if (deleteFromDisk) {
            try {
                if (fs.existsSync(photo.file_path)) {
                    fs.unlinkSync(photo.file_path);
                }
                // Also delete thumbnail if exists
                if (photo.thumbnail_path && fs.existsSync(photo.thumbnail_path)) {
                    fs.unlinkSync(photo.thumbnail_path);
                }
            } catch (e) {
                console.warn('[Main] Failed to delete file:', photo.file_path, e);
            }
        }
        catalogDb.deletePhoto(photo.id);
    }

    // Remove folder from database
    const folder = catalogDb.getFolderByPath(folderPath);
    if (folder) {
        catalogDb.deleteFolder(folder.id);
    }

    // If deleting from disk, also delete the folder itself (if empty)
    if (deleteFromDisk && fs.existsSync(folderPath)) {
        try {
            // Delete recursively
            fs.rmSync(folderPath, { recursive: true, force: true });
        } catch (e) {
            console.warn('[Main] Failed to delete folder from disk:', folderPath, e);
        }
    }

    return true;
});

// Move folder to another location
ipcMain.handle('folders:move', async (_, sourcePath: string, targetParentPath: string) => {
    const folderName = path.basename(sourcePath);
    const newPath = path.join(targetParentPath, folderName);

    // Check if target already exists
    if (fs.existsSync(newPath)) {
        throw new Error(`A folder "${folderName}" already exists at this destination`);
    }

    // Move the folder on disk
    try {
        fs.renameSync(sourcePath, newPath);
    } catch (e) {
        console.error('[Main] Failed to move folder:', e);
        throw new Error('Unable to move folder');
    }

    // Find the target parent folder in database
    const targetParentFolder = catalogDb.getFolderByPath(targetParentPath);
    const targetParentId = targetParentFolder?.id || undefined;

    // Find the source folder
    const sourceFolder = catalogDb.getFolderByPath(sourcePath);

    // Update all photo paths in database
    const photos = catalogDb.getAllPhotos();
    let photosUpdated = 0;
    for (const photo of photos) {
        if (photo.file_path.startsWith(sourcePath + '/') || photo.file_path === sourcePath) {
            const relativePath = photo.file_path.substring(sourcePath.length);
            const newFilePath = newPath + relativePath;
            catalogDb.updatePhoto(photo.id, { file_path: newFilePath });
            photosUpdated++;
        }
    }

    // Update folder paths and parent_id in database
    const folders = catalogDb.getAllFolders();
    for (const folder of folders) {
        if (folder.path === sourcePath) {
            // This is the moved folder - update path AND parent_id
            catalogDb.updateFolder(folder.id, {
                path: newPath,
                parent_id: targetParentId
            });
        } else if (folder.path.startsWith(sourcePath + '/')) {
            // Subfolder - just update path
            const relativePath = folder.path.substring(sourcePath.length);
            const newFolderPath = newPath + relativePath;
            catalogDb.updateFolder(folder.id, { path: newFolderPath });
        }
    }

    return { newPath, photosUpdated };
});

// Import operations
ipcMain.handle('import:fromPath', async (event, options: ImportOptions) => {
    return importService.importFromPath(options, (progress: ImportProgress) => {
        mainWindow?.webContents.send('import:progress', progress);
    });
});

ipcMain.handle('import:files', async (event, filePaths: string[], options: any) => {
    return importService.importFiles(filePaths, options, (progress: ImportProgress) => {
        mainWindow?.webContents.send('import:progress', progress);
    });
});

ipcMain.handle('import:reindex', async (_, photoId: string) => {
    return importService.reindexPhoto(photoId);
});

ipcMain.handle('import:reindexAll', async (event) => {
    return importService.reindexAllPhotos((current, total) => {
        event.sender.send('import:progress', {
            phase: 'thumbnails',
            current,
            total,
            currentFile: `Regenerating thumbnails ${current}/${total}`
        });
    });
});

// Metadata operations
ipcMain.handle('metadata:extract', async (_, filePath: string) => {
    return metadataService.extractMetadata(filePath);
});

// External editor operations
ipcMain.handle('editor:getAvailable', () => {
    return externalEditorService.getAvailableEditors();
});

// Track active file/folder watchers for external edits
const editFileWatchers = new Map<string, fs.FSWatcher>();
const editFolderWatchers = new Map<string, fs.FSWatcher>();
const globalFolderWatchers = new Map<string, fs.FSWatcher>();

// Affinity Photo file extensions
const AFFINITY_EXTENSIONS = ['.afphoto', '.af'];

// Common folders where Affinity might save files
const getAffinityWatchFolders = (): string[] => {
    const homeDir = require('os').homedir();
    return [
        path.join(homeDir, 'Documents'),
        path.join(homeDir, 'Desktop'),
        path.join(homeDir, 'Downloads'),
        path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), // iCloud
    ].filter(p => fs.existsSync(p));
};

// Track which photo is being edited (photoId -> baseName mapping)
const activeEditSessions = new Map<string, { baseName: string; originalFolder: string; photoId: string }>();

// Watch common folders for Affinity files matching active edit sessions
const setupGlobalWatchers = () => {
    const watchFolders = getAffinityWatchFolders();

    for (const folder of watchFolders) {
        if (globalFolderWatchers.has(folder)) continue;

        try {
            const watcher = fs.watch(folder, (eventType, filename) => {
                if (!filename) return;

                const ext = path.extname(filename).toLowerCase();
                if (!AFFINITY_EXTENSIONS.includes(ext)) return;

                // Check if this matches any active edit session
                for (const [photoId, session] of activeEditSessions) {
                    if (filename.startsWith(session.baseName)) {
                        const filePath = path.join(folder, filename);

                        // Debounce and process
                        setTimeout(async () => {
                            if (!fs.existsSync(filePath)) return;

                            try {
                                const db = catalogDb.getDb();
                                const thumbResult = await thumbnailService.generateThumbnails(filePath, { forceRegenerate: true });

                                if (thumbResult && thumbResult.thumbnailPath) {
                                    db.prepare(`
                                        UPDATE photos SET
                                            edit_copy_path = ?,
                                            thumbnail_path = ?,
                                            preview_path = ?,
                                            file_type = 'AFPHOTO',
                                            is_raw = 0,
                                            updated_at = CURRENT_TIMESTAMP
                                        WHERE id = ?
                                    `).run(filePath, thumbResult.thumbnailPath, thumbResult.previewPath || null, photoId);

                                    if (mainWindow) {
                                        mainWindow.webContents.send('photos:refresh');
                                        mainWindow.webContents.send('edit:saved', { photoId, editCopyPath: filePath });
                                    }
                                }
                            } catch (error) {
                                console.error('[GlobalWatcher] Error processing file:', error);
                            }
                        }, 2000);

                        break;
                    }
                }
            });

            globalFolderWatchers.set(folder, watcher);
        } catch (error) {
            console.error(`[GlobalWatcher] Failed to watch ${folder}:`, error);
        }
    }
};

// Watch all Affinity files for automatic updates using polling (works with external drives)
const affinityFileModTimes = new Map<string, number>(); // editPath -> last modification time
let affinityPollingInterval: NodeJS.Timeout | null = null;

const setupAffinityFileWatchers = () => {
    try {
        // Get all photos with Affinity edit copies
        const photos = catalogDb.getAllPhotos(999999, 0);
        const affinityPhotos = photos.filter(p =>
            p.edit_copy_path &&
            (p.edit_copy_path.toLowerCase().endsWith('.afphoto') ||
             p.edit_copy_path.toLowerCase().endsWith('.af'))
        );

        if (affinityPhotos.length === 0) {
            return;
        }

        // Initialize modification times
        for (const photo of affinityPhotos) {
            try {
                if (fs.existsSync(photo.edit_copy_path!)) {
                    const stats = fs.statSync(photo.edit_copy_path!);
                    affinityFileModTimes.set(photo.edit_copy_path!, stats.mtimeMs);
                }
            } catch (e) {
                // Ignore errors for files we can't access
            }
        }

        // Clear existing interval if any
        if (affinityPollingInterval) {
            clearInterval(affinityPollingInterval);
        }

        // Poll every 5 seconds for changes
        affinityPollingInterval = setInterval(async () => {
            for (const photo of affinityPhotos) {
                const editPath = photo.edit_copy_path!;
                try {
                    if (!fs.existsSync(editPath)) continue;

                    const stats = fs.statSync(editPath);
                    const lastModTime = affinityFileModTimes.get(editPath) || 0;

                    if (stats.mtimeMs > lastModTime) {
                        affinityFileModTimes.set(editPath, stats.mtimeMs);

                        // Skip if this is the first time we're seeing it
                        if (lastModTime === 0) continue;

                        try {
                            // Regenerate thumbnail
                            const thumbResult = await thumbnailService.generateThumbnails(editPath, { forceRegenerate: true });

                            if (thumbResult && thumbResult.thumbnailPath) {
                                const db = catalogDb.getDb();
                                db.prepare(`
                                    UPDATE photos SET
                                        thumbnail_path = ?,
                                        preview_path = ?,
                                        updated_at = CURRENT_TIMESTAMP
                                    WHERE id = ?
                                `).run(thumbResult.thumbnailPath, thumbResult.previewPath || null, photo.id);

                                // Notify renderer to refresh
                                if (mainWindow) {
                                    mainWindow.webContents.send('photos:refresh');
                                    mainWindow.webContents.send('affinity:updated', {
                                        photoId: photo.id,
                                        editCopyPath: editPath
                                    });
                                }
                            }
                        } catch (error) {
                            console.error(`[AffinityWatcher] Error updating thumbnail:`, error);
                        }
                    }
                } catch (e) {
                    // Ignore errors for files we can't access
                }
            }
        }, 5000); // Check every 5 seconds
    } catch (error) {
        console.error('[AffinityWatcher] Error setting up polling:', error);
    }
};

ipcMain.handle('editor:open', async (_, photoPath: string, photoId: string, editorId?: string) => {
    const result = await externalEditorService.openInEditor(photoPath, photoId, editorId, true);

    // If we created an edit copy, update the database and watch for changes
    if (result && result.editCopyPath) {
        try {
            const db = catalogDb.getDb();
            db.prepare('UPDATE photos SET edit_copy_path = ? WHERE id = ?').run(result.editCopyPath, photoId);

            // Stop any existing watchers for this photo
            if (editFileWatchers.has(photoId)) {
                editFileWatchers.get(photoId)?.close();
                editFileWatchers.delete(photoId);
            }
            if (editFolderWatchers.has(photoId)) {
                editFolderWatchers.get(photoId)?.close();
                editFolderWatchers.delete(photoId);
            }

            const editDir = path.dirname(result.editCopyPath);
            const editBaseName = path.basename(result.editCopyPath, path.extname(result.editCopyPath));

            // Register this edit session for global watching
            activeEditSessions.set(photoId, { baseName: editBaseName, originalFolder: editDir, photoId });

            // Setup global watchers if not already done
            setupGlobalWatchers();
            let currentEditPath = result.editCopyPath;

            // Function to update catalog with new edit file
            const updateEditFile = async (newEditPath: string) => {
                try {
                    // Update edit_copy_path to the new file (e.g., .afphoto)
                    const ext = path.extname(newEditPath).toLowerCase();
                    const isAffinity = AFFINITY_EXTENSIONS.includes(ext);

                    // Regenerate thumbnail
                    const thumbResult = await thumbnailService.generateThumbnails(newEditPath, { forceRegenerate: true });

                    // Update database
                    if (thumbResult && thumbResult.thumbnailPath) {
                        db.prepare(`
                            UPDATE photos SET
                                edit_copy_path = ?,
                                thumbnail_path = ?,
                                preview_path = ?,
                                file_type = ?,
                                is_raw = 0,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(
                            newEditPath,
                            thumbResult.thumbnailPath,
                            thumbResult.previewPath || null,
                            isAffinity ? 'AFPHOTO' : ext.replace('.', '').toUpperCase(),
                            photoId
                        );
                        console.log(`[FileWatcher] Updated photo ${photoId} with Affinity file: ${newEditPath}`);
                    }

                    currentEditPath = newEditPath;

                    // Notify renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('photos:refresh');
                        mainWindow.webContents.send('edit:saved', { photoId, editCopyPath: newEditPath });
                    }
                } catch (error) {
                    console.error('[FileWatcher] Failed to update edit file:', error);
                }
            };

            // Watch the FOLDER for new Affinity files (Affinity creates new .afphoto files)
            let folderDebounce: NodeJS.Timeout | null = null;
            const folderWatcher = fs.watch(editDir, (eventType, filename) => {
                if (!filename) return;

                // Check if this is an Affinity file matching our edit basename
                const fileBaseName = path.basename(filename, path.extname(filename));
                const fileExt = path.extname(filename).toLowerCase();

                // Match files like "photo_Edit.afphoto" or "photo_Edit.af"
                if (fileBaseName === editBaseName && AFFINITY_EXTENSIONS.includes(fileExt)) {
                    if (folderDebounce) clearTimeout(folderDebounce);
                    folderDebounce = setTimeout(async () => {
                        const newFilePath = path.join(editDir, filename);
                        if (fs.existsSync(newFilePath) && newFilePath !== currentEditPath) {
                            await updateEditFile(newFilePath);
                        }
                    }, 2000); // Wait 2 seconds for file to be fully written
                }
            });
            editFolderWatchers.set(photoId, folderWatcher);

            // Also watch the original edit copy for direct changes
            let fileDebounce: NodeJS.Timeout | null = null;
            const fileWatcher = fs.watch(result.editCopyPath, (eventType) => {
                if (eventType === 'change') {
                    if (fileDebounce) clearTimeout(fileDebounce);
                    fileDebounce = setTimeout(async () => {
                        // Check if an Affinity version exists now
                        for (const ext of AFFINITY_EXTENSIONS) {
                            const affinityPath = path.join(editDir, editBaseName + ext);
                            if (fs.existsSync(affinityPath)) {
                                await updateEditFile(affinityPath);
                                return;
                            }
                        }
                        // No Affinity file, just update the original
                        await updateEditFile(currentEditPath);
                    }, 1000);
                }
            });
            editFileWatchers.set(photoId, fileWatcher);

            console.log(`[FileWatcher] Watching folder ${editDir} for Affinity files matching: ${editBaseName}.*`);

        } catch (error) {
            console.error('[Main] Failed to setup edit watchers:', error);
        }
    }

    return result;
});

ipcMain.handle('editor:openInAffinity', async (_, photoPath: string, photoId: string) => {
    return externalEditorService.openInAffinityPhoto(photoPath, photoId);
});

// Link an externally edited file to a photo
ipcMain.handle('editor:linkEditedFile', async (_, photoId: string) => {
    // Get the photo's directory to open dialog there
    const photo = catalogDb.getPhoto(photoId);
    const defaultPath = photo ? path.dirname(photo.file_path) : undefined;

    // Open a file dialog to select the edited file
    const result = await dialog.showOpenDialog({
        title: 'Select modified file (.af, .afphoto)',
        defaultPath: defaultPath,
        filters: [
            { name: 'Affinity Files', extensions: ['afphoto', 'af'] },
            { name: 'Images', extensions: ['tiff', 'tif', 'psd', 'jpg', 'jpeg', 'png'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const editedFilePath = result.filePaths[0];
    const ext = path.extname(editedFilePath).toLowerCase();
    const isAffinity = AFFINITY_EXTENSIONS.includes(ext);

    try {
        const db = catalogDb.getDb();
        let thumbnailPath = null;

        // Try to generate thumbnail from the edited file
        try {
            const thumbResult = await thumbnailService.generateThumbnails(editedFilePath, { forceRegenerate: true });
            if (thumbResult && thumbResult.thumbnailPath) {
                thumbnailPath = thumbResult.thumbnailPath;
                // Update with new thumbnail
                db.prepare(`
                    UPDATE photos SET
                        edit_copy_path = ?,
                        thumbnail_path = ?,
                        preview_path = ?,
                        file_type = ?
                    WHERE id = ?
                `).run(
                    editedFilePath,
                    thumbResult.thumbnailPath,
                    thumbResult.previewPath || null,
                    isAffinity ? 'AFPHOTO' : ext.replace('.', '').toUpperCase(),
                    photoId
                );
            }
        } catch (thumbError) {
            console.warn('[Main] Could not generate thumbnail from edited file:', thumbError);
            // Just update the edit_copy_path without thumbnail
            db.prepare('UPDATE photos SET edit_copy_path = ? WHERE id = ?').run(editedFilePath, photoId);
        }

        console.log(`[Main] Linked edited file for photo ${photoId}: ${editedFilePath}`);

        // Notify renderer
        mainWindow?.webContents.send('photos:refresh');
        mainWindow?.webContents.send('edit:saved', { photoId, editCopyPath: editedFilePath });

        return { editCopyPath: editedFilePath, thumbnailPath };
    } catch (error) {
        console.error('[Main] Failed to link edited file:', error);
        throw error;
    }
});

// Statistics
ipcMain.handle('stats:get', () => {
    return catalogDb.getStatistics();
});

// Thumbnail operations
ipcMain.handle('thumbnails:getPath', (_, sourcePath: string) => {
    return thumbnailService.getThumbnailPath(sourcePath);
});

ipcMain.handle('thumbnails:getPreviewPath', (_, sourcePath: string) => {
    return thumbnailService.getPreviewPath(sourcePath);
});

ipcMain.handle('thumbnails:getCacheSize', () => {
    return thumbnailService.getCacheSize();
});

ipcMain.handle('thumbnails:clearCache', async () => {
    await thumbnailService.clearAllThumbnails();
    return true;
});

// File operations
ipcMain.handle('file:showInFolder', (_, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
});

ipcMain.handle('file:openExternal', async (_, filePath: string) => {
    await shell.openPath(filePath);
    return true;
});

// Lightroom import operations
ipcMain.handle('lightroom:findCatalogs', () => {
    return lightroomImportService.findAllCatalogs();
});

ipcMain.handle('lightroom:findBestCatalog', () => {
    return lightroomImportService.findBestCatalog();
});

ipcMain.handle('lightroom:selectCatalog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
            { name: 'Lightroom Catalog', extensions: ['lrcat'] }
        ]
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('lightroom:syncMetadata', async (event, catalogPath: string) => {
    return lightroomImportService.syncMetadata(catalogPath, (current, total) => {
        event.sender.send('lightroom:progress', { current, total, phase: 'syncing' });
    });
});

ipcMain.handle('lightroom:import', async (event, catalogPath: string, options: any) => {
    return lightroomImportService.importFromCatalog(catalogPath, options, (current, total, status) => {
        event.sender.send('lightroom:progress', { current, total, status, phase: 'importing' });
    });
});

ipcMain.handle('lightroom:importAll', async (event, catalogPath: string) => {
    return lightroomImportService.importAllFromLightroom(catalogPath, (current, total, status) => {
        event.sender.send('lightroom:progress', { current, total, status, phase: 'importing' });
    });
});

// People/Face operations
ipcMain.handle('people:getAll', () => {
    return catalogDb.getPeople();
});

ipcMain.handle('people:create', (_, name: string) => {
    return catalogDb.createPerson(name);
});

ipcMain.handle('people:update', (_, id: string, name: string) => {
    catalogDb.updatePerson(id, name);
    return true;
});

ipcMain.handle('people:delete', (_, id: string) => {
    catalogDb.deletePerson(id);
    return true;
});

ipcMain.handle('people:getPhotos', (_, personId: string) => {
    return catalogDb.getPhotosByPerson(personId);
});

ipcMain.handle('faces:getForPhoto', (_, photoId: string) => {
    return catalogDb.getFacesForPhoto(photoId);
});

ipcMain.handle('faces:getUnidentified', () => {
    return catalogDb.getUnidentifiedFaces();
});

ipcMain.handle('faces:assignToPerson', (_, faceId: string, personId: string) => {
    catalogDb.assignFaceToPerson(faceId, personId, true);
    return true;
});

ipcMain.handle('faces:insert', (_, face: any) => {
    catalogDb.insertFace(face);
    return true;
});

ipcMain.handle('faces:delete', (_, faceId: string) => {
    catalogDb.deleteFace(faceId);
    return true;
});

// Face clustering - groups similar unassigned faces into person entries
ipcMain.handle('faces:cluster', () => {
    console.log('[Clustering] Starting face clustering...');

    // Get all unassigned faces with descriptors
    const faces = catalogDb.getUnassignedFacesWithDescriptors();
    console.log(`[Clustering] Found ${faces.length} unassigned faces with descriptors`);

    if (faces.length === 0) {
        return { clustersCreated: 0, facesAssigned: 0 };
    }

    // Parse descriptors from JSON
    const facesWithParsedDescriptors = faces.map(f => ({
        ...f,
        parsedDescriptor: JSON.parse(f.descriptor) as number[]
    }));

    // Euclidean distance function
    const euclideanDistance = (a: number[], b: number[]): number => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += (a[i] - b[i]) ** 2;
        }
        return Math.sqrt(sum);
    };

    // Clustering with threshold (0.6 is standard for face-api.js)
    const THRESHOLD = 0.6;
    const clusters: { faceIds: string[]; representativeIdx: number }[] = [];
    const assigned = new Set<string>();

    for (let i = 0; i < facesWithParsedDescriptors.length; i++) {
        const face = facesWithParsedDescriptors[i];
        if (assigned.has(face.id)) continue;

        // Start a new cluster
        const cluster: string[] = [face.id];
        assigned.add(face.id);

        // Find all similar faces
        for (let j = i + 1; j < facesWithParsedDescriptors.length; j++) {
            const otherFace = facesWithParsedDescriptors[j];
            if (assigned.has(otherFace.id)) continue;

            const distance = euclideanDistance(face.parsedDescriptor, otherFace.parsedDescriptor);
            if (distance < THRESHOLD) {
                cluster.push(otherFace.id);
                assigned.add(otherFace.id);
            }
        }

        clusters.push({ faceIds: cluster, representativeIdx: i });
    }

    console.log(`[Clustering] Created ${clusters.length} clusters`);

    // Create person entries for each cluster and assign faces
    let facesAssigned = 0;
    for (let idx = 0; idx < clusters.length; idx++) {
        const cluster = clusters[idx];

        // Create a new person with a generic name
        const personId = catalogDb.createPerson(`Person ${idx + 1}`);

        // Assign all faces in the cluster to this person
        catalogDb.bulkAssignFacesToPerson(cluster.faceIds, personId);

        // Set the first face (highest confidence) as the thumbnail
        catalogDb.updatePersonThumbnail(personId, cluster.faceIds[0]);

        facesAssigned += cluster.faceIds.length;
    }

    console.log(`[Clustering] Complete: ${clusters.length} people created, ${facesAssigned} faces assigned`);

    return { clustersCreated: clusters.length, facesAssigned };
});

// Get face statistics
ipcMain.handle('faces:getStats', () => {
    return {
        total: catalogDb.getFaceCount(),
        unassigned: catalogDb.getUnassignedFaceCount()
    };
});

// Clear all faces (for re-scanning)
ipcMain.handle('faces:clearAll', () => {
    catalogDb.clearAllFaces();
    return true;
});

// Get face with photo info
ipcMain.handle('faces:getWithPhoto', (_, faceId: string) => {
    return catalogDb.getFaceWithPhoto(faceId);
});

// Duplicate detection
ipcMain.handle('duplicates:find', () => {
    return catalogDb.findDuplicatesByHash();
});

// XMP Sidecar operations
ipcMain.handle('xmp:read', (_, imagePath: string) => {
    return XmpService.readXmp(imagePath);
});

ipcMain.handle('xmp:write', (_, imagePath: string, metadata: any) => {
    return XmpService.writeXmp(imagePath, metadata);
});

ipcMain.handle('xmp:update', (_, imagePath: string, updates: any) => {
    return XmpService.updateXmp(imagePath, updates);
});

ipcMain.handle('xmp:exists', (_, imagePath: string) => {
    return XmpService.xmpExists(imagePath);
});

ipcMain.handle('xmp:addKeywords', (_, imagePath: string, keywords: string[]) => {
    return XmpService.addKeywords(imagePath, keywords);
});

ipcMain.handle('xmp:removeKeywords', (_, imagePath: string, keywords: string[]) => {
    return XmpService.removeKeywords(imagePath, keywords);
});

// Bulk keyword operations with XMP
ipcMain.handle('keywords:bulkAdd', async (_, photoIds: string[], keywordNames: string[]) => {
    const results = { success: 0, failed: 0 };

    for (const photoId of photoIds) {
        try {
            const photo = catalogDb.getPhoto(photoId);
            if (!photo) continue;

            // Create keywords if they don't exist and add to photo
            for (const name of keywordNames) {
                // Find or create keyword
                const keywords = catalogDb.getKeywords();
                let keyword = keywords.find((k: any) => k.name.toLowerCase() === name.toLowerCase());
                let keywordId: string;

                if (!keyword) {
                    keywordId = catalogDb.createKeyword({ name, parent_id: undefined });
                } else {
                    keywordId = keyword.id;
                }

                // Add to photo
                catalogDb.addKeywordsToPhoto(photoId, [keywordId]);
            }

            // Update XMP sidecar
            if (photo.file_path) {
                const allKeywords = catalogDb.getPhotoKeywords(photoId);
                const allKeywordNames = allKeywords.map((k: any) => k.name);
                XmpService.updateXmp(photo.file_path, { keywords: allKeywordNames });
            }

            results.success++;
        } catch (error) {
            console.error(`[Keywords] Failed to add keywords to photo ${photoId}:`, error);
            results.failed++;
        }
    }

    return results;
});

ipcMain.handle('keywords:bulkRemove', async (_, photoIds: string[], keywordNames: string[]) => {
    const results = { success: 0, failed: 0 };

    for (const photoId of photoIds) {
        try {
            const photo = catalogDb.getPhoto(photoId);
            if (!photo) continue;

            // Find keyword IDs
            const keywords = catalogDb.getKeywords();
            const keywordIds = keywords
                .filter((k: any) => keywordNames.map(n => n.toLowerCase()).includes(k.name.toLowerCase()))
                .map((k: any) => k.id);

            if (keywordIds.length > 0) {
                catalogDb.removeKeywordsFromPhoto(photoId, keywordIds);
            }

            // Update XMP sidecar
            if (photo.file_path) {
                const remainingKeywords = catalogDb.getPhotoKeywords(photoId);
                const remainingNames = remainingKeywords.map((k: any) => k.name);
                XmpService.updateXmp(photo.file_path, { keywords: remainingNames });
            }

            results.success++;
        } catch (error) {
            console.error(`[Keywords] Failed to remove keywords from photo ${photoId}:`, error);
            results.failed++;
        }
    }

    return results;
});

// Write XMP for all selected photos (batch operation)
ipcMain.handle('xmp:batchWrite', async (_, photoIds: string[]) => {
    const results = { success: 0, failed: 0 };

    for (const photoId of photoIds) {
        try {
            const photo = catalogDb.getPhoto(photoId);
            if (!photo || !photo.file_path) continue;

            const keywords = catalogDb.getPhotoKeywords(photoId);
            const keywordNames = keywords.map((k: any) => k.name);

            const metadata: any = {
                rating: photo.rating,
                label: photo.color_label,
                keywords: keywordNames
            };

            if (photo.develop_settings) {
                try {
                    metadata.develop = typeof photo.develop_settings === 'string'
                        ? JSON.parse(photo.develop_settings)
                        : photo.develop_settings;
                } catch (e) {}
            }

            if (photo.gps_latitude && photo.gps_longitude) {
                metadata.gpsLatitude = photo.gps_latitude;
                metadata.gpsLongitude = photo.gps_longitude;
            }

            if (XmpService.writeXmp(photo.file_path, metadata)) {
                results.success++;
            } else {
                results.failed++;
            }
        } catch (error) {
            results.failed++;
        }
    }

    return results;
});

// Read XMP during import (sync metadata from existing XMP files)
ipcMain.handle('xmp:syncFromFile', async (_, photoId: string) => {
    const photo = catalogDb.getPhoto(photoId);
    if (!photo || !photo.file_path) return null;

    const xmpData = XmpService.readXmp(photo.file_path);
    if (!xmpData) return null;

    // Update database with XMP metadata
    const updates: any = {};

    if (xmpData.rating !== undefined) updates.rating = xmpData.rating;
    if (xmpData.label) updates.color_label = xmpData.label;
    if (xmpData.develop) updates.develop_settings = JSON.stringify(xmpData.develop);

    if (Object.keys(updates).length > 0) {
        catalogDb.updatePhoto(photoId, updates);
    }

    // Add keywords from XMP
    if (xmpData.keywords && xmpData.keywords.length > 0) {
        for (const name of xmpData.keywords) {
            const existingKeywords = catalogDb.getKeywords();
            let keyword = existingKeywords.find((k: any) => k.name.toLowerCase() === name.toLowerCase());
            let keywordId: string;

            if (!keyword) {
                keywordId = catalogDb.createKeyword({ name, parent_id: undefined });
            } else {
                keywordId = keyword.id;
            }

            catalogDb.addKeywordsToPhoto(photoId, [keywordId]);
        }
    }

    return xmpData;
});


// Settings operations
ipcMain.handle("settings:getAll", () => {
    return settingsService.getAll();
});

ipcMain.handle("settings:get", (event, key: string) => {
    return settingsService.get(key as any);
});

ipcMain.handle("settings:set", (event, key: string, value: any) => {
    settingsService.set(key as any, value);
    return true;
});

ipcMain.handle("settings:getCatalogInfo", () => {
    return settingsService.getCatalogInfo();
});

ipcMain.handle("settings:selectCatalogPath", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose catalog location"
    });
    return result.filePaths[0] || null;
});

ipcMain.handle("settings:migrateCatalog", async (event, newPath: string) => {
    return settingsService.migrateCatalog(newPath);
});

// Catalog Manager operations
ipcMain.handle("catalog:create", async (_, options: { name: string; location: string; copyCurrentData?: boolean }) => {
    return catalogManagerService.createNewCatalog(options);
});

ipcMain.handle("catalog:selectLocation", async () => {
    return catalogManagerService.selectCatalogLocation();
});

ipcMain.handle("catalog:open", async (_, catalogPath: string) => {
    const result = await catalogManagerService.openCatalog(catalogPath);
    if (result.success) {
        // Reinitialize database with new catalog
        const dbPath = settingsService.getCatalogDbPath();
        catalogDb.initialize(dbPath);

        // Reinitialize thumbnails
        const thumbPath = settingsService.getThumbnailBasePath();
        const isLightroomStyle = fs.existsSync(path.join(thumbPath, 'previews.db'));
        thumbnailService.initialize(thumbPath, isLightroomStyle);

        // Notify renderer to reload
        mainWindow?.webContents.send('catalog:changed');
    }
    return result;
});

ipcMain.handle("catalog:getStats", async (_, catalogPath: string) => {
    return catalogManagerService.getCatalogStats(catalogPath);
});

ipcMain.handle("catalog:selectAndOpen", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory"],
        title: "Open a catalog"
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' };
    }

    return catalogManagerService.openCatalog(result.filePaths[0]);
});
