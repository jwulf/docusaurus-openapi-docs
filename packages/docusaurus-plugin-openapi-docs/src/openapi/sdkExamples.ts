/* ============================================================================
 * Copyright (c) Palo Alto Networks
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * ========================================================================== */

import path from "path";

import fs from "fs-extra";

/**
 * Configuration for a single SDK example source.
 */
export interface SdkExampleSource {
  /** Language label shown in the code sample tab (e.g. "TypeScript", "Python", "C#"). */
  lang: string;
  /** Syntax highlight mode (e.g. "typescript", "python", "csharp"). */
  highlight?: string;
  /** Path to the operation-map.json file (relative to site root or absolute). */
  operationMapPath: string;
}

/**
 * A single entry in operation-map.json for one operationId.
 */
interface OperationMapEntry {
  file: string;
  region: string;
  label?: string;
}

/**
 * Shape of operation-map.json: operationId -> entries[].
 */
type OperationMap = Record<string, OperationMapEntry[]>;

// Region marker patterns for supported languages.
// Each pattern matches the start/end of a named region.
const REGION_PATTERNS: {
  start: RegExp;
  end: RegExp;
}[] = [
  // TypeScript/JavaScript: //#region Name  ...  //#endregion [Name]
  {
    start: /^\s*\/\/#region\s+(.+?)\s*$/,
    end: /^\s*\/\/#endregion(?:\s+(.+?))?\s*$/,
  },
  // C#: #region Name  ...  #endregion [Name]
  {
    start: /^\s*#region\s+(.+?)\s*$/,
    end: /^\s*#endregion(?:\s+(.+?))?\s*$/,
  },
  // XML-style: // <RegionName>  ...  // </RegionName>
  {
    start: /^\s*\/\/\s*<([A-Za-z]\w*)>\s*$/,
    end: /^\s*\/\/\s*<\/([A-Za-z]\w*)>\s*$/,
  },
  // Python: # region Name  ...  # endregion [Name]
  {
    start: /^\s*#\s*region\s+(.+?)\s*$/,
    end: /^\s*#\s*endregion(?:\s+(.+?))?\s*$/,
  },
];

/**
 * Extract the code between region markers from a source file's content.
 * Returns the trimmed code block or undefined if the region is not found.
 */
function extractRegion(
  content: string,
  regionName: string
): string | undefined {
  const lines = content.split(/\r?\n/);
  let capturing = false;
  let capturedLines: string[] = [];

  for (const line of lines) {
    if (capturing) {
      // Check if this line is an end marker for our region
      for (const pattern of REGION_PATTERNS) {
        const endMatch = line.match(pattern.end);
        if (
          endMatch &&
          (!endMatch[1] || endMatch[1].trim() === regionName)
        ) {
          // Found end marker — return captured content
          return trimIndentation(capturedLines);
        }
      }
      capturedLines.push(line);
    } else {
      // Check if this line is a start marker for our region
      for (const pattern of REGION_PATTERNS) {
        const startMatch = line.match(pattern.start);
        if (startMatch && startMatch[1].trim() === regionName) {
          capturing = true;
          capturedLines = [];
          break;
        }
      }
    }
  }

  return undefined;
}

/**
 * Remove the common leading whitespace from all non-empty lines.
 */
function trimIndentation(lines: string[]): string {
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return "";

  const minIndent = Math.min(
    ...nonEmptyLines.map((l) => {
      const match = l.match(/^(\s*)/);
      return match ? match[1].length : 0;
    })
  );

  return lines
    .map((l) => (l.trim().length === 0 ? "" : l.slice(minIndent)))
    .join("\n")
    .trim();
}

/**
 * Build x-codeSamples entries for a given operationId from all configured SDK sources.
 *
 * @param operationId - The OpenAPI operationId to look up.
 * @param sdkExamples - Array of SDK example source configurations.
 * @param siteDir - The Docusaurus site root directory (for resolving relative paths).
 * @param fileCache - Shared cache to avoid re-reading the same source files.
 * @param mapCache - Shared cache for parsed operation-map.json files.
 * @returns Array of x-codeSamples entries, or empty array if none found.
 */
export function buildCodeSamples(
  operationId: string,
  sdkExamples: SdkExampleSource[],
  siteDir: string,
  fileCache: Map<string, string>,
  mapCache: Map<string, OperationMap>
): { lang: string; label: string; source: string }[] {
  const samples: { lang: string; label: string; source: string }[] = [];

  for (const sdk of sdkExamples) {
    const mapPath = path.resolve(siteDir, sdk.operationMapPath);
    let operationMap = mapCache.get(mapPath);
    if (!operationMap) {
      if (!fs.existsSync(mapPath)) {
        console.warn(`SDK examples: operation-map not found at ${mapPath}`);
        continue;
      }
      operationMap = fs.readJSONSync(mapPath) as OperationMap;
      mapCache.set(mapPath, operationMap);
    }

    const entries = operationMap[operationId];
    if (!entries || entries.length === 0) continue;

    const mapDir = path.dirname(mapPath);

    for (const entry of entries) {
      const filePath = path.resolve(mapDir, entry.file);
      let fileContent = fileCache.get(filePath);
      if (fileContent === undefined) {
        if (!fs.existsSync(filePath)) {
          console.warn(
            `SDK examples: source file not found at ${filePath} (referenced by ${sdk.lang} operation-map for ${operationId})`
          );
          continue;
        }
        fileContent = fs.readFileSync(filePath, "utf-8");
        fileCache.set(filePath, fileContent);
      }

      const code = extractRegion(fileContent, entry.region);
      if (!code) {
        console.warn(
          `SDK examples: region "${entry.region}" not found in ${filePath} (${sdk.lang}, ${operationId})`
        );
        continue;
      }

      samples.push({
        lang: sdk.lang,
        label: "SDK",
        source: code,
      });
    }
  }

  return samples;
}
