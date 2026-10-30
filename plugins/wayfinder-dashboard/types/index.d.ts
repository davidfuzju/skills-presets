/** What the pane is looking at: which map, and which recorded version of it. */
export type View = {
  effort: string | null
  /** Index into the map's history; null follows the latest change. */
  index: number | null
  /** Bumped by the replay button so the change highlights pulse again. */
  replay: number
}

declare module 'claude-code' {
  interface PluginState {
    'wayfinder-dashboard': { view: Shaped<View>; rev: Shaped<number> }
  }
}
