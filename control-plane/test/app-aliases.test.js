import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenAppTarget } from "../src/domain/app-aliases.js";

test("Windows resolves human app names to launch targets", () => {
  assert.equal(resolveOpenAppTarget("Visual Studio Code", "win32"), "code");
  assert.equal(resolveOpenAppTarget("открой вс код", "win32"), "code");
  assert.equal(resolveOpenAppTarget("Google Chrome", "win32"), "chrome");
  assert.equal(resolveOpenAppTarget("Блокнот", "win32"), "notepad");
  // Unknown app stays as-is.
  assert.equal(resolveOpenAppTarget("MyCustomApp", "win32"), "MyCustomApp");
});

test("macOS keeps display names for open -a", () => {
  assert.equal(resolveOpenAppTarget("Visual Studio Code", "darwin"), "Visual Studio Code");
  assert.equal(resolveOpenAppTarget("chrome", "darwin"), "Google Chrome");
});

test("empty/unknown platform tolerated", () => {
  assert.equal(resolveOpenAppTarget("", "win32"), "");
  assert.equal(resolveOpenAppTarget("Spotify", "linux"), "Spotify");
});
