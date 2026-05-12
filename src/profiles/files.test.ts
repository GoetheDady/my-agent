import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { applyProfileFileUpdates, loadProfileContext } from "./files";

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "my-agent-profile-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("profile files", () => {
  test("creates default soul and user files when missing", () => {
    withTempDir((dir) => {
      const context = loadProfileContext({
        profileRootDir: dir,
        agentId: "default",
        userId: "default",
      });

      expect(context.soul).toContain("Agent Soul");
      expect(context.user).toContain("User Profile");
      expect(context.files.map((file) => file.kind)).toEqual(["soul", "user"]);
    });
  });

  test("loads existing user-editable files", () => {
    withTempDir((dir) => {
      const soulPath = join(dir, "agents", "default", "soul.md");
      const userPath = join(dir, "agents", "default", "user.md");
      loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });
      writeFileSync(soulPath, "# soul\nUse concise replies.", "utf8");
      writeFileSync(userPath, "# user\nCall the user 戈德斯文.", "utf8");

      const context = loadProfileContext({
        profileRootDir: dir,
        agentId: "default",
        userId: "default",
      });

      expect(context.soul).toContain("Use concise replies.");
      expect(context.user).toContain("戈德斯文");
    });
  });

  test("updates markdown sections without duplicating equivalent bullets", () => {
    withTempDir((dir) => {
      loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });

      const first = applyProfileFileUpdates({
        profileRootDir: dir,
        agentId: "default",
        userId: "default",
        userUpdates: [{
          section: "Identity",
          bullet: "name: 张三",
          replaceMatching: [/^-\s*name\s*[:：]/],
        }],
        soulUpdates: [{
          section: "Operating Principles",
          bullet: "修改记忆系统时，要同步更新计划文档。",
        }],
      });
      const second = applyProfileFileUpdates({
        profileRootDir: dir,
        agentId: "default",
        userId: "default",
        userUpdates: [{
          section: "Identity",
          bullet: "name: 张三",
          replaceMatching: [/^-\s*name\s*[:：]/],
        }],
        soulUpdates: [{
          section: "Operating Principles",
          bullet: "修改记忆系统时，要同步更新计划文档。",
        }],
      });

      const context = loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });
      expect(first.map((update) => update.kind)).toEqual(["soul", "user"]);
      expect(second).toEqual([]);
      expect(context.user?.match(/name: 张三/g)).toHaveLength(1);
      expect(context.soul?.match(/同步更新计划文档/g)).toHaveLength(1);
    });
  });

  test("migrates legacy profile files into the agent directory root", () => {
    withTempDir((dir) => {
      const legacySoulPath = join(dir, "profiles", "agents", "default", "soul.md");
      const legacyUserPath = join(dir, "profiles", "users", "default", "user.md");
      mkdirSync(join(dir, "profiles", "agents", "default"), { recursive: true });
      mkdirSync(join(dir, "profiles", "users", "default"), { recursive: true });
      writeFileSync(legacySoulPath, "# legacy soul\nBe direct.", "utf8");
      writeFileSync(legacyUserPath, "# legacy user\nCall user 张三.", "utf8");

      const context = loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });

      expect(context.soul).toContain("Be direct.");
      expect(context.user).toContain("张三");
      expect(existsSync(legacySoulPath)).toBe(false);
      expect(existsSync(legacyUserPath)).toBe(false);
      expect(readFileSync(join(dir, "agents", "default", "soul.md"), "utf8")).toContain("Be direct.");
      expect(readFileSync(join(dir, "agents", "default", "user.md"), "utf8")).toContain("张三");
      expect(existsSync(join(dir, "profiles"))).toBe(false);
    });
  });
});
