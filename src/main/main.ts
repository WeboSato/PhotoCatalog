// Suppress EPIPE errors FIRST before any other imports
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err: Error & { code?: string }) => {
    if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return;
    console.error('Uncaught Exception:', err);
});

import { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import os from 'os';

// Built once (not per request) — used by the local-image protocol handler.
const IMAGE_MIME_TYPES: Record<string, string> = {
    'webp': 'image/webp',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'tiff': 'image/tiff',
    'tif': 'image/tiff'
};

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
import albumExportService from './services/AlbumExportService';
import albumAgentService from './services/AlbumAgentService';
import { reclusterAllFaces } from '../services/FaceClusteringService';
import crypto from 'crypto';

let mainWindow: BrowserWindow | null = null;

// Give Chromium's HTTP disk cache room for the whole thumbnail set — the default
// (~a few hundred MB) evicts a 20k-photo library long before "forever".
app.commandLine.appendSwitch('disk-cache-size', String(4 * 1024 * 1024 * 1024));

// Where each image response came from — logged at milestones so cache behaviour
// is observable in the wild (SSD mirror vs external disk vs 304 revalidation).
const imageServeStats = { mirror: 0, disk: 0, notModified: 0 };

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

// Verify the catalog's storage volume is mounted before we touch the database.
// The catalog (and images) typically live on an external SSD. If that drive is
// not connected, opening a SQLite DB at the missing path would CREATE a fresh,
// empty catalog at the dead mount point — and the startup background jobs
// (thumbnail regen, AI auto-tagging) would then run against it, effectively
// corrupting/overwriting the real library once the drive comes back.
//
// Instead we block startup with a clear "connect your drive" prompt and never
// initialize the DB on a missing path. Returns false if the user chooses to quit.
function ensureCatalogAvailable(): boolean {
    const catalogDir = settingsService.get('catalogPath');

    // No custom location => catalog lives in userData, which is always present.
    if (!catalogDir || catalogDir.length === 0) {
        return true;
    }

    const isAvailable = (): boolean => {
        try {
            return fs.existsSync(catalogDir) && fs.statSync(catalogDir).isDirectory();
        } catch {
            return false;
        }
    };

    while (!isAvailable()) {
        const driveName = catalogDir.startsWith('/Volumes/')
            ? catalogDir.split('/')[2]
            : catalogDir;

        const choice = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Catalogue indisponible',
            message: 'Le disque du catalogue n’est pas connecté',
            detail:
                `PhotoCatalog ne trouve pas son catalogue à l’emplacement :\n${catalogDir}\n\n` +
                `Branche le disque « ${driveName} » puis clique sur Réessayer.\n\n` +
                'Aucun nouveau catalogue ne sera créé : ta bibliothèque ne risque pas d’être corrompue.',
            buttons: ['Réessayer', 'Quitter'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        });

        if (choice === 1) {
            return false; // user chose to quit
        }
        // otherwise loop and re-check after they (hopefully) plugged the drive in
    }

    return true;
}

// Point the dock/taskbar at the freshly-built RGBA icon at runtime. In a packaged
// build macOS uses the bundle's .icns automatically, but this also fixes the dev
// run (electron .) where the icon would otherwise be the default Electron diamond.
function setRuntimeAppIcon(): void {
    if (process.platform !== 'darwin' || !app.dock) {
        return;
    }
    const candidates = [
        path.join(process.resourcesPath || '', 'resources', 'icon.png'),
        path.join(app.getAppPath(), 'resources', 'icon.png'),
        path.join(__dirname, '..', '..', '..', 'resources', 'icon.png')
    ];
    for (const iconPath of candidates) {
        try {
            if (fs.existsSync(iconPath)) {
                app.dock.setIcon(iconPath);
                break;
            }
        } catch {
            // ignore and try next candidate
        }
    }
}

// Get system info for bug reports
function getSystemInfo(): string {
    const electronVersion = process.versions.electron;
    const nodeVersion = process.versions.node;
    const chromeVersion = process.versions.chrome;
    const v8Version = process.versions.v8;

    return `PhotoCatalog ${app.getVersion()}
─────────────────────────────
OS: ${os.type()} ${os.release()} (${os.arch()})
Platform: ${process.platform}
CPU: ${os.cpus()[0]?.model || 'Unknown'}
Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB
─────────────────────────────
Electron: ${electronVersion}
Node.js: ${nodeVersion}
Chrome: ${chromeVersion}
V8: ${v8Version}
─────────────────────────────
Locale: ${app.getLocale()}
User Data: ${app.getPath('userData')}`;
}

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

    // NOTE: the automatic startup update check is intentionally disabled. The app
    // is distributed unsigned/un-notarized, so a downloaded DMG is blocked by
    // Gatekeeper and the "Download Update" prompt is a dead end. Updates remain
    // available on demand via the "Check for Updates…" menu item.

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
                {
                    label: 'Report Bug...',
                    click: () => {
                        const systemInfo = getSystemInfo();
                        dialog.showMessageBox(mainWindow!, {
                            type: 'info',
                            title: 'Report Bug',
                            message: 'System Information',
                            detail: systemInfo + '\n\nClick "Copy" to copy this info to your clipboard, then paste it in your bug report on GitHub.',
                            buttons: ['Copy & Open GitHub', 'Copy', 'Close'],
                            defaultId: 0
                        }).then(({ response }) => {
                            if (response === 0) {
                                clipboard.writeText(systemInfo);
                                shell.openExternal('https://github.com/WeboSato/PhotoCatalog/issues/new');
                            } else if (response === 1) {
                                clipboard.writeText(systemInfo);
                            }
                        });
                    }
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
                    // No single-key accelerators here: they fire even while typing in a
                    // text field (e.g. an album name). The renderer handles 0-9 / P/U/X /
                    // G/E/N via a guarded keydown listener instead.
                    submenu: [
                        { label: 'No Rating (0)', click: () => mainWindow?.webContents.send('photo:rating', 0) },
                        { label: '1 Star (1)', click: () => mainWindow?.webContents.send('photo:rating', 1) },
                        { label: '2 Stars (2)', click: () => mainWindow?.webContents.send('photo:rating', 2) },
                        { label: '3 Stars (3)', click: () => mainWindow?.webContents.send('photo:rating', 3) },
                        { label: '4 Stars (4)', click: () => mainWindow?.webContents.send('photo:rating', 4) },
                        { label: '5 Stars (5)', click: () => mainWindow?.webContents.send('photo:rating', 5) }
                    ]
                },
                {
                    label: 'Set Flag',
                    submenu: [
                        { label: 'Picked (P)', click: () => mainWindow?.webContents.send('photo:flag', 'picked') },
                        { label: 'Unflagged (U)', click: () => mainWindow?.webContents.send('photo:flag', 'none') },
                        { label: 'Rejected (X)', click: () => mainWindow?.webContents.send('photo:flag', 'rejected') }
                    ]
                },
                {
                    label: 'Set Color Label',
                    submenu: [
                        { label: 'None (6)', click: () => mainWindow?.webContents.send('photo:color', 'none') },
                        { label: 'Red (7)', click: () => mainWindow?.webContents.send('photo:color', 'red') },
                        { label: 'Yellow (8)', click: () => mainWindow?.webContents.send('photo:color', 'yellow') },
                        { label: 'Green (9)', click: () => mainWindow?.webContents.send('photo:color', 'green') },
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
                    label: 'Grid View (G)',
                    click: () => mainWindow?.webContents.send('view:mode', 'grid')
                },
                {
                    label: 'Loupe View (E)',
                    click: () => mainWindow?.webContents.send('view:mode', 'loupe')
                },
                {
                    label: 'Rating (N)',
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
        // Remove the protocol prefix and decode each path component.
        // A ?v=… query is a renderer-side cache-buster — strip it from the path.
        const rawPath = request.url.replace('local-image://', '').split('?')[0];
        const filePath = rawPath.split('/').map(part => decodeURIComponent(part)).join('/');

        try {
            // Thumbnails living on an external drive are mirrored to the internal
            // SSD on first serve — later reads (and every relaunch) skip the slow
            // disk entirely. The mirror stat doubles as the existence check.
            const isThumb = thumbnailService.isCachedFile(filePath);
            const mirrored = isThumb ? await thumbnailService.mirrorLookup(filePath) : null;

            // Async stat instead of existsSync — never blocks the main thread, and
            // gives us mtime/size for an ETag so we can answer revalidations cheaply.
            const stat = mirrored ?? await fs.promises.stat(filePath);
            const serveFrom = mirrored ? mirrored.path : filePath;
            if (isThumb && !mirrored) {
                // Fire-and-forget: the streamed read below warms the OS page cache,
                // so this copy costs (almost) no extra HDD I/O.
                const st = stat as { atime?: Date; mtime: Date };
                void thumbnailService.mirrorStore(filePath, { atime: st.atime ?? st.mtime, mtime: st.mtime });
            }

            const ext = filePath.split('.').pop()?.toLowerCase();
            const contentType = IMAGE_MIME_TYPES[ext || ''] || 'application/octet-stream';

            // Validator tracks size+mtime — the mirror preserves both, so the ETag
            // is identical whichever disk serves. Regenerated thumbnails (mtime
            // changes) refetch automatically; unchanged files revalidate for free.
            const etag = `"${stat.size}-${Math.round(stat.mtimeMs)}"`;
            if (request.headers.get('if-none-match') === etag) {
                imageServeStats.notModified++;
                return new Response(null, { status: 304 });
            }

            if (mirrored) imageServeStats.mirror++; else imageServeStats.disk++;
            const total = imageServeStats.mirror + imageServeStats.disk + imageServeStats.notModified;
            if (total === 25 || total === 100 || total % 1000 === 0) {
                console.log(`[local-image] ${total} served: ${imageServeStats.mirror} ssd-mirror, ${imageServeStats.disk} disk, ${imageServeStats.notModified} revalidated`);
            }

            const headers: Record<string, string> = {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                // Thumbnails are effectively immutable (regeneration bumps mtime →
                // new ETag after expiry): cache for a month. Originals stay short.
                'Cache-Control': isThumb ? 'public, max-age=2592000' : 'max-age=3600',
                'ETag': etag,
                'Last-Modified': stat.mtime.toUTCString()
            };

            // Stream off the libuv threadpool — the main process never buffers the
            // whole file, so a burst of grid <img> requests can't serialize-block it.
            const webStream = Readable.toWeb(fs.createReadStream(serveFrom)) as ReadableStream;
            return new Response(webStream, { status: 200, headers });
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return new Response('File not found', { status: 404 });
            }
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

    // Point the dock at the freshly-built RGBA icon (mainly helps the dev run).
    setRuntimeAppIcon();

    // Block startup if the catalog's drive is not mounted. This must run BEFORE
    // catalogDb.initialize(), otherwise an empty catalog would be created at the
    // missing path and the background jobs would corrupt the real library.
    if (!ensureCatalogAvailable()) {
        app.quit();
        return;
    }

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

        // Fast path: if every photo already has a thumbnail (the normal case), skip
        // the crash-recovery disk scan AND the second full re-load entirely. On a big
        // library on an external HDD those scans were needless work every launch.
        let missingThumbnails = photos.filter(p => !p.thumbnail_path);
        if (missingThumbnails.length > 0) {
            const recoveredCount = await recoverExistingThumbnails(photos);
            if (recoveredCount > 0) {
                missingThumbnails = catalogDb.getAllPhotos(999999, 0).filter(p => !p.thumbnail_path);
            }
        }

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
                                blur_hash: result.blurHash,
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

        // Background: square face crops for people-view representatives (idempotent).
        // Runs BEFORE AI tagging so the people view gets tight crops promptly rather
        // than waiting behind a potentially long tagging pass. Thumbnails already
        // exist (regenerated just above), which is all the crop source needs.
        try {
            const res = await backfillFaceCrops();
            if (res.generated > 0) console.log(`[FaceCrop] Backfilled ${res.generated} face crops`);
        } catch (e) {
            console.warn('[FaceCrop] Backfill skipped:', e);
        }

        // One fresh view of the library, shared by the two background passes below.
        const libraryNow = missingThumbnails.length > 0 ? catalogDb.getAllPhotos(999999, 0) : photos;

        // Trickle-mirror the thumbnail set to the internal SSD (no-op when the
        // cache already lives there). Throttled to a few files/sec so it never
        // competes with interactive reads; after one pass, scrolling and every
        // relaunch serve thumbnails from the SSD instead of the external drive.
        {
            const thumbPaths = libraryNow.map((p: any) => p.thumbnail_path).filter(Boolean) as string[];
            thumbnailService.warmMirror(thumbPaths).then(r => {
                if (r.copied > 0) console.log(`[ThumbMirror] warm pass done: ${r.copied} copied to SSD (${r.skipped} already there)`);
            }).catch(() => {});
        }

        // Backfill missing BlurHashes from existing thumbnails. Libraries indexed
        // before blur_hash existed have NULL everywhere, so the grid could never
        // show its blurred placeholders (spinners instead) and the agent's
        // near-dup/stage-light logic ran blind. Hashes are computed from the tiny
        // thumbnail (never the original), read through the SSD mirror when warmed,
        // and rows fill in live so placeholders appear progressively.
        {
            const needing = (libraryNow as any[]).filter(p => !p.blur_hash && p.thumbnail_path);
            if (needing.length > 0) {
                console.log(`[BlurHash] Backfilling ${needing.length} photos from thumbnails…`);
                let done = 0;
                let lastRefresh = 0;
                for (let i = 0; i < needing.length; i += 6) {
                    const batch = needing.slice(i, i + 6);
                    await Promise.all(batch.map(async p => {
                        const m = await thumbnailService.mirrorLookup(p.thumbnail_path);
                        const hash = await thumbnailService.blurHashFromFile(m ? m.path : p.thumbnail_path);
                        if (hash) {
                            catalogDb.updatePhoto(p.id, { blur_hash: hash });
                            done++;
                        }
                    }));
                    if (done - lastRefresh >= 2000) {
                        lastRefresh = done;
                        mainWindow?.webContents.send('photos:refresh');
                    }
                    await new Promise(r => setTimeout(r, 250));
                }
                mainWindow?.webContents.send('photos:refresh');
                console.log(`[BlurHash] Backfill done: ${done}/${needing.length} photos`);
            }
        }

        // Auto AI tagging for photos without keywords — OFF by default. On a large
        // library on an external HDD this scanned all photos and ran ONNX on every
        // launch, saturating the disk so the visible grid's thumbnails couldn't load.
        // Opt in via the autoTagOnStartup setting; otherwise tag on demand only.
        try {
            if (!settingsService.get('autoTagOnStartup')) {
                throw { skipped: true };
            }
            const { initializeAI, analyzeImage } = await import('./services/AITaggingService');
            const aiReady = await initializeAI();
            if (aiReady) {
                const allPhotos = catalogDb.getAllPhotos(999999, 0);
                const photosToTag = allPhotos.filter(p => {
                    if (!p.thumbnail_path && !p.file_path) return false;
                    const keywords = catalogDb.getPhotoKeywords(p.id);
                    return keywords.length === 0;
                });

                if (photosToTag.length > 0) {
                    console.log(`[AI Auto-Tag] Found ${photosToTag.length} photos without keywords, tagging...`);
                    let tagged = 0;

                    for (const photo of photosToTag) {
                        try {
                            const imagePath = photo.thumbnail_path || photo.file_path;
                            const keywords = await analyzeImage(imagePath);
                            if (keywords.length > 0) {
                                catalogDb.addKeywordsByNameToPhoto(photo.id, keywords);
                                tagged++;
                            }
                        } catch {
                            // Skip photos that fail
                        }

                        // Small delay to keep app responsive
                        if (tagged % 10 === 0) {
                            await new Promise(r => setTimeout(r, 100));
                        }

                        // Log progress every 50 photos
                        if (tagged % 50 === 0 && tagged > 0) {
                            console.log(`[AI Auto-Tag] Progress: ${tagged}/${photosToTag.length}`);
                        }
                    }

                    console.log(`[AI Auto-Tag] Complete: tagged ${tagged}/${photosToTag.length} photos`);
                    mainWindow?.webContents.send('photos:refresh');
                }
            }
        } catch (aiError) {
            console.warn('[AI Auto-Tag] Auto-tagging skipped:', aiError);
        }
    }, 3000);

    // Watch for SD card / external drive insertions
    setupVolumeWatcher();

    // Linked edit copies: re-arm the save-watchers and poll. Each Cmd+S in the
    // editor refreshes that copy's thumbnails and the grid, hands-free.
    {
        const armed = externalEditorService.loadLinkedEditsFromCatalog();
        if (armed > 0) console.log(`[LinkedEdit] watching ${armed} linked cop${armed > 1 ? 'ies' : 'y'}`);
        setInterval(async () => {
            try {
                const updated = await externalEditorService.checkLinkedEditsOnce();
                if (updated.length > 0) mainWindow?.webContents.send('photos:refresh');
            } catch { /* next tick */ }
        }, 3500);
    }

    // A card inserted BEFORE launch never fired the watcher, so no import dialog
    // ever appeared for it. Check the volumes that are already mounted too.
    setTimeout(() => {
        for (const vol of getCurrentVolumes()) {
            try {
                const cameraCheck = isCameraCard(vol);
                if (cameraCheck.isCamera && (cameraCheck.photoCount || 0) > 0) {
                    mainWindow?.webContents.send('volume:camera-detected', {
                        volumePath: vol,
                        volumeName: path.basename(vol),
                        dcimPath: cameraCheck.dcimPath,
                        photoCount: cameraCheck.photoCount
                    });
                }
            } catch { /* unreadable volume */ }
        }
    }, 6000);

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

// Copy photos to a target folder
ipcMain.handle('photos:copy', async (_, ids: string[], targetFolder: string) => {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
        const photo = catalogDb.getPhoto(id);
        if (!photo || !photo.file_path) {
            results.failed++;
            continue;
        }

        try {
            const fileName = path.basename(photo.file_path);
            let destPath = path.join(targetFolder, fileName);

            // Handle name collisions
            if (fs.existsSync(destPath)) {
                const ext = path.extname(fileName);
                const base = path.basename(fileName, ext);
                let counter = 1;
                while (fs.existsSync(destPath)) {
                    destPath = path.join(targetFolder, `${base}_${counter}${ext}`);
                    counter++;
                }
            }

            fs.copyFileSync(photo.file_path, destPath);
            results.success++;
        } catch (error: any) {
            results.failed++;
            results.errors.push(`${photo.file_name}: ${error.message}`);
        }
    }

    return results;
});

// Move photos to a target folder (updates file paths in DB)
ipcMain.handle('photos:move', async (_, ids: string[], targetFolder: string) => {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const id of ids) {
        const photo = catalogDb.getPhoto(id);
        if (!photo || !photo.file_path) {
            results.failed++;
            continue;
        }

        try {
            const fileName = path.basename(photo.file_path);
            let destPath = path.join(targetFolder, fileName);

            // Handle name collisions
            if (fs.existsSync(destPath)) {
                const ext = path.extname(fileName);
                const base = path.basename(fileName, ext);
                let counter = 1;
                while (fs.existsSync(destPath)) {
                    destPath = path.join(targetFolder, `${base}_${counter}${ext}`);
                    counter++;
                }
            }

            fs.renameSync(photo.file_path, destPath);

            // Update file path in database
            catalogDb.updatePhoto(id, { file_path: destPath } as any);
            results.success++;
        } catch (error: any) {
            results.failed++;
            results.errors.push(`${photo.file_name}: ${error.message}`);
        }
    }

    return results;
});

// Select a target folder for copy/move operations
ipcMain.handle('photos:selectTargetFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select destination folder'
    });
    return result.filePaths[0] || null;
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

// ===== Album / Photo Book operations =====
ipcMain.handle('albums:getAll', () => catalogDb.getAlbums());
ipcMain.handle('albums:create', (_, a: any) => catalogDb.createAlbum(a));
ipcMain.handle('albums:update', (_, id: string, u: any) => { catalogDb.updateAlbum(id, u); return true; });
ipcMain.handle('albums:delete', (_, id: string) => { catalogDb.deleteAlbum(id); return true; });
ipcMain.handle('albums:getPages', (_, albumId: string) => catalogDb.getAlbumPages(albumId));
ipcMain.handle('albums:savePages', (_, albumId: string, pages: any[]) => { catalogDb.saveAlbumPages(albumId, pages); return true; });
ipcMain.handle('albums:getPhotosByIds', (_, ids: string[]) => catalogDb.getPhotosByIds(ids));
ipcMain.handle('album:autoCurate', async (_, params: any) =>
    albumAgentService.build(params, p => mainWindow?.webContents.send('album:progress', p)));

ipcMain.handle('album:exportPdf', async (_, spec: any, savePath: string) =>
    albumExportService.exportPdf(spec, savePath, p => mainWindow?.webContents.send('album:progress', p)));
ipcMain.handle('album:exportSlideshow', async (_, spec: any, savePath: string) =>
    albumExportService.exportSlideshow(spec, savePath, p => mainWindow?.webContents.send('album:progress', p)));

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

// AI Keywords - add keywords by name (creates if not exists)
ipcMain.handle('keywords:addByName', (_, photoId: string, keywordNames: string[]) => {
    catalogDb.addKeywordsByNameToPhoto(photoId, keywordNames);
    return true;
});

// AI Tagging
ipcMain.handle('ai:analyze', async (_, photoId: string) => {
    const { analyzeImage } = await import('./services/AITaggingService');
    const photo = catalogDb.getPhoto(photoId);
    if (!photo) throw new Error('Photo not found');

    // Use thumbnail if available, otherwise original
    const imagePath = photo.thumbnail_path || photo.file_path;
    const keywords = await analyzeImage(imagePath);

    // Save keywords to database
    if (keywords.length > 0) {
        catalogDb.addKeywordsByNameToPhoto(photoId, keywords);
    }

    return keywords;
});

ipcMain.handle('ai:init', async () => {
    const { initializeAI } = await import('./services/AITaggingService');
    return await initializeAI();
});

ipcMain.handle('ai:isReady', async () => {
    const { isAIReady } = await import('./services/AITaggingService');
    return isAIReady();
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
    const result = await importService.importFromPath(options, (progress: ImportProgress) => {
        mainWindow?.webContents.send('import:progress', progress);
    });
    // The grid/folders should show new photos without a manual refresh.
    mainWindow?.webContents.send('photos:refresh');
    return result;
});

ipcMain.handle('import:files', async (event, filePaths: string[], options: any) => {
    const result = await importService.importFiles(filePaths, options, (progress: ImportProgress) => {
        mainWindow?.webContents.send('import:progress', progress);
    });
    mainWindow?.webContents.send('photos:refresh');
    return result;
});

// Visual card import: flat file listing (marked with what the catalog already
// has) + on-demand 320px previews cached on the internal disk.
ipcMain.handle('import:scanCard', async (_event, dirPath: string) => {
    const files = await importService.scanCardFiles(dirPath);
    const known = new Set(
        catalogDb.getAllPhotos(999999, 0).map((p: any) => `${p.file_name}|${p.file_size || 0}`)
    );
    return files.map(f => ({ ...f, alreadyImported: known.has(`${f.name}|${f.size}`) }));
});

// The library root — the folder holding the "Année XXXX" year folders — on
// the CURRENT catalog's disk. Imports default here so a new "Année 2026/date"
// lands beside the existing years instead of wherever a stale path pointed.
ipcMain.handle('import:getLibraryRoot', () => {
    try {
        // macOS stores names in decomposed Unicode (NFD): "Année" in SQL never
        // matches. Match in JS on NFC-normalized basenames instead.
        const rows = catalogDb.getDb().prepare('SELECT path FROM folders').all() as { path: string }[];
        const yearFolder = /^ann[ée]e\s+\d{4}$/i;
        const counts = new Map<string, number>();
        for (const r of rows) {
            if (!yearFolder.test(path.basename(r.path).normalize('NFC'))) continue;
            const parent = path.dirname(r.path);
            if (fs.existsSync(parent)) counts.set(parent, (counts.get(parent) || 0) + 1);
        }
        let best: string | null = null, bestN = 0;
        for (const [p, n] of counts) if (n > bestN) { best = p; bestN = n; }
        if (best) return best;
    } catch { /* fall through */ }
    const catalogDir = path.dirname(settingsService.getCatalogDbPath());
    const images = path.join(catalogDir, 'Images');
    return fs.existsSync(images) ? images : catalogDir;
});

// Free space on the volume holding a directory (walks up to an existing dir).
ipcMain.handle('fs:getFreeSpace', async (_event, dirPath: string) => {
    try {
        let p = dirPath;
        while (p && p !== '/' && !fs.existsSync(p)) p = path.dirname(p);
        const st = await (fs.promises as any).statfs(p || '/');
        return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
    } catch {
        return null;
    }
});

const cardPreviewDir = () => path.join(app.getPath('userData'), 'card-previews');
ipcMain.handle('import:cardPreview', async (_event, filePath: string) => {
    try {
        const dir = cardPreviewDir();
        fs.mkdirSync(dir, { recursive: true });
        const stat = await fs.promises.stat(filePath);
        // Orientation for RAW cards: the embedded preview has no tag, exif does.
        let orientation = 0;
        try { orientation = (await metadataService.extractMetadata(filePath))?.orientation || 0; } catch { /* best effort */ }
        const key = crypto.createHash('md5')
            .update(`${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}|o${orientation}`).digest('hex');
        const out = path.join(dir, `${key}.webp`);
        if (!fs.existsSync(out)) {
            const ok = await thumbnailService.quickPreview(filePath, out, 320, orientation);
            if (!ok) return null;
        }
        return out;
    } catch {
        return null;
    }
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
                                            blur_hash = ?,
                                            file_type = 'AFPHOTO',
                                            is_raw = 0,
                                            updated_at = CURRENT_TIMESTAMP
                                        WHERE id = ?
                                    `).run(filePath, thumbResult.thumbnailPath, thumbResult.previewPath || null, thumbResult.blurHash || null, photoId);

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
                                        blur_hash = ?,
                                        updated_at = CURRENT_TIMESTAMP
                                    WHERE id = ?
                                `).run(thumbResult.thumbnailPath, thumbResult.previewPath || null, thumbResult.blurHash || null, photo.id);

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

// Non-destructive crop: saved in develop_settings and baked into thumbnails
// only. The original file is NEVER modified; clearing restores the full frame.
ipcMain.handle('photos:applyCrop', async (_event, photoId: string, crop: { x: number; y: number; w: number; h: number } | null) => {
    const photo = catalogDb.getPhoto(photoId);
    if (!photo) return { success: false, error: 'Photo introuvable' };
    let ds: any = {};
    try { ds = photo.develop_settings ? JSON.parse(photo.develop_settings as any) : {}; } catch { /* fresh */ }
    if (crop) ds.crop = crop; else delete ds.crop;
    catalogDb.updatePhoto(photoId, { develop_settings: JSON.stringify(ds) } as any);

    const t = await thumbnailService.generateThumbnails(photo.file_path, { forceRegenerate: true, crop: crop || null });
    if (t) {
        catalogDb.updatePhoto(photoId, {
            thumbnail_path: t.thumbnailPath,
            preview_path: t.previewPath,
            blur_hash: t.blurHash || null,
            width: t.width,
            height: t.height
        } as any);
    }
    mainWindow?.webContents.send('photos:refresh');
    return { success: !!t, photo: catalogDb.getPhoto(photoId) };
});

// Full-frame preview for the crop editor (the stored preview is cropped).
ipcMain.handle('photos:getUncroppedPreview', async (_event, photoId: string) => {
    const photo = catalogDb.getPhoto(photoId);
    if (!photo) return null;
    try {
        const dir = cardPreviewDir();
        fs.mkdirSync(dir, { recursive: true });
        const stat = await fs.promises.stat(photo.file_path);
        const orientation = (photo as any).orientation || 0;
        const key = crypto.createHash('md5')
            .update(`uncrop2|${photo.file_path}|${Math.round(stat.mtimeMs)}|o${orientation}`).digest('hex');
        const out = path.join(dir, `${key}.webp`);
        if (!fs.existsSync(out)) {
            const ok = await thumbnailService.quickPreview(photo.file_path, out, 1800, orientation);
            if (!ok) return null;
        }
        return out;
    } catch {
        return null;
    }
});

// Grey-card white balance: {r,b} channel gains (green anchored at 1), stored in
// develop_settings.wb and baked into thumbnails — original file never modified.
ipcMain.handle('photos:applyWhiteBalance', async (_event, photoId: string, wb: { r: number; b: number } | null) => {
    const photo = catalogDb.getPhoto(photoId);
    if (!photo) return { success: false, error: 'Photo introuvable' };
    let ds: any = {};
    try { ds = photo.develop_settings ? JSON.parse(photo.develop_settings as any) : {}; } catch { /* fresh */ }
    if (wb) ds.wb = wb; else delete ds.wb;
    catalogDb.updatePhoto(photoId, { develop_settings: JSON.stringify(ds) } as any);

    const t = await thumbnailService.generateThumbnails(photo.file_path, { forceRegenerate: true });
    if (t) {
        catalogDb.updatePhoto(photoId, {
            thumbnail_path: t.thumbnailPath,
            preview_path: t.previewPath,
            blur_hash: t.blurHash || null
        } as any);
    }
    mainWindow?.webContents.send('photos:refresh');
    return { success: !!t, photo: catalogDb.getPhoto(photoId) };
});

// Sync the source photo's calibration to a set of photos (the selection) and
// regenerate their thumbnails — Lightroom's "Sync settings", for the grey card.
ipcMain.handle('photos:syncCalibration', async (_event, sourceId: string, targetIds: string[]) => {
    const src = catalogDb.getPhoto(sourceId);
    if (!src) return { success: false, error: 'Photo source introuvable' };
    let srcDs: any = {};
    try { srcDs = src.develop_settings ? JSON.parse(src.develop_settings as any) : {}; } catch { /* none */ }
    const wb = srcDs.wb || null;

    const ids = targetIds.filter(id => id !== sourceId);
    let done = 0;
    for (const id of ids) {
        const p = catalogDb.getPhoto(id);
        if (!p) continue;
        let ds: any = {};
        try { ds = p.develop_settings ? JSON.parse(p.develop_settings as any) : {}; } catch { /* fresh */ }
        if (wb) ds.wb = wb; else delete ds.wb;
        catalogDb.updatePhoto(id, { develop_settings: JSON.stringify(ds) } as any);
        try {
            const t = await thumbnailService.generateThumbnails(p.file_path, { forceRegenerate: true });
            if (t) {
                catalogDb.updatePhoto(id, {
                    thumbnail_path: t.thumbnailPath,
                    preview_path: t.previewPath,
                    blur_hash: t.blurHash || null
                } as any);
            }
        } catch { /* keep syncing the rest */ }
        done++;
        mainWindow?.webContents.send('calibration:progress', { current: done, total: ids.length });
        if (done % 4 === 0) mainWindow?.webContents.send('photos:refresh');
    }
    mainWindow?.webContents.send('photos:refresh');
    return { success: true, synced: done };
});

// Object removal (LaMa, 100% on-device). Non-destructive: the result lands on
// the photo's linked copy (created if needed) — the original file never changes.
ipcMain.handle('photos:removeObject', async (_event, photoId: string, maskPngBase64: string) => {
    try {
        const photo = catalogDb.getPhoto(photoId);
        if (!photo) return { success: false, error: 'Photo introuvable' };

        const inpaintService = (await import('../services/InpaintService')).default;
        const ready = await inpaintService.ensureModel(pct =>
            mainWindow?.webContents.send('inpaint:progress', { phase: 'download', pct }));
        if (!ready) return { success: false, error: 'Modèle IA indisponible (téléchargement échoué)' };

        // Target the linked copy: the photo itself if it IS one, else create/reuse.
        let targetId = photoId;
        let targetPath = photo.file_path;
        if (!photo.edited_from_id) {
            const created = await externalEditorService.createLinkedEditCopy(photoId);
            if ('error' in created) return { success: false, error: created.error };
            targetId = created.copyPhotoId;
            targetPath = created.copyPath;
        }

        mainWindow?.webContents.send('inpaint:progress', { phase: 'inpaint' });
        const ok = await inpaintService.inpaint(targetPath, Buffer.from(maskPngBase64, 'base64'), targetPath);
        if (!ok) return { success: false, error: 'Aucune zone masquée détectée' };

        // Fresh watcher baseline (it's our own write, not an external save),
        // then refresh the copy's thumbnails so the result shows everywhere.
        externalEditorService.registerLinkedEdit(targetPath, targetId);
        const t = await thumbnailService.generateThumbnails(targetPath, { forceRegenerate: true });
        if (t) {
            catalogDb.updatePhoto(targetId, {
                thumbnail_path: t.thumbnailPath,
                preview_path: t.previewPath,
                blur_hash: t.blurHash || null,
                width: t.width,
                height: t.height
            } as any);
        }
        mainWindow?.webContents.send('photos:refresh');
        return {
            success: true,
            targetPhotoId: targetId,
            appliedToCopy: targetId !== photoId,
            // The retouched file was previously handed to Affinity: its open
            // document there is now stale and a Cmd+S would erase this retouch.
            affinityWarning: externalEditorService.wasHandedToAffinity(targetPath)
        };
    } catch (e: any) {
        console.error('[Inpaint] failed:', e);
        return { success: false, error: String(e?.message || e) };
    }
});

// Lightroom-style round-trip: create a linked TIFF copy next to the original,
// open it in Affinity, and let the watcher bring every Cmd+S back by itself.
ipcMain.handle('editor:editLinkedCopy', async (_, photoId: string) => {
    const created = await externalEditorService.createLinkedEditCopy(photoId);
    if ('error' in created) return { success: false, error: created.error };

    const opened = await externalEditorService.openLinkedCopyInAffinity(created.copyPath, created.copyPhotoId);
    mainWindow?.webContents.send('photos:refresh');
    return {
        success: opened.opened,
        copyPath: created.copyPath,
        copyPhotoId: created.copyPhotoId,
        staleWarning: opened.staleRisk,
        error: opened.opened ? undefined : 'Affinity Photo introuvable'
    };
});

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
                                blur_hash = ?,
                                file_type = ?,
                                is_raw = 0,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(
                            newEditPath,
                            thumbResult.thumbnailPath,
                            thumbResult.previewPath || null,
                            thumbResult.blurHash || null,
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
                        blur_hash = ?,
                        file_type = ?
                    WHERE id = ?
                `).run(
                    editedFilePath,
                    thumbResult.thumbnailPath,
                    thumbResult.previewPath || null,
                    thumbResult.blurHash || null,
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

// ===== Enhanced Thumbnail API Handlers =====

/**
 * Generate thumbnails with custom options
 * @param filePath - Path to the source image
 * @param options - Options including format, sizes, forceRegenerate
 */
ipcMain.handle('thumbnails:generate', async (_, filePath: string, options?: {
    format?: 'jpeg' | 'webp' | 'png';
    sizes?: Array<{ name: string; width: number; height: number }>;
    quality?: number;
    forceRegenerate?: boolean;
    generatePreview?: boolean;
}) => {
    try {
        console.log('[Thumbnails:Generate] Starting thumbnail generation for:', filePath);

        const { forceRegenerate = false, generatePreview = true } = options || {};

        // Use the standard generateThumbnails method
        const result = await thumbnailService.generateThumbnails(filePath, {
            forceRegenerate,
            generatePreview
        });

        if (!result) {
            console.error('[Thumbnails:Generate] Failed to generate thumbnail:', filePath);
            throw new Error(`Failed to generate thumbnail for: ${filePath}`);
        }

        console.log('[Thumbnails:Generate] Successfully generated:', result.thumbnailPath);
        return result;
    } catch (error: any) {
        console.error('[Thumbnails:Generate] Error:', error.message);
        throw error;
    }
});

/**
 * Regenerate a specific thumbnail by photo ID
 * @param photoId - The photo ID in the database
 */
ipcMain.handle('thumbnails:regenerate', async (_, photoId: string) => {
    try {
        console.log('[Thumbnails:Regenerate] Regenerating thumbnail for photo:', photoId);

        const photo = catalogDb.getPhoto(photoId);
        if (!photo || !photo.file_path) {
            throw new Error(`Photo ${photoId} not found or has no file path`);
        }

        // Check if source file exists
        if (!fs.existsSync(photo.file_path)) {
            throw new Error(`Source file not found: ${photo.file_path}`);
        }

        // Force regenerate thumbnails
        const result = await thumbnailService.generateThumbnails(photo.file_path, {
            forceRegenerate: true,
            generatePreview: true
        });

        if (!result) {
            throw new Error(`Failed to regenerate thumbnail for: ${photo.file_path}`);
        }

        // Update database with new thumbnail paths
        catalogDb.updatePhoto(photoId, {
            thumbnail_path: result.thumbnailPath,
            preview_path: result.previewPath,
            blur_hash: result.blurHash
        });

        console.log('[Thumbnails:Regenerate] Successfully regenerated:', result.thumbnailPath);
        return { success: true, thumbnailPath: result.thumbnailPath, previewPath: result.previewPath };
    } catch (error: any) {
        console.error('[Thumbnails:Regenerate] Error:', error.message);
        return { success: false, error: error.message };
    }
});

/**
 * Validate that a thumbnail exists for a given photo
 * @param photoId - The photo ID to validate
 */
ipcMain.handle('thumbnails:validate', (_, photoId: string) => {
    try {
        const photo = catalogDb.getPhoto(photoId);
        if (!photo) {
            return { exists: false, reason: 'Photo not found' };
        }

        if (!photo.thumbnail_path) {
            return { exists: false, reason: 'No thumbnail path in database' };
        }

        // Check if thumbnail file exists on disk
        const thumbnailExists = fs.existsSync(photo.thumbnail_path);
        const previewExists = photo.preview_path ? fs.existsSync(photo.preview_path) : false;

        if (!thumbnailExists) {
            return { exists: false, reason: 'Thumbnail file missing on disk', thumbnailPath: photo.thumbnail_path };
        }

        return {
            exists: true,
            thumbnailPath: photo.thumbnail_path,
            previewPath: previewExists ? photo.preview_path : null,
            photoId
        };
    } catch (error: any) {
        console.error('[Thumbnails:Validate] Error:', error.message);
        return { exists: false, reason: error.message };
    }
});

/**
 * Get cache statistics
 */
ipcMain.handle('thumbnails:cache:stats', () => {
    try {
        const cacheSize = thumbnailService.getCacheSize();
        const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');

        // Count number of files
        const countFiles = (dir: string): number => {
            if (!fs.existsSync(dir)) return 0;
            let count = 0;
            const walkSync = (currentPath: string) => {
                try {
                    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(currentPath, entry.name);
                        if (entry.isDirectory()) {
                            walkSync(fullPath);
                        } else if (entry.isFile()) {
                            count++;
                        }
                    }
                } catch (e) {
                    // Ignore permission errors
                }
            };
            walkSync(dir);
            return count;
        };

        const thumbnailCount = countFiles(path.join(thumbnailDir, 'thumbs'));
        const previewCount = countFiles(path.join(thumbnailDir, 'previews'));

        const stats = {
            thumbnailCount,
            previewCount,
            totalFiles: thumbnailCount + previewCount,
            thumbnailSize: cacheSize.thumbnails,
            previewSize: cacheSize.previews,
            totalSize: cacheSize.total,
            thumbnailSizeFormatted: (cacheSize.thumbnails / 1024 / 1024).toFixed(2) + ' MB',
            previewSizeFormatted: (cacheSize.previews / 1024 / 1024).toFixed(2) + ' MB',
            totalSizeFormatted: (cacheSize.total / 1024 / 1024).toFixed(2) + ' MB'
        };

        console.log('[Thumbnails:Cache:Stats]', stats);
        return stats;
    } catch (error: any) {
        console.error('[Thumbnails:Cache:Stats] Error:', error.message);
        return { error: error.message };
    }
});

/**
 * Clear the thumbnail cache with options
 */
ipcMain.handle('thumbnails:cache:clear', async (_, options?: {
    clearThumbnails?: boolean;
    clearPreviews?: boolean;
    preserveRecent?: boolean;
    recentDays?: number;
}) => {
    try {
        const {
            clearThumbnails = true,
            clearPreviews = true,
            preserveRecent = false,
            recentDays = 7
        } = options || {};

        console.log('[Thumbnails:Cache:Clear] Clearing cache...', {
            clearThumbnails,
            clearPreviews,
            preserveRecent,
            recentDays
        });

        const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');
        const thumbsDir = path.join(thumbnailDir, 'thumbs');
        const previewsDir = path.join(thumbnailDir, 'previews');

        const cutoffTime = preserveRecent ? Date.now() - (recentDays * 24 * 60 * 60 * 1000) : null;

        const clearDirectory = (dir: string) => {
            if (!fs.existsSync(dir)) return 0;
            let cleared = 0;

            const walkAndClear = (currentPath: string) => {
                try {
                    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(currentPath, entry.name);
                        if (entry.isDirectory()) {
                            walkAndClear(fullPath);
                            // Remove empty directories
                            try {
                                const subEntries = fs.readdirSync(fullPath);
                                if (subEntries.length === 0) {
                                    fs.rmdirSync(fullPath);
                                }
                            } catch (e) {
                                // Ignore
                            }
                        } else if (entry.isFile()) {
                            const shouldDelete = !cutoffTime || (() => {
                                try {
                                    const stats = fs.statSync(fullPath);
                                    return stats.mtimeMs < cutoffTime!;
                                } catch {
                                    return true;
                                }
                            })();

                            if (shouldDelete) {
                                fs.unlinkSync(fullPath);
                                cleared++;
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Thumbnails:Cache:Clear] Error clearing:', currentPath, e);
                }
            };

            walkAndClear(dir);
            return cleared;
        };

        let totalCleared = 0;

        if (clearThumbnails) {
            const thumbsCleared = clearDirectory(thumbsDir);
            totalCleared += thumbsCleared;
            console.log(`[Thumbnails:Cache:Clear] Cleared ${thumbsCleared} thumbnails`);
        }

        if (clearPreviews) {
            const previewsCleared = clearDirectory(previewsDir);
            totalCleared += previewsCleared;
            console.log(`[Thumbnails:Cache:Clear] Cleared ${previewsCleared} previews`);
        }

        // If clearing all, use the service method to reset directories
        if (clearThumbnails && clearPreviews && !preserveRecent) {
            await thumbnailService.clearAllThumbnails();
            console.log('[Thumbnails:Cache:Clear] Full cache cleared');
        } else {
            console.log(`[Thumbnails:Cache:Clear] Partial cache cleared: ${totalCleared} files`);
        }

        return {
            success: true,
            cleared: totalCleared,
            message: `${totalCleared} files cleared`
        };
    } catch (error: any) {
        console.error('[Thumbnails:Cache:Clear] Error:', error.message);
        return { success: false, error: error.message };
    }
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

// No-arg convenience wrappers used by SettingsModal: auto-pick the best Lightroom
// catalog, then sync/import. Progress is sent on 'import:progress' (what the
// Settings UI listens to via onImportProgress).
ipcMain.handle('lightroom:syncAuto', async (event) => {
    const best = lightroomImportService.findBestCatalog();
    if (!best || !best.path) {
        return { success: false, error: 'Aucun catalogue Lightroom trouvé sur ce Mac.' };
    }
    return lightroomImportService.syncMetadata(best.path, (current, total) => {
        event.sender.send('import:progress', { current, total, status: 'Synchronisation Lightroom…' });
    });
});

ipcMain.handle('lightroom:importAuto', async (event) => {
    const best = lightroomImportService.findBestCatalog();
    if (!best || !best.path) {
        return { success: false, error: 'Aucun catalogue Lightroom trouvé sur ce Mac.' };
    }
    return lightroomImportService.importAllFromLightroom(best.path, (current, total, status) => {
        event.sender.send('import:progress', { current, total, status: status || 'Import Lightroom…' });
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
ipcMain.handle('faces:cluster', async () => {
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

        // Pick the LARGEST-box face as representative (faceIds[0] is max-confidence,
        // which often picks a tiny/edge face) and generate its square crop now.
        let repId = cluster.faceIds[0];
        let bestArea = -1;
        for (const fid of cluster.faceIds) {
            const fr = catalogDb.getFaceWithPhoto(fid);
            const area = (fr?.box_width || 0) * (fr?.box_height || 0);
            if (area > bestArea) { bestArea = area; repId = fid; }
        }
        catalogDb.updatePersonThumbnail(personId, repId);

        const rep = catalogDb.getFaceWithPhoto(repId);
        if (rep?.file_path) {
            const src = thumbnailService.getPreviewPath(rep.file_path)
                ?? thumbnailService.getThumbnailPath(rep.file_path);
            if (src) {
                const out = await thumbnailService.generateFaceCrop(src, repId, rep);
                if (out) catalogDb.setFaceCropPath(repId, out);
            }
        }

        facesAssigned += cluster.faceIds.length;
    }

    console.log(`[Clustering] Complete: ${clusters.length} people created, ${facesAssigned} faces assigned`);

    return { clustersCreated: clusters.length, facesAssigned };
});

// Generate square face crops for the ~representative faces the people view shows.
// Non-blocking: batched with yields, crops from a DECODABLE webp (never raw).
async function backfillFaceCrops(batchSize = 3): Promise<{ generated: number }> {
    const rows = catalogDb.getFacesNeedingCrops();
    let generated = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await Promise.all(batch.map(async (r) => {
            const src = thumbnailService.getPreviewPath(r.file_path)
                ?? thumbnailService.getThumbnailPath(r.file_path)
                ?? (r.thumbnail_path && fs.existsSync(r.thumbnail_path) ? r.thumbnail_path : null);
            if (!src) return;
            const out = await thumbnailService.generateFaceCrop(src, r.id, r);
            if (out) { catalogDb.setFaceCropPath(r.id, out); generated++; }
        }));
        await new Promise(res => setTimeout(res, 50)); // yield
        mainWindow?.webContents.send('faces:crop-progress', {
            current: Math.min(i + batchSize, rows.length), total: rows.length
        });
    }
    mainWindow?.webContents.send('faces:crop-progress', { current: 0, total: 0, done: true });
    return { generated };
}

ipcMain.handle('faces:regenerateCrops', () => backfillFaceCrops());

// Improved full re-clustering (centroid-based, merges, preserves renamed people).
ipcMain.handle('faces:recluster', async () => {
    return reclusterAllFaces(catalogDb, thumbnailService, (p) => {
        mainWindow?.webContents.send('faces:recluster-progress', p);
    });
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

// Get person with thumbnail face data
ipcMain.handle('people:getWithThumbnail', (_, personId: string) => {
    return catalogDb.getPersonWithThumbnailFace(personId);
});

// Get all people with thumbnail face data
ipcMain.handle('people:getAllWithThumbnails', () => {
    return catalogDb.getPeopleWithThumbnails();
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

// Scan for existing catalogs
ipcMain.handle("catalog:scan", async () => {
    const homeDir = require('os').homedir();
    const foundCatalogs: string[] = [];

    // Common locations to search
    const searchLocations = [
        homeDir,
        path.join(homeDir, 'Documents'),
        path.join(homeDir, 'Pictures'),
        path.join(homeDir, 'Desktop'),
        '/Volumes' // External drives on macOS
    ];

    const searchForCatalogs = (dir: string, depth: number = 0) => {
        if (depth > 3) return; // Limit recursion depth

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue; // Skip hidden files

                const fullPath = path.join(dir, entry.name);

                if (entry.isFile() && entry.name === 'catalog.db') {
                    // Found a catalog - add the parent directory
                    foundCatalogs.push(dir);
                } else if (entry.isDirectory() && depth < 3) {
                    // Skip certain directories
                    if (['node_modules', 'Library', '.Trash', 'Applications'].includes(entry.name)) continue;
                    searchForCatalogs(fullPath, depth + 1);
                }
            }
        } catch (e) {
            // Ignore permission errors
        }
    };

    for (const location of searchLocations) {
        if (fs.existsSync(location)) {
            searchForCatalogs(location);
        }
    }

    return foundCatalogs;
});
