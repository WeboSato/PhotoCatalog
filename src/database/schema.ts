// PhotoCatalog Database Schema
// Inspired by Adobe Lightroom's catalog structure

export const DATABASE_SCHEMA = `
-- Photos table: Core photo metadata and catalog information
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    file_path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT,
    mime_type TEXT,

    -- Dimensions
    width INTEGER,
    height INTEGER,
    orientation INTEGER DEFAULT 1,

    -- Dates
    date_taken TEXT,
    date_imported TEXT DEFAULT CURRENT_TIMESTAMP,
    date_modified TEXT,

    -- Camera EXIF
    camera_make TEXT,
    camera_model TEXT,
    lens_model TEXT,
    focal_length REAL,
    aperture REAL,
    shutter_speed TEXT,
    iso INTEGER,
    flash_used INTEGER DEFAULT 0,

    -- GPS
    gps_latitude REAL,
    gps_longitude REAL,
    gps_altitude REAL,

    -- Organization
    rating INTEGER DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    flag TEXT DEFAULT 'none' CHECK (flag IN ('none', 'picked', 'rejected')),
    color_label TEXT DEFAULT 'none' CHECK (color_label IN ('none', 'red', 'yellow', 'green', 'blue', 'purple')),

    -- IPTC Metadata
    title TEXT,
    caption TEXT,
    copyright TEXT,
    creator TEXT,

    -- Processing
    is_raw INTEGER DEFAULT 0,
    raw_type TEXT,
    has_sidecar INTEGER DEFAULT 0,
    thumbnail_path TEXT,
    preview_path TEXT,
    smart_preview_path TEXT,

    -- Virtual copy support
    is_virtual_copy INTEGER DEFAULT 0,
    master_id TEXT REFERENCES photos(id),
    copy_name TEXT,

    -- External edit tracking
    edit_copy_path TEXT,  -- Path to the _Edit copy file

    -- Indexing
    indexed INTEGER DEFAULT 0,
    hash TEXT,

    -- Archive status
    is_archived INTEGER DEFAULT 0,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search for photos
CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
    file_name,
    title,
    caption,
    keywords,
    content='photos',
    content_rowid='rowid'
);

-- Collections table: Virtual albums/collections
CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id TEXT REFERENCES collections(id),
    is_smart INTEGER DEFAULT 0,
    smart_criteria TEXT, -- JSON for smart collection rules
    sort_order INTEGER DEFAULT 0,
    cover_photo_id TEXT REFERENCES photos(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Collection-Photos junction table
CREATE TABLE IF NOT EXISTS collection_photos (
    collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, photo_id)
);

-- Keywords/Tags table with hierarchy
CREATE TABLE IF NOT EXISTS keywords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES keywords(id),
    synonyms TEXT, -- JSON array of synonyms
    include_on_export INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Photo-Keywords junction table
CREATE TABLE IF NOT EXISTS photo_keywords (
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    keyword_id TEXT REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, keyword_id)
);

-- Folders table: Mirrors file system structure
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
    is_watched INTEGER DEFAULT 0,
    last_scan TEXT,
    photo_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Edit History table: Non-destructive edit tracking
CREATE TABLE IF NOT EXISTS edit_history (
    id TEXT PRIMARY KEY,
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    edit_type TEXT NOT NULL,
    edit_data TEXT NOT NULL, -- JSON of edit parameters
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Develop Settings table: Current processing settings
CREATE TABLE IF NOT EXISTS develop_settings (
    photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    settings TEXT NOT NULL, -- JSON of all develop settings
    preset_id TEXT REFERENCES develop_presets(id),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Develop Presets table
CREATE TABLE IF NOT EXISTS develop_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_name TEXT DEFAULT 'User Presets',
    settings TEXT NOT NULL, -- JSON of preset settings
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Stacks table: Group related photos
CREATE TABLE IF NOT EXISTS stacks (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Stack-Photos junction table
CREATE TABLE IF NOT EXISTS stack_photos (
    stack_id TEXT REFERENCES stacks(id) ON DELETE CASCADE,
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    is_top INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    PRIMARY KEY (stack_id, photo_id)
);

-- Export Presets table
CREATE TABLE IF NOT EXISTS export_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    settings TEXT NOT NULL, -- JSON of export settings
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Import Sessions table
CREATE TABLE IF NOT EXISTS import_sessions (
    id TEXT PRIMARY KEY,
    source_path TEXT,
    destination_path TEXT,
    photo_count INTEGER DEFAULT 0,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT DEFAULT 'pending'
);

-- Catalog Metadata table
CREATE TABLE IF NOT EXISTS catalog_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_photos_date_taken ON photos(date_taken);
CREATE INDEX IF NOT EXISTS idx_photos_date_imported ON photos(date_imported);
CREATE INDEX IF NOT EXISTS idx_photos_rating ON photos(rating);
CREATE INDEX IF NOT EXISTS idx_photos_flag ON photos(flag);
CREATE INDEX IF NOT EXISTS idx_photos_color_label ON photos(color_label);
CREATE INDEX IF NOT EXISTS idx_photos_file_type ON photos(file_type);
CREATE INDEX IF NOT EXISTS idx_photos_camera_model ON photos(camera_model);
CREATE INDEX IF NOT EXISTS idx_photos_indexed ON photos(indexed);
CREATE INDEX IF NOT EXISTS idx_photos_is_raw ON photos(is_raw);
CREATE INDEX IF NOT EXISTS idx_photos_is_archived ON photos(is_archived);
CREATE INDEX IF NOT EXISTS idx_collection_photos_collection ON collection_photos(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_photos_photo ON collection_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_keywords_photo ON photo_keywords(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_keywords_keyword ON photo_keywords(keyword_id);
CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path);
CREATE INDEX IF NOT EXISTS idx_edit_history_photo ON edit_history(photo_id);

-- Triggers for updated_at
CREATE TRIGGER IF NOT EXISTS update_photos_timestamp
    AFTER UPDATE ON photos
    BEGIN
        UPDATE photos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_collections_timestamp
    AFTER UPDATE ON collections
    BEGIN
        UPDATE collections SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- People table: Named individuals for face recognition
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    thumbnail_face_id TEXT, -- Reference to best face thumbnail
    face_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Faces table: Detected faces in photos
CREATE TABLE IF NOT EXISTS faces (
    id TEXT PRIMARY KEY,
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,

    -- Face bounding box (relative coordinates 0-1)
    box_x REAL NOT NULL,
    box_y REAL NOT NULL,
    box_width REAL NOT NULL,
    box_height REAL NOT NULL,

    -- Face descriptor (128-dimensional vector as JSON)
    descriptor TEXT,

    -- Confidence score
    confidence REAL DEFAULT 0,

    -- Status
    is_confirmed INTEGER DEFAULT 0, -- User confirmed this identification

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for face queries
CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);

-- Insert default catalog metadata
INSERT OR IGNORE INTO catalog_metadata (key, value) VALUES
    ('catalog_version', '1.0.0'),
    ('catalog_name', 'PhotoCatalog'),
    ('created_at', datetime('now'));
`;

export const RAW_EXTENSIONS = [
    '.cr2', '.cr3',  // Canon
    '.nef', '.nrw',  // Nikon
    '.arw', '.srf', '.sr2',  // Sony
    '.raf',  // Fujifilm
    '.orf',  // Olympus
    '.rw2',  // Panasonic
    '.pef', '.dng',  // Pentax/Adobe DNG
    '.x3f',  // Sigma
    '.3fr', '.fff',  // Hasselblad
    '.iiq',  // Phase One
    '.rwl',  // Leica
    '.erf',  // Epson
    '.mrw',  // Minolta
    '.raw'   // Generic
];

export const IMAGE_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.heic', '.heif'
];

export const AFFINITY_EXTENSIONS = ['.afphoto', '.af'];

export const SUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS];
