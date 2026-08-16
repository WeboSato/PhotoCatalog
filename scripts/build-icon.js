#!/usr/bin/env node
/**
 * Regenerate macOS icon.icns (and a matching 1024 master PNG) from a source image.
 *
 * Why this exists: the previous icon.icns was built by a third-party tool from
 * RGB-only sources (no alpha channel) and contained non-standard ic04/ic05 ARGB
 * chunks. macOS app icons must be RGBA; the missing alpha made the dock render a
 * corrupted / noisy icon. This script produces a canonical icns via Apple's
 * iconutil, with every size encoded as an RGBA PNG.
 *
 * Usage:  node scripts/build-icon.js [sourceImage]
 *   sourceImage defaults to resources/icon-master.png, falling back to the
 *   largest existing iconset PNG.
 */
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const resourcesDir = path.join(__dirname, '..', 'resources');

function pickSource() {
    const arg = process.argv[2];
    const candidates = [
        arg,
        path.join(resourcesDir, 'icon-master.png'),
        path.join(resourcesDir, 'icon.iconset', 'icon_512x512@2x.png'),
        path.join(resourcesDir, 'Icon_V1.jpg'),
    ].filter(Boolean);
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error('No source image found for icon generation');
}

// macOS iconset entries: file name -> pixel size
const SIZES = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
];

async function main() {
    const source = pickSource();
    console.log('[icon] source:', source);

    // Square the source on a transparent canvas and guarantee an alpha channel.
    const master = await sharp(source)
        .resize(1024, 1024, { fit: 'cover', position: 'centre' })
        .ensureAlpha()
        .png()
        .toBuffer();

    // Keep a clean master around for future regeneration.
    fs.writeFileSync(path.join(resourcesDir, 'icon-master.png'), master);

    const iconsetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-iconset-')) + '.iconset';
    fs.mkdirSync(iconsetDir, { recursive: true });

    for (const [name, size] of SIZES) {
        const buf = await sharp(master)
            .resize(size, size, { fit: 'cover' })
            .ensureAlpha()
            .png({ compressionLevel: 9 })
            .toBuffer();
        fs.writeFileSync(path.join(iconsetDir, name), buf);
    }

    // Refresh the committed .iconset too, so it matches the icns.
    const committedIconset = path.join(resourcesDir, 'icon.iconset');
    fs.mkdirSync(committedIconset, { recursive: true });
    for (const [name] of SIZES) {
        fs.copyFileSync(path.join(iconsetDir, name), path.join(committedIconset, name));
    }

    const icnsPath = path.join(resourcesDir, 'icon.icns');
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
    console.log('[icon] wrote', icnsPath);

    // Also emit a 512 PNG used as the runtime dock icon (dev mode).
    await sharp(master).resize(512, 512).png().toFile(path.join(resourcesDir, 'icon.png'));
    console.log('[icon] wrote resources/icon.png');

    fs.rmSync(iconsetDir, { recursive: true, force: true });
}

main().catch((err) => {
    console.error('[icon] failed:', err);
    process.exit(1);
});
