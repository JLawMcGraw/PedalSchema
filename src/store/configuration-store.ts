import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Board, Pedal, Amp, PlacedPedal, Position, ChainLocation, ChainContext, RoutingConfig, PedalRoutingConfig } from '@/types';
import { signalChainEngine } from '@/lib/engine/signal-chain';
import { runOptimize } from '@/lib/engine/layout/run-optimize';
import { summarizeOptimization, type OptimizationSummary } from '@/lib/engine/layout/routing-cost';
import { rotatedFootprint } from '@/lib/engine/geometry/rotation';
import { isLargePedal } from '@/lib/engine/layout/rotation-eligibility';

/**
 * Undo/redo snapshot of everything a board-editing action can change.
 * Snapshots hold references to immer-frozen state (structural sharing),
 * so recording history is O(1) - nothing is cloned.
 */
interface HistorySnapshot {
  board: Board | null;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  routingConfig: RoutingConfig;
}

const HISTORY_LIMIT = 50;

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
  /** When true, modulation pedals go in effects loop for cleaner sound */
  modulationInLoop: boolean;

  // Pedals on the board
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>; // cache of full pedal data

  // Routing configuration
  routingConfig: RoutingConfig;

  // Undo/redo history (board edits only; name/description excluded)
  history: { past: HistorySnapshot[]; future: HistorySnapshot[] };

  /**
   * What the last optimizeLayout() traded off, for display next to the
   * Optimize button. Null when nothing has been optimized this session or
   * the summary was dismissed. Deliberately NOT in HistorySnapshot: it
   * describes an action, not board state, so undo should not restore it.
   */
  lastOptimization: OptimizationSummary | null;

  // Dirty state
  isDirty: boolean;
  isSaving: boolean;
  /** True while an optimize run is in flight (it now runs in a worker). */
  isOptimizing: boolean;
  /**
   * Why the last save failed, or null if it did not. The board stays dirty
   * either way, but "dirty" alone cannot tell the user whether they simply
   * have not saved yet or whether saving is FAILING - a distinction that was
   * invisible outside the browser console until a save error was seen in the
   * wild that printed as `{}`.
   */
  saveError: string | null;

  // Actions
  initConfiguration: (config: {
    id?: string;
    name: string;
    description?: string;
    board: Board;
    amp?: Amp | null;
    useEffectsLoop?: boolean;
    use4CableMethod?: boolean;
    modulationInLoop?: boolean;
    placedPedals?: PlacedPedal[];
    pedalsById?: Record<string, Pedal>;
    /**
     * Pedal-loop wiring and the rotation toggle, as stored. The
     * useEffectsLoop / use4CableMethod flags above stay authoritative - they
     * have their own columns - so whatever this carries for them is ignored.
     */
    routingConfig?: Partial<RoutingConfig>;
  }) => void;

  setBoard: (board: Board) => void;
  setAmp: (amp: Amp | null) => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setUseEffectsLoop: (use: boolean) => void;
  setUse4CableMethod: (use: boolean) => void;
  setAllowRotation: (allow: boolean) => void;
  setModulationInLoop: (inLoop: boolean) => void;

  addPedal: (pedal: Pedal, position: Position) => void;
  movePedal: (placedPedalId: string, position: Position) => void;
  removePedal: (placedPedalId: string) => void;
  rotatePedal: (placedPedalId: string) => void;
  updatePedalChainPosition: (placedPedalId: string, newPosition: number) => void;
  setChainPositionLocked: (placedPedalId: string, locked: boolean) => void;
  setRotationLocked: (placedPedalId: string, locked: boolean) => void;
  updatePedalLocation: (placedPedalId: string, location: ChainLocation) => void;
  setUseLoop: (placedPedalId: string, useLoop: boolean) => void;

  /**
   * Run the signal chain rules engine and write back normalized
   * chainPosition/location (respecting locked pedals). Call after
   * chain-affecting mutations only. Everything else (cables, collisions,
   * warnings) is DERIVED - see src/store/derived.ts.
   */
  normalizeChain: () => void;

  // Routing actions
  setPedalRoutingMode: (placedPedalId: string, mode: 'standard' | 'loop', loopPedalIds?: string[]) => void;
  togglePedalInLoop: (loopPedalId: string, targetPedalId: string) => void;

  // Layout optimization
  optimizeLayout: () => Promise<void>;
  dismissOptimizationSummary: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;

  markClean: () => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (message: string | null) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

export const useConfigurationStore = create<ConfigurationState>()(
  subscribeWithSelector(
    immer((set, get) => {
      const takeSnapshot = (): HistorySnapshot => {
        const s = get();
        return {
          board: s.board,
          amp: s.amp,
          useEffectsLoop: s.useEffectsLoop,
          use4CableMethod: s.use4CableMethod,
          modulationInLoop: s.modulationInLoop,
          placedPedals: s.placedPedals,
          pedalsById: s.pedalsById,
          routingConfig: s.routingConfig,
        };
      };

      /** Call at the START of every user-initiated board mutation. */
      const recordHistory = () => {
        const snapshot = takeSnapshot();
        set((state) => {
          state.history.past.push(snapshot);
          if (state.history.past.length > HISTORY_LIMIT) {
            state.history.past.shift();
          }
          state.history.future = [];
        });
      };

      const applySnapshot = (
        state: { -readonly [K in keyof HistorySnapshot]: HistorySnapshot[K] },
        snapshot: HistorySnapshot
      ) => {
        state.board = snapshot.board;
        state.amp = snapshot.amp;
        state.useEffectsLoop = snapshot.useEffectsLoop;
        state.use4CableMethod = snapshot.use4CableMethod;
        state.modulationInLoop = snapshot.modulationInLoop;
        state.placedPedals = snapshot.placedPedals;
        state.pedalsById = snapshot.pedalsById;
        state.routingConfig = snapshot.routingConfig;
      };

      return {
      id: null,
      name: 'Untitled Board',
      description: '',
      board: null,
      amp: null,
      useEffectsLoop: false,
      use4CableMethod: false,
      modulationInLoop: false,
      placedPedals: [],
      pedalsById: {},
      routingConfig: {
        useLoopPedals: true,
        use4CableMethod: false,
        pedalConfigs: [],
      },
      history: { past: [], future: [] },
      lastOptimization: null,
      isDirty: false,
      isSaving: false,
      isOptimizing: false,
      saveError: null,

      initConfiguration: (config) => {
        set((state) => {
          state.id = config.id || null;
          state.name = config.name;
          state.description = config.description || '';
          state.board = config.board;
          state.amp = config.amp || null;
          state.useEffectsLoop = config.useEffectsLoop || false;
          state.use4CableMethod = config.use4CableMethod || false;
          state.modulationInLoop = config.modulationInLoop || false;
          state.placedPedals = config.placedPedals || [];
          state.pedalsById = config.pedalsById || {};
          // Stored pedal-loop wiring. The two flags that have their own
          // columns are re-applied from those, never from this JSON, so the
          // column and the blob cannot drift into disagreeing.
          state.routingConfig = {
            useLoopPedals: config.routingConfig?.useLoopPedals ?? true,
            pedalConfigs: config.routingConfig?.pedalConfigs ?? [],
            ...(config.routingConfig?.allowRotation !== undefined
              ? { allowRotation: config.routingConfig.allowRotation }
              : {}),
            useEffectsLoop: config.useEffectsLoop || false,
            use4CableMethod: config.use4CableMethod || false,
          };
          state.history = { past: [], future: [] };
          state.isDirty = false;
        });
        // Normalize chain order for the loaded configuration
        get().normalizeChain();
      },

      setBoard: (board) => {
        recordHistory();
        set((state) => {
          state.board = board;
          state.isDirty = true;
        });
      },

      setAmp: (amp) => {
        recordHistory();
        set((state) => {
          state.amp = amp;
          state.isDirty = true;
          // If amp doesn't have effects loop, disable loop options
          if (!amp?.hasEffectsLoop) {
            state.useEffectsLoop = false;
            state.use4CableMethod = false;
          }
        });
        get().normalizeChain();
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
        recordHistory();
        set((state) => {
          state.useEffectsLoop = use;
          state.isDirty = true;
          if (!use) {
            state.use4CableMethod = false;
          }
        });
        get().normalizeChain();
      },

      setUse4CableMethod: (use) => {
        recordHistory();
        set((state) => {
          state.use4CableMethod = use;
          state.isDirty = true;
          if (use) {
            state.useEffectsLoop = true;
          }
        });
        get().normalizeChain();
      },

      setAllowRotation: (allow) => {
        recordHistory();
        set((state) => {
          state.routingConfig.allowRotation = allow;
          state.isDirty = true;
        });
        // No normalizeChain: this changes what Optimize may do, not the signal
        // chain. Nothing moves until the next Optimize.
      },

      setModulationInLoop: (inLoop) => {
        recordHistory();
        set((state) => {
          state.modulationInLoop = inLoop;
          state.isDirty = true;
          // Modulation in loop requires effects loop to be enabled
          if (inLoop) {
            state.useEffectsLoop = true;
          }
        });
        get().normalizeChain();
      },

      addPedal: (pedal, position) => {
        recordHistory();
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
            // Big pedals arrive protected from Optimize turning them. A guess
            // at what you would want, offered as a default you can override
            // per pedal - not a rule, which is what the old width veto was.
            rotationLocked: isLargePedal(pedal),
            isActive: true,
            useLoop: false, // Default to not using loop (user must enable)
            createdAt: new Date().toISOString(),
            pedal,
          };

          state.placedPedals.push(newPlacedPedal);
          state.pedalsById[pedal.id] = pedal;
          state.isDirty = true;
        });

        get().normalizeChain();
      },

      movePedal: (placedPedalId, position) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            // Constrain to board bounds
            const board = state.board;
            const pedalData = state.pedalsById[pedal.pedalId];
            if (board && pedalData) {
              const { widthInches: width, depthInches: depth } = rotatedFootprint(
                pedalData,
                pedal.rotationDegrees
              );

              pedal.xInches = Math.max(0, Math.min(position.x, board.widthInches - width));
              pedal.yInches = Math.max(0, Math.min(position.y, board.depthInches - depth));
            } else {
              pedal.xInches = position.x;
              pedal.yInches = position.y;
            }
            state.isDirty = true;
          }
        });

      },

      removePedal: (placedPedalId) => {
        recordHistory();
        set((state) => {
          const index = state.placedPedals.findIndex((p) => p.id === placedPedalId);
          if (index !== -1) {
            state.placedPedals.splice(index, 1);
            state.isDirty = true;
          }
        });

        get().normalizeChain();
      },

      rotatePedal: (placedPedalId) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.rotationDegrees = (pedal.rotationDegrees + 90) % 360;
            state.isDirty = true;
          }
        });

      },

      updatePedalChainPosition: (placedPedalId, newPosition) => {
        recordHistory();
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
            // Pin the pedal so signal chain rules won't reorder it on the
            // next recalculation (persisted as chain_position_locked)
            pedal.chainPositionLocked = true;
            state.isDirty = true;
          }
        });

      },

      setChainPositionLocked: (placedPedalId, locked) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.chainPositionLocked = locked;
            state.isDirty = true;
          }
        });

        // Unlocking hands the pedal back to the rules engine
        if (!locked) {
          get().normalizeChain();
        }
      },

      setRotationLocked: (placedPedalId, locked) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.rotationLocked = locked;
            /*
             * Locking FACES THE PEDAL FORWARD, it does not merely stop the
             * optimizer turning it later.
             *
             * The toggle is labelled "Keep facing forward", and it used to
             * leave an already-turned pedal exactly where it was. Worse, the
             * obvious recovery did nothing either: a locked pedal is excluded
             * from the rotation search, so re-running Optimize could not put
             * it back - it kept whatever angle it already had, forever. The
             * control named the state it was supposed to produce and then did
             * not produce it.
             *
             * Undo restores the angle, so a deliberate manual rotation is not
             * lost, just reversible.
             */
            if (locked) pedal.rotationDegrees = 0;
            state.isDirty = true;
          }
        });
        // Unlocking changes nothing on its own - it only means the NEXT
        // Optimize is allowed to consider this pedal again.
      },

      updatePedalLocation: (placedPedalId, location) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.location = location;
            // Mark as manually overridden so signal chain rules don't auto-assign
            pedal.locationOverride = true;
            state.isDirty = true;
          }
        });

        get().normalizeChain();
      },

      setUseLoop: (placedPedalId, useLoop) => {
        recordHistory();
        set((state) => {
          const pedal = state.placedPedals.find((p) => p.id === placedPedalId);
          if (pedal) {
            pedal.useLoop = useLoop;
            state.isDirty = true;
          }
        });
      },

      normalizeChain: () => {
        const { placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod, modulationInLoop, routingConfig } = get();

        if (placedPedals.length === 0) return;

        const context: ChainContext = {
          ampHasEffectsLoop: amp?.hasEffectsLoop || false,
          useEffectsLoop,
          use4CableMethod,
          modulationInLoop,
          loopType: amp?.loopType,
        };

        // routingConfig carries the pedal-loop wiring, which decides whether a
        // hub must be ordered before its members - see the engine's step 3a.
        const result = signalChainEngine.calculate(placedPedals, pedalsById, context, routingConfig);

        set((state) => {
          // Write back normalized chain positions and locations.
          // Cables, collisions, and warnings are derived from this
          // (src/store/derived.ts) - nothing else to update.
          state.placedPedals = result.orderedPedals;
        });
      },

      setPedalRoutingMode: (placedPedalId, mode, loopPedalIds = []) => {
        recordHistory();
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
      },

      togglePedalInLoop: (loopPedalId, targetPedalId) => {
        recordHistory();
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
      },

      optimizeLayout: async () => {
        const { board, placedPedals, pedalsById, routingConfig, useEffectsLoop, use4CableMethod, isOptimizing } = get();

        if (!board || placedPedals.length === 0) return;
        // A second click while one run is in flight would race two results onto
        // the same board, and the loser would still push an undo entry.
        if (isOptimizing) return;

        // Undo must capture the board as it was BEFORE the run, and must be
        // recorded on this thread while that is still what the board looks like.
        recordHistory();
        set({ isOptimizing: true });

        // What the board looked like when the run started. If any of it changes
        // while the worker is busy, the answer describes a board that no longer
        // exists and applying it would move the wrong pedals.
        const requestedFor = placedPedals.map((p) => p.id).join(',');

        let result;
        try {
          result = await runOptimize({
            placedPedals,
            pedalsById,
            board,
            routingConfig: { ...routingConfig, useEffectsLoop, use4CableMethod },
          });
        } catch (error) {
          console.error('[optimizeLayout] failed:', error);
          set({ isOptimizing: false });
          return;
        }
        set({ isOptimizing: false });

        const current = get().placedPedals;
        if (current.map((p) => p.id).join(',') !== requestedFor) {
          console.warn('[optimizeLayout] board changed while optimizing - result discarded');
          return;
        }

        // Validate chain order integrity before applying
        const validateChainOrder = (chainOrder: string[], pedals: PlacedPedal[]): boolean => {
          // Check all IDs in chainOrder exist in placedPedals
          const pedalIds = new Set(pedals.map(p => p.id));
          for (const id of chainOrder) {
            if (!pedalIds.has(id)) {
              console.warn(`[optimizeLayout] Chain order contains unknown pedal ID: ${id}`);
              return false;
            }
          }

          // Check chainOrder has correct length
          if (chainOrder.length !== pedals.length) {
            console.warn(`[optimizeLayout] Chain order length mismatch: ${chainOrder.length} vs ${pedals.length}`);
            return false;
          }

          // Check for duplicates in chainOrder
          const uniqueIds = new Set(chainOrder);
          if (uniqueIds.size !== chainOrder.length) {
            console.warn(`[optimizeLayout] Chain order contains duplicates`);
            return false;
          }

          return true;
        };

        const chainOrderValid = validateChainOrder(result.chainOrder, placedPedals);

        // Apply the new positions and chain order
        set((state) => {
          // Apply position changes
          for (const placement of result.placements) {
            const pedal = state.placedPedals.find((p) => p.id === placement.id);
            if (pedal) {
              pedal.xInches = placement.x;
              pedal.yInches = placement.y;
            }
          }

          // Apply rotation changes (jack-facing optimization)
          for (const rotation of result.rotations ?? []) {
            const pedal = state.placedPedals.find((p) => p.id === rotation.id);
            if (pedal) {
              pedal.rotationDegrees = rotation.rotationDegrees;
            }
          }

          // Apply chain order changes only if valid and swappable groups exist
          if (chainOrderValid && result.swappableGroups.length > 0) {
            for (let i = 0; i < result.chainOrder.length; i++) {
              const pedal = state.placedPedals.find((p) => p.id === result.chainOrder[i]);
              if (pedal) {
                pedal.chainPosition = i + 1;
              }
            }
          }

          // What the optimizer traded off, derived from the same dimension
          // list that scored the layouts. Null when there is nothing to say.
          state.lastOptimization =
            result.baselineCost && result.cost
              ? summarizeOptimization(result.baselineCost, result.cost, result.noLegalCandidate)
              : null;

          state.isDirty = true;
        });

      },

      dismissOptimizationSummary: () => set((state) => { state.lastOptimization = null; }),

      undo: () => {
        const { history } = get();
        if (history.past.length === 0) return;
        const current = takeSnapshot();
        const previous = history.past[history.past.length - 1];
        set((state) => {
          state.history.past.pop();
          state.history.future.push(current);
          applySnapshot(state, previous);
          state.isDirty = true;
        });
      },

      redo: () => {
        const { history } = get();
        if (history.future.length === 0) return;
        const current = takeSnapshot();
        const next = history.future[history.future.length - 1];
        set((state) => {
          state.history.future.pop();
          state.history.past.push(current);
          applySnapshot(state, next);
          state.isDirty = true;
        });
      },

      markClean: () => {
        // A save that worked also clears the last failure - otherwise the
        // banner outlives the problem it describes.
        set({ isDirty: false, saveError: null });
      },

      setSaving: (saving) => {
        set({ isSaving: saving });
      },

      setSaveError: (message) => {
        set({ saveError: message });
      },
      };
    })
  )
);

// Debug helper: load a repro snapshot from the browser console.
// Usage: fetch('/repro/repro-state.json').then(r => r.json()).then(s => window.__loadPedalSchemaRepro(s))
if (typeof window !== 'undefined') {
  type ReproSnapshot = Parameters<ConfigurationState['initConfiguration']>[0];
  (window as unknown as { __loadPedalSchemaRepro: (s: ReproSnapshot) => void }).__loadPedalSchemaRepro = (
    snapshot: ReproSnapshot
  ) => {
    useConfigurationStore.getState().initConfiguration(snapshot);
  };
}
