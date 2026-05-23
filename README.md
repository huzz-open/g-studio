# G-Studio

Game map creation platform with modular architecture.

## Modules

- **Resource Manager** - Manage icons, animations, map data and all game assets
- **Sprite Slicer** - Slice animation frames, location icons and items from sprite sheets
- **Map Editor** - Edit world maps, place locations and manage road networks

## Architecture

```
src/
├── shared/           # i18n, SVG icons, storage abstraction, shared types
│   ├── storage/      # IndexedDB + FileSystem sync layer
│   ├── workspace/    # Workspace lifecycle management
│   ├── components/   # ConfirmDialog, FileDropZone, etc.
│   └── i18n/         # zh-CN / en-US translations
├── router/           # Vue Router (hash mode)
└── modules/
    ├── dashboard/        # Home page with module cards
    ├── resource-manager/ # Resource CRUD
    │   ├── interfaces/   # Resource types and query interfaces
    │   ├── services/     # ResourceService (save/query/delete)
    │   └── components/   # ResourceManagerView
    ├── sprite-slicer/    # Interface-driven sprite processing
    │   ├── interfaces/   # IBackgroundRemover, ISpriteDetector, ISliceMode
    │   ├── core/         # Algorithm implementations
    │   ├── modes/        # Animation, Location, Item modes
    │   ├── services/     # SlicerDraftService (session persistence)
    │   └── components/   # Vue UI components
    └── map-editor/       # World map editor
```

## Tech Stack

- Vue 3 + TypeScript + Vite
- IndexedDB (L1 cache) + File System Access API (L2 persistent storage)
- Vue Router for navigation
- Custom i18n (zh-CN / en-US)
- pnpm package manager

## Getting Started

```bash
pnpm install
pnpm dev
```

## Storage Architecture

G-Studio uses a two-layer storage architecture:

- **L1 (IndexedDB)**: Browser-side fast cache, all reads and writes first go through IDB
- **L2 (Local Directory)**: When a workspace is connected, changes are asynchronously flushed to disk via a DirtyQueue (outbox pattern)

Key mechanisms:
- Write operations atomically insert data + a dirty queue entry into IDB
- A `SyncService` debounces and flushes pending entries to disk
- On reconnect, incremental sync compares registry timestamps to avoid full reloads
- `visibilitychange` triggers flushes when the tab goes to background; `beforeunload` is best-effort only
- The DirtyQueue guarantees eventual consistency — unflushed entries are replayed on next connect

## Local Workspace Directory Structure

When a user selects a local directory as their workspace, G-Studio creates the following structure:

```
<workspace-root>/
├── workspace.json                  # Workspace metadata (name, version, timestamps)
├── .g-studio-registry.json         # Resource registry (all resource records as JSON)
├── spritesheets/                   # Sprite sheet images (.png)
│   └── {name}_{id}.png
├── icons/                          # Icon images (.png)
│   └── {name}_{id}.png
├── animations/                     # Animation frame images (.png)
│   └── {name}_{id}.png
├── tiles/                          # Tile images (.png)
│   └── {name}_{id}.png
├── items/                          # Item images (.png)
│   └── {name}_{id}.png
├── maps/                           # Map data files (.json)
│   └── {name}_{id}.json
└── exports/                        # Generic / uncategorized files (.png)
    └── {name}_{id}.png
```

### File Naming Convention

Each resource file is named as `{safeName}_{shortId}.{ext}` where:
- `safeName` — resource name with special characters replaced by `_`
- `shortId` — first 8 characters of the resource ID (for uniqueness)
- `ext` — `png` for images, `json` for map data

### Resource Type → Directory Mapping

| Resource Type | Directory       | File Extension |
|--------------|-----------------|----------------|
| `spritesheet`| `spritesheets/` | `.png`         |
| `icon`       | `icons/`        | `.png`         |
| `animation`  | `animations/`   | `.png`         |
| `tile`       | `tiles/`        | `.png`         |
| `item`       | `items/`        | `.png`         |
| `map-data`   | `maps/`         | `.json`        |
| `generic`    | `exports/`      | `.png`         |

### Registry File (`.g-studio-registry.json`)

This JSON file is the source of truth for resource metadata. Structure:

```json
{
  "version": 1,
  "updatedAt": 1716451200000,
  "stores": {
    "resources": [
      {
        "id": "m1abc123-x7y8z9",
        "name": "hero-walk",
        "type": "spritesheet",
        "tags": ["character", "walk"],
        "thumbnail": null,
        "metadata": { "cols": 4, "rows": 2 },
        "filePath": "spritesheets/hero-walk_m1abc123.png",
        "createdAt": 1716451200000,
        "updatedAt": 1716451200000
      }
    ]
  }
}
```

### Browser-Only Mode (No Workspace)

When no workspace directory is selected, all data resides in the browser's IndexedDB only. This data is volatile — clearing browser data will erase it. A warning badge is shown in the top bar to indicate this mode.

## Key Design Decisions

- **Interface-driven**: All core logic defined via TypeScript interfaces, implementations are swappable
- **Resource Manager as hub**: Modules communicate through the resource system, not directly
- **Two-layer storage**: IndexedDB for speed, filesystem for persistence. DirtyQueue ensures no data loss
- **Background removal simplified**: Auto mode (default magenta, user-selectable color) + No-removal
- **Three slice modes**: Animation (frame preview + save), Location (standardize + icon library), Item (flexible standardization + engine metadata export)
- **Slicer draft persistence**: Working sessions are auto-saved to a dedicated IDB store, not synced to disk

## Resource Manager Redesign (Planned)

The resource manager is being redesigned from a flat IDB-based list to a **filesystem-based directory browser** with sidecar `.meta` metadata files.

### Core Concepts

- **Workspace directory = resource library**: Users organize files freely; G-Studio reads and displays them as-is
- **Sidecar metadata**: Each resource `foo.png` has a hidden `.foo.png.meta` JSON file alongside it
- **Unique ID (UID)**: Format `gs://<timestamp-base36>-<random-6>`, generated once in `.meta`, never modified
- **Triple binding**: Filename convention (daily use) + contentHash (repair renames) + uid-index.json (repair deleted .meta)
- **Reconciliation**: On workspace connect, scans for orphaned `.meta` / unmatched files, auto-repairs bindings via content hash matching

### Design Decisions Confirmed

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Browser mode (no workspace) | IDB as virtual directory | Unified UI across both modes |
| Reconciliation trigger | Full scan on connect + manual refresh | No polling overhead; user controls refresh |
| Orphan .meta cleanup | Prompt user + one-click cleanup button | No silent deletion; user stays aware |
| contentHash computation | Full SHA-256, async with progress | Accuracy critical; game assets usually small |
