/*
 * Feature flags for whole surfaces that are parked but not removed.
 *
 * DESIGN_PANE — the Design pane (Part 17, DP-0..DP-2 shipped through e084fa3)
 * was parked on 2026-10-14 so the Runs program (Part 18) could go first. Its
 * code stays in the tree and unreachable: no rail button, no pane in the ⌘J
 * cycle, no Setup rows, and the design plugin is no longer assembled or
 * bundled. Flip this back to true to bring the pane back as it was.
 */
export const DESIGN_PANE = false;
