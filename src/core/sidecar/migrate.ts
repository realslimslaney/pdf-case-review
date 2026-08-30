// Version chain for sidecar files. Each step upgrades the raw JSON from one version to the next;
// `validateSidecar` then checks the result. Newer files than this build understands are refused
// rather than silently reduced.

import { SIDECAR_VERSION } from "./types";
import { SidecarError } from "./validate";

type MigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version a step upgrades from. Empty while version 1 is current. */
const STEPS: ReadonlyMap<number, MigrationStep> = new Map();

export interface MigrationResult {
  value: unknown;
  migrated: boolean;
  fromVersion: number;
}

export function migrateSidecar(raw: unknown): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SidecarError("", "expected an object");
  }
  let current = raw as Record<string, unknown>;
  const version = current["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new SidecarError("version", "expected an integer");
  }
  if (version > SIDECAR_VERSION) {
    throw new SidecarError(
      "version",
      `version ${version} is newer than this extension supports (${SIDECAR_VERSION}); update PDF Case Review`,
    );
  }
  let at = version;
  while (at < SIDECAR_VERSION) {
    const step = STEPS.get(at);
    if (!step) {
      throw new SidecarError("version", `no migration from version ${at}`);
    }
    current = { ...step(current), version: at + 1 };
    at += 1;
  }
  return { value: current, migrated: at !== version, fromVersion: version };
}
