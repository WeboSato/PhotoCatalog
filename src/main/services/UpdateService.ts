// PhotoCatalog Update Service
// Checks GitHub releases for new versions and notifies users

import { app, dialog, shell, BrowserWindow } from 'electron';
import https from 'https';

const GITHUB_OWNER = 'WeboSato';
const GITHUB_REPO = 'PhotoCatalog';

interface GitHubRelease {
    tag_name: string;
    name: string;
    html_url: string;
    published_at: string;
    body: string;
    assets: {
        name: string;
        browser_download_url: string;
    }[];
}

export class UpdateService {
    private currentVersion: string;
    private mainWindow: BrowserWindow | null = null;

    constructor() {
        this.currentVersion = app.getVersion();
    }

    setMainWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    async checkForUpdates(silent: boolean = false): Promise<boolean> {
        try {
            const latestRelease = await this.getLatestRelease();

            if (!latestRelease) {
                if (!silent) {
                    this.showNoUpdateDialog();
                }
                return false;
            }

            const latestVersion = latestRelease.tag_name.replace(/^v/, '');
            const hasUpdate = this.isNewerVersion(latestVersion, this.currentVersion);

            if (hasUpdate) {
                this.showUpdateDialog(latestRelease);
                return true;
            } else if (!silent) {
                this.showNoUpdateDialog();
            }

            return false;
        } catch (error) {
            console.error('[UpdateService] Error checking for updates:', error);
            if (!silent) {
                dialog.showErrorBox(
                    'Update Check Failed',
                    'Could not check for updates. Please check your internet connection.'
                );
            }
            return false;
        }
    }

    private getLatestRelease(): Promise<GitHubRelease | null> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
                method: 'GET',
                headers: {
                    'User-Agent': `PhotoCatalog/${this.currentVersion}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            resolve(null);
                        }
                    } else if (res.statusCode === 404) {
                        // No releases yet
                        resolve(null);
                    } else {
                        reject(new Error(`GitHub API returned ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.end();
        });
    }

    private isNewerVersion(latest: string, current: string): boolean {
        const latestParts = latest.split('.').map(Number);
        const currentParts = current.split('.').map(Number);

        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestPart = latestParts[i] || 0;
            const currentPart = currentParts[i] || 0;

            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }

        return false;
    }

    private showUpdateDialog(release: GitHubRelease) {
        const version = release.tag_name.replace(/^v/, '');

        // Find the DMG for arm64
        const dmgAsset = release.assets.find(a =>
            a.name.includes('arm64') && a.name.endsWith('.dmg')
        ) || release.assets.find(a => a.name.endsWith('.dmg'));

        const buttons = dmgAsset
            ? ['Download Update', 'View on GitHub', 'Later']
            : ['View on GitHub', 'Later'];

        const message = `A new version of PhotoCatalog is available!\n\nCurrent: ${this.currentVersion}\nNew: ${version}`;
        const detail = release.body
            ? `What's new:\n${release.body.substring(0, 500)}${release.body.length > 500 ? '...' : ''}`
            : 'Check GitHub for release notes.';

        dialog.showMessageBox(this.mainWindow!, {
            type: 'info',
            title: 'Update Available',
            message,
            detail,
            buttons,
            defaultId: 0,
            cancelId: buttons.length - 1
        }).then(({ response }) => {
            if (dmgAsset && response === 0) {
                // Download Update
                shell.openExternal(dmgAsset.browser_download_url);
            } else if ((dmgAsset && response === 1) || (!dmgAsset && response === 0)) {
                // View on GitHub
                shell.openExternal(release.html_url);
            }
            // "Later" does nothing
        });
    }

    private showNoUpdateDialog() {
        dialog.showMessageBox(this.mainWindow!, {
            type: 'info',
            title: 'No Updates',
            message: 'You are using the latest version!',
            detail: `PhotoCatalog ${this.currentVersion}`,
            buttons: ['OK']
        });
    }
}

export const updateService = new UpdateService();
