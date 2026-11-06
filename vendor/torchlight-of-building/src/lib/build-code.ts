import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

import type { SaveData } from "./save-data";
import { parseVersionedSaveData } from "./schemas";

const BUILD_CODE_VERSION = 1;

interface VersionedLoadout {
  v: number;
  d: SaveData;
}

const toBase64Url = (data: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
};

const fromBase64Url = (str: string): Uint8Array => {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const encodeBuildCode = (loadout: SaveData): string => {
  const versioned: VersionedLoadout = { v: BUILD_CODE_VERSION, d: loadout };
  const json = JSON.stringify(versioned);
  const compressed = deflateSync(strToU8(json));
  return toBase64Url(compressed);
};

export const decodeBuildCode = (code: string): SaveData | null => {
  try {
    const compressed = fromBase64Url(code);
    const json = strFromU8(inflateSync(compressed));
    if (json === "") return null;

    const parsed = JSON.parse(json) as unknown;

    // Validate and parse using schema (Zod .catch() provides defaults)
    const saveData = parseVersionedSaveData(parsed);
    if (saveData === undefined) {
      return null;
    }

    return saveData;
  } catch (error) {
    console.error("Failed to decode build code:", error);
    return null;
  }
};
