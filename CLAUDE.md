# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based non-linear video editor (NLE) built with vanilla JavaScript and Vite. No framework — all UI is imperative DOM manipulation. The editor runs entirely client-side using WebCodecs, WebGL, Web Workers, and FFmpeg.wasm for media decode/encode.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:5174
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

No test runner or linter is configured. Verification is manual in-browser.

## Architecture

### Subsystem Layers

All source lives under `src/lib/editor/` organized into layers with strict dependency direction (lower layers never import higher ones):

- **`core/`** — Foundation: EventBus (pub/sub), EditorState (observable store), History (undo/redo command pattern), Constants, RafScheduler
- **`timeline/`** — Data model: TimelineEngine (tracks/clips CRUD), Clip (with intrinsic effects), ClipOperations (insert/delete/move/trim/split), TimelineMath (frame↔pixel)
- **`media/`** — Media pipeline: MediaManager (import/probe/catalog), Demuxer (mp4box), MediaDecoder/WebCodecsDecoder, ThumbnailGenerator, WaveformGenerator, RenderAheadManager (decode-ahead buffer), ConformEncoder (background H.264 transcode)
- **`playback/`** — Rendering: PlaybackEngine (rAF loop, A/V sync), VideoCompositor (canvas compositing with effects), AudioMixer (WebAudio graph)
- **`effects/`** — Effect system: EffectRegistry, VideoEffects/AudioEffects/Transitions (registered via side-effect imports), KeyframeEngine, GLEffectRenderer + GLSL shaders, TextRenderer
- **`export/`** — Export pipeline: ExportPipeline orchestrator, FFmpegBridge (ffmpeg.wasm), WebCodecsEncoder, Muxer, FrameFeeder, ExportPresets
- **`project/`** — Persistence: ProjectManager (save/load/autosave), ProjectSchema
- **`ui/`** — 24 UI modules: DockManager (split-tree panel layout), TimelineUI, ProgramMonitor, SourceMonitor, ProjectPanel, EffectsPanel, PropertiesPanel, ExportDialog, KeyboardShortcuts, MenuBar, etc.

### Module Pattern

Every module exports a singleton object (not a class):

```javascript
export const moduleName = {
  _privateState: null,
  init(container) { /* one-time setup */ },
  publicMethod() { /* ... */ }
};
```

Modules communicate exclusively through `EventBus` — no direct cross-module method calls for state changes. Events are defined in `core/Constants.js` as `EDITOR_EVENTS`.

### Initialization Order

`src/main.js` → `initEditor()` in `src/lib/editor/index.js`. DockManager must init first (it extracts panel DOM elements from `index.html`), then all other UI modules receive their container via `dockManager.getPanelContentEl('panel-id')`. Effects register themselves via side-effect imports.

### State Management

`EditorState` is a centralized observable store with path-based get/set (`editorState.get('playback.currentFrame')`, `editorState.set('ui.activeTool', 'razor')`). Sequence-specific state (tracks, frameRate, canvas) is shimmed through the active sequence — paths like `timeline.tracks` resolve to `sequences[activeSequenceId].tracks`.

### Worker Threads

Four Web Workers handle heavy computation off-main-thread:
- `DecodeWorker.js` — hardware video decoding
- `CompositorWorker.js` — frame compositing
- `ConformWorker.js` — background H.264 pre-encoding
- `ExportWorker.js` — export rendering

Workers use ES module format (`worker: { format: 'es' }` in vite config).

### History/Undo System

Command pattern: `{ execute(), undo(), description }`. Supports batch grouping for atomic multi-step operations via `timelineEngine.beginBatch()` / `commitBatch()`. Max 200 undo states.

## Key Conventions

- **ES modules** throughout (`"type": "module"` in package.json)
- 2-space indent, single quotes, semicolons, `const`/`let` only
- Logger (`src/lib/utils/logger.js`) with `[NLE]` prefix — use instead of `console.log`
- Every clip has intrinsic effects (motion, opacity, volume) that are always present and keyframe-animatable
- Batch timeline mutations to avoid excessive event emission and history entries

## Vite / Build Notes

- COOP/COEP headers are set in vite config — required for `SharedArrayBuffer` (used by FFmpeg.wasm and worker communication)
- `@ffmpeg/ffmpeg` and `@ffmpeg/util` are excluded from Vite's dependency optimization (they need special loading)
- Build output goes to `dist/` with sourcemaps enabled
- `dist/` is tracked in git for GitHub Pages deployment

## Browser APIs Used

WebCodecs (video/audio decode/encode), AudioContext (playback mixing), Canvas 2D + WebGL (rendering/effects), SharedArrayBuffer (worker data), IndexedDB (persistent media storage), Web Workers, File API
