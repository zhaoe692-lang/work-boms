import { describe, expect, it } from "vitest";
import { formatInvokeError } from "./invokeError";
import type { MessageKey } from "./i18n";

const messages: Partial<Record<MessageKey, string>> = {
  "error.unknown": "unknown",
  "error.import.notDirectory": "not-dir",
  "error.import.missingManifest": "missing-manifest",
  "error.import.obsidianVault": "obsidian",
  "error.import.obsidianEmpty": "obsidian-empty",
  "inspiration.conflictRetry": "conflict",
};

function t(key: MessageKey): string {
  return messages[key] ?? key;
}

describe("formatInvokeError", () => {
  it("maps stable error codes", () => {
    expect(formatInvokeError("error.import.missing_manifest", t)).toBe(
      "missing-manifest",
    );
    expect(formatInvokeError("error.import.obsidian_vault", t)).toBe("obsidian");
    expect(formatInvokeError("error.import.obsidian_empty", t)).toBe(
      "obsidian-empty",
    );
    expect(formatInvokeError("error.import.not_directory", t)).toBe("not-dir");
  });

  it("maps legacy Chinese strings", () => {
    expect(formatInvokeError("目录中缺少 manifest.json", t)).toBe(
      "missing-manifest",
    );
  });

  it("passes through unknown messages", () => {
    expect(formatInvokeError("some unexpected failure", t)).toBe(
      "some unexpected failure",
    );
  });
});
