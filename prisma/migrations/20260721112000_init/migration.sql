-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "club" TEXT NOT NULL DEFAULT '',
    "eventName" TEXT NOT NULL DEFAULT '',
    "eventDate" DATETIME,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "requestedTrackCount" INTEGER NOT NULL DEFAULT 6,
    "edgeMarginMeters" REAL NOT NULL DEFAULT 8,
    "minimumTrackSpacingMeters" REAL NOT NULL DEFAULT 15,
    "autosaveVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Field" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaM2" REAL NOT NULL,
    "areaHa" REAL NOT NULL,
    "perimeterM" REAL NOT NULL DEFAULT 0,
    "dimensionsJson" TEXT NOT NULL DEFAULT '{}',
    "sourceType" TEXT NOT NULL DEFAULT 'image',
    "mapReference" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Field_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FieldImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fieldId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "widthPixels" INTEGER,
    "heightPixels" INTEGER,
    "rotationDegrees" REAL NOT NULL DEFAULT 0,
    "cropJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldImage_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Calibration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fieldId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "meterPerPixel" REAL NOT NULL,
    "knownDistanceM" REAL,
    "knownAreaM2" REAL,
    "knownWidthM" REAL,
    "knownHeightM" REAL,
    "calculatedAreaM2" REAL,
    "deviationPercent" REAL,
    "warningDa" TEXT NOT NULL DEFAULT '',
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Calibration_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FieldPolygon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fieldId" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "areaM2" REAL NOT NULL,
    "perimeterM" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FieldPolygon_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RestrictedArea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "areaType" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "safetyDistanceMeters" REAL NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#d9480f',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "geometry" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RestrictedArea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelDa" TEXT NOT NULL,
    "valueNumber" REAL,
    "valueText" TEXT,
    "unit" TEXT NOT NULL DEFAULT '',
    "editable" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TrackRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TrackTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT,
    "displayNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "lengthSteps" REAL NOT NULL,
    "stepLengthM" REAL NOT NULL,
    "lengthMeters" REAL NOT NULL,
    "rotationDeg" REAL NOT NULL DEFAULT 0,
    "lockedLength" BOOLEAN NOT NULL DEFAULT true,
    "lockedAngles" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Track_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Track_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TrackTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackPoint_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "displayNo" INTEGER NOT NULL,
    "distanceAlongTrackMeters" REAL NOT NULL,
    "material" TEXT NOT NULL DEFAULT 'træ',
    "description" TEXT NOT NULL DEFAULT '',
    "marksFinish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackObject_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ValidationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ValidationSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Export" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Export_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProjectVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Field_projectId_key" ON "Field"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Calibration_fieldId_key" ON "Calibration"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FieldPolygon_fieldId_key" ON "FieldPolygon"("fieldId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RestrictedArea_projectId_idx" ON "RestrictedArea"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackTemplate_code_key" ON "TrackTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackRule_templateId_key_key" ON "TrackRule"("templateId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Track_projectId_idx" ON "Track"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Track_projectId_displayNo_key" ON "Track"("projectId", "displayNo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackPoint_trackId_order_key" ON "TrackPoint"("trackId", "order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackObject_trackId_displayNo_key" ON "TrackObject"("trackId", "displayNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ValidationSnapshot_projectId_idx" ON "ValidationSnapshot"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Export_projectId_idx" ON "Export"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProjectVersion_projectId_idx" ON "ProjectVersion"("projectId");
