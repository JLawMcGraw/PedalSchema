import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface EditorState {
  // View controls
  zoom: number;
  pan: { x: number; y: number };
  gridVisible: boolean;
  cablesVisible: boolean;

  // Selection
  selectedPedalId: string | null;

  // Interaction mode
  mode: 'select' | 'pan' | 'add-pedal';
  pedalToAdd: string | null; // pedal ID to add when clicking

  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;

  // Actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPan: (pan: { x: number; y: number }) => void;
  panBy: (delta: { x: number; y: number }) => void;
  toggleGrid: () => void;
  toggleCables: () => void;
  selectPedal: (id: string | null) => void;
  setMode: (mode: 'select' | 'pan' | 'add-pedal') => void;
  setPedalToAdd: (pedalId: string | null) => void;
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    zoom: 1,
    pan: { x: 0, y: 0 },
    gridVisible: true,
    cablesVisible: true,
    selectedPedalId: null,
    mode: 'select',
    pedalToAdd: null,
    canUndo: false,
    canRedo: false,

    setZoom: (zoom) =>
      set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),

    zoomIn: () =>
      set((state) => ({ zoom: Math.min(4, state.zoom * 1.2) })),

    zoomOut: () =>
      set((state) => ({ zoom: Math.max(0.25, state.zoom / 1.2) })),

    resetZoom: () =>
      set({ zoom: 1, pan: { x: 0, y: 0 } }),

    setPan: (pan) => set({ pan }),

    panBy: (delta) =>
      set((state) => ({
        pan: {
          x: state.pan.x + delta.x,
          y: state.pan.y + delta.y,
        },
      })),

    toggleGrid: () =>
      set((state) => ({ gridVisible: !state.gridVisible })),

    toggleCables: () =>
      set((state) => ({ cablesVisible: !state.cablesVisible })),

    selectPedal: (id) =>
      set({ selectedPedalId: id }),

    setMode: (mode) =>
      set({ mode, pedalToAdd: mode !== 'add-pedal' ? null : undefined }),

    setPedalToAdd: (pedalId) =>
      set({ pedalToAdd: pedalId, mode: pedalId ? 'add-pedal' : 'select' }),
  }))
);
