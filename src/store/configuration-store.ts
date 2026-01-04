import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Board, Pedal, Amp, PlacedPedal, Cable, Collision, ChainWarning, ChainSuggestion, Position, ChainLocation, ChainContext, RoutingConfig, PedalRoutingConfig } from '@/types';
import { detectCollisions } from '@/lib/engine/collision';
import { getCategoryDefaultOrder } from '@/lib/constants/pedal-categories';
import { signalChainEngine } from '@/lib/engine/signal-chain';
import { calculateCables } from '@/lib/engine/cables';
import { calculateOptimalLayout } from '@/lib/engine/layout';

interface ConfigurationState {
  // Configuration data
  id: string | null;
  name: string;
  description: string;

  // References
  board: Board | null;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;

  // Pedals on the board
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>; // cache of full pedal data

  // Routing configuration
  routingConfig: RoutingConfig;

  // Calculated data
  cables: Cable[];
  collisions: Collision[];
  warnings: ChainWarning[];
  suggestions: ChainSuggestion[];

  // Dirty state
  isDirty: boolean;
  isSaving: boolean;

  // Actions
  initConfiguration: (config: {
    id?: string;
    name: string;
    description?: string;
    board: Board;
    amp?: Amp | null;
    useEffectsLoop?: boolean;
    use4CableMethod?: boolean;
    placedPedals?: PlacedPedal[];
    pedalsById?: Record<string, Pedal>;
  }) => void;

  setBoard: (board: Board) => void;
  setAmp: (amp: Amp | null) => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setUseEffectsLoop: (use: boolean) => void;
  setUse4CableMethod: (use: boolean) => void;

  addPedal: (pedal: Pedal, position: Position) => void;
  movePedal: (placedPedalId: string, position: Position) => void;
  removePedal: (placedPedalId: string) => void;
  rotatePedal: (placedPedalId: string) => void;
  updatePedalChainPosition: (placedPedalId: string, newPosition: number) => void;
  updatePedalLocation: (placedPedalId: string, location: ChainLocation) => void;

  recalculateCollisions: () => void;
  recalculateCables: () => void;
  recalculateSignalChain: () => void;

  // Routing actions
  setPedalRoutingMode: (placedPedalId: string, mode: 'standard' | 'loop', loopPedalIds?: string[]) => void;
  togglePedalInLoop: (loopPedalId: string, targetPedalId: string) => void;

  // Layout optimization
  optimizeLayout: () => void;

  markClean: () => void;
  setSaving: (saving: boolean) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

export const useConfigurationStore = create<ConfigurationState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      id: null,
      name: 'Untitled Board',
      description: '',
      board: null,
      amp: null,
      useEffectsLoop: false,
      use4CableMethod: false,
      placedPedals: [],
      pedalsById: {},
      routingConfig: {
        useLoopPedals: true,
        use4CableMethod: false,
        pedalConfigs: [],
      },
      cables: [],
      collisions: [],
      warnings: [],
      suggestions: [],
      isDirty: false,
      isSaving: false,

      initConfiguration: (config) => {
        set((state) => {
          state.id = config.id || null;
          state.name = config.name;
          state.description = config.description || '';
          state.board = config.board;
          state.amp = config.amp || null;
          state.useEffectsLoop = config.useEffectsLoop || false;
          state.use4CableMethod = config.use4CableMethod || false;
          state.placedPedals = config.placedPedals || [];
          state.pedalsById = config.pedalsById || {};
          state.isDirty = false;
          state.collisions = [];
          state.cables = [];
          state.warnings = [];
          state.suggestions = [];
        });
        // Recalculate after init
        get().recalculateCollisions();
        get().recalculateSignalChain();
      },

      setBoard: (board) => {
        set((state) => {
          state.board = board;
          state.isDirty = true;
        });
        get().recalculateCollisions();
      },

      setAmp: (amp) => {
        set((state) => {
          state.amp = amp;
          state.isDirty = true;
          // If amp doesn't have effects loop, disable loop options
          if (!amp?.hasEffectsLoop) {
            state.useEffectsLoop = false;
            state.use4CableMethod = false;
          }
        });
        get().recalculateSignalChain();
      },

      setName: (name) => {
        set((state) => {
          state.name = name;
          state.isDirty = true;
        });
      },

      setDescription: (description) => {
        set((state) => {
          state.description = description;
          state.isDirty = true;
        });
      },

      setUseEffectsLoop: (use) => {
        set((state) => {
          state.useEffectsLoop = use;
          state.isDirty = true;
          if (!use) {
            state.use4CableMethod = false;
          }
        });
        get().recalculateSignalChain();
      },

      setUse4CableMethod: (use) => {
        set((state) => {
          state.use4CableMethod = use;
          state.isDirty = true;
          if (use) {
            state.useEffectsLoop = true;
          }
        });
        get().recalculateSignalChain();
      },

      addPedal: (pedal, position) => {
        set((state) => {
          // Add pedal with temporary chain position (will be recalculated by signal chain engine)
          const newPlacedPedal: PlacedPedal = {
            id: generateId(),
            configurationId: state.id || '',
            pedalId: pedal.id,
            xInches: position.x,
            yInches: position.y,
            rotationDegrees: 0,
            chainPosition: state.placedPedals.length + 1,
            location: pedal.preferredLocation || 'front_of_amp',
            isActive: true,
            createdAt: new Date().toISOString(),
            pedal,
          };

          state.placedPedals.push(newPlacedPedal);
          state.pedalsById[pedal.id] = pedal;
          state.isDirty = true;
        });

        get().recalculateCollisions();
        get().recalculateSignalChain();
      },

      movePedal: (placedPedalId, position) => {
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            // Constrain to board bounds
            const board = state.board;
            const pedalData = state.pedalsById[pedal.pedalId];
            if (board && pedalData) {
              const isRotated = pedal.rotationDegrees === 90 || pedal.rotationDegrees === 270;
              const width = isRotated ? pedalData.depthInches : pedalData.widthInches;
              const depth = isRotated ? pedalData.widthInches : pedalData.depthInches;

              pedal.xInches = Math.max(0, Math.min(position.x, board.widthInches - width));
              pedal.yInches = Math.max(0, Math.min(position.y, board.depthInches - depth));
            } else {
              pedal.xInches = position.x;
              pedal.yInches = position.y;
            }
            state.isDirty = true;
          }
        });

        get().recalculateCollisions();
        get().recalculateCables();
      },

      removePedal: (placedPedalId) => {
        set((state) => {
          const index = state.placedPedals.findIndex((p) => p.id === placedPedalId);
          if (index !== -1) {
            state.placedPedals.splice(index, 1);
            state.isDirty = true;
          }
        });

        get().recalculateCollisions();
        get().recalculateSignalChain();
      },

      rotatePedal: (placedPedalId) => {
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.rotationDegrees = (pedal.rotationDegrees + 90) % 360;
            state.isDirty = true;
          }
        });

        get().recalculateCollisions();
      },

      updatePedalChainPosition: (placedPedalId, newPosition) => {
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            const oldPosition = pedal.chainPosition;

            if (newPosition > oldPosition) {
              // Moving down in chain
              state.placedPedals.forEach((p) => {
                if (p.chainPosition > oldPosition && p.chainPosition <= newPosition) {
                  p.chainPosition -= 1;
                }
              });
            } else {
              // Moving up in chain
              state.placedPedals.forEach((p) => {
                if (p.chainPosition >= newPosition && p.chainPosition < oldPosition) {
                  p.chainPosition += 1;
                }
              });
            }

            pedal.chainPosition = newPosition;
            state.isDirty = true;
          }
        });

        // Recalculate warnings after manual reorder (but don't auto-reorder again)
        get().recalculateCables();
      },

      updatePedalLocation: (placedPedalId, location) => {
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.location = location;
            state.isDirty = true;
          }
        });

        get().recalculateSignalChain();
      },

      recalculateCollisions: () => {
        const { board, placedPedals, pedalsById } = get();
        if (!board) {
          set({ collisions: [] });
          return;
        }

        const collisions = detectCollisions(placedPedals, pedalsById, board);
        set({ collisions });
      },

      recalculateCables: () => {
        const { board, placedPedals, pedalsById, amp, useEffectsLoop, routingConfig } = get();

        if (!board || placedPedals.length === 0) {
          set({ cables: [] });
          return;
        }

        const cableConnections = calculateCables(
          placedPedals,
          pedalsById,
          board,
          amp,
          useEffectsLoop,
          routingConfig
        );

        // Convert to Cable type with generated IDs
        const cables: Cable[] = cableConnections.map((c, index) => ({
          id: `cable-${index}`,
          configurationId: get().id || '',
          fromType: c.fromType,
          fromPedalId: c.fromPedalId,
          fromJack: c.fromJackType,
          toType: c.toType,
          toPedalId: c.toPedalId,
          toJack: c.toJackType,
          calculatedLengthInches: c.calculatedLengthInches,
          cableType: c.cableType,
          sortOrder: c.sortOrder,
          createdAt: new Date().toISOString(),
        }));

        set({ cables });
      },

      recalculateSignalChain: () => {
        const { placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod } = get();

        if (placedPedals.length === 0) {
          set({ warnings: [], suggestions: [] });
          return;
        }

        const context: ChainContext = {
          ampHasEffectsLoop: amp?.hasEffectsLoop || false,
          useEffectsLoop,
          use4CableMethod,
          loopType: amp?.loopType,
        };

        const result = signalChainEngine.calculate(placedPedals, pedalsById, context);

        set((state) => {
          // Update placed pedals with new chain positions and locations
          state.placedPedals = result.orderedPedals;
          state.warnings = result.warnings;
          state.suggestions = result.suggestions;
        });

        // Recalculate cables after chain update
        get().recalculateCables();
      },

      setPedalRoutingMode: (placedPedalId, mode, loopPedalIds = []) => {
        set((state) => {
          const existingIndex = state.routingConfig.pedalConfigs.findIndex(
            (c) => c.pedalId === placedPedalId
          );

          const newConfig: PedalRoutingConfig = {
            pedalId: placedPedalId,
            mode,
            loopPedalIds,
          };

          if (existingIndex >= 0) {
            state.routingConfig.pedalConfigs[existingIndex] = newConfig;
          } else {
            state.routingConfig.pedalConfigs.push(newConfig);
          }
          state.isDirty = true;
        });
        get().recalculateCables();
      },

      togglePedalInLoop: (loopPedalId, targetPedalId) => {
        set((state) => {
          let config = state.routingConfig.pedalConfigs.find(
            (c) => c.pedalId === loopPedalId
          );

          if (!config) {
            config = {
              pedalId: loopPedalId,
              mode: 'loop',
              loopPedalIds: [],
            };
            state.routingConfig.pedalConfigs.push(config);
          }

          const index = config.loopPedalIds.indexOf(targetPedalId);
          if (index >= 0) {
            config.loopPedalIds.splice(index, 1);
          } else {
            config.loopPedalIds.push(targetPedalId);
          }

          // Set mode to loop if we have pedals in loop
          if (config.loopPedalIds.length > 0) {
            config.mode = 'loop';
          } else {
            config.mode = 'standard';
          }

          state.isDirty = true;
        });
        get().recalculateCables();
      },

      optimizeLayout: () => {
        const { board, placedPedals, pedalsById, routingConfig, useEffectsLoop } = get();

        if (!board || placedPedals.length === 0) return;

        // Calculate optimal positions - pass useEffectsLoop in routingConfig
        const optimalPlacements = calculateOptimalLayout(
          placedPedals,
          pedalsById,
          board,
          { ...routingConfig, useEffectsLoop }
        );

        // Apply the new positions
        set((state) => {
          for (const placement of optimalPlacements) {
            const pedal = state.placedPedals.find((p) => p.id === placement.id);
            if (pedal) {
              pedal.xInches = placement.x;
              pedal.yInches = placement.y;
            }
          }
          state.isDirty = true;
        });

        // Recalculate everything
        get().recalculateCollisions();
        get().recalculateCables();
      },

      markClean: () => {
        set({ isDirty: false });
      },

      setSaving: (saving) => {
        set({ isSaving: saving });
      },
    }))
  )
);
