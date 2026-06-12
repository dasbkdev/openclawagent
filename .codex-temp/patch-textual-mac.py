#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.home() / "agent/openclaw/apps/macos/.build/arm64/checkouts/textual/Sources/Textual"


def strip_previews(text: str) -> str:
    out: list[str] = []
    skipping = False
    depth = 0
    for line in text.splitlines(keepends=True):
        if not skipping and line.lstrip().startswith("#Preview"):
            while out and (out[-1].strip() == "" or out[-1].lstrip().startswith("@available")):
                out.pop()
            skipping = True
            depth = line.count("{") - line.count("}")
            if depth <= 0:
                skipping = False
            continue
        if skipping:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                skipping = False
            continue
        out.append(line)
    return "".join(out)


def cleanup_orphan_availability(text: str) -> str:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.lstrip().startswith("@available"):
            out.append(line)
            index += 1
            continue

        attrs: list[str] = []
        while index < len(lines) and lines[index].lstrip().startswith("@available"):
            attrs.append(lines[index])
            index += 1

        blank_start = index
        while index < len(lines) and lines[index].strip() == "":
            index += 1

        if blank_start != index or index >= len(lines):
            continue

        out.extend(attrs)
    return "".join(out)


ENTRY_RE = re.compile(
    r"^(?P<indent>\s*)(?:(?P<usable>@usableFromInline)\s+)?@Entry\s+var\s+"
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*(?P<type>[^=]+?))?\s*=\s*(?P<default>.+?)\s*$"
)


def infer_type(default: str) -> str:
    value = default.strip()
    if value.startswith("."):
        raise ValueError(f"cannot infer type from shorthand default {value!r}")
    constructor = re.match(r"([A-Za-z_][A-Za-z0-9_.<>]*)\s*\(", value)
    if constructor:
        return constructor.group(1)
    dotted = re.match(r"([A-Za-z_][A-Za-z0-9_.<>]*)\.", value)
    if dotted:
        return dotted.group(1)
    raise ValueError(f"cannot infer type from default {value!r}")


def key_name(name: str) -> str:
    return "__Textual" + "".join(part.capitalize() for part in name.split("_")) + "Key"


def patch_entries(text: str, path: Path) -> str:
    lines = text.splitlines()
    entries: list[tuple[str, str, str]] = []
    out: list[str] = []

    for line in lines:
        match = ENTRY_RE.match(line)
        if not match:
            out.append(line)
            continue

        name = match.group("name")
        typ = (match.group("type") or "").strip()
        default = match.group("default").strip()
        if not typ:
            typ = infer_type(default)

        entries.append((name, typ, default))
        indent = match.group("indent")
        key = key_name(name)
        out.extend(
            [
                f"{indent}var {name}: {typ} {{",
                f"{indent}  get {{ self[{key}.self] }}",
                f"{indent}  set {{ self[{key}.self] = newValue }}",
                f"{indent}}}",
            ]
        )

    if not entries:
        return "\n".join(out) + ("\n" if text.endswith("\n") else "")

    key_blocks = []
    for name, typ, default in entries:
        key = key_name(name)
        key_blocks.extend(
            [
                f"private struct {key}: EnvironmentKey {{",
                f"  static let defaultValue: {typ} = {default}",
                "}",
                "",
            ]
        )

    insert_at = next((i for i, line in enumerate(out) if line.lstrip().startswith("extension EnvironmentValues")), None)
    if insert_at is None:
        raise RuntimeError(f"{path}: @Entry found but no EnvironmentValues extension")

    out = out[:insert_at] + key_blocks + out[insert_at:]
    return "\n".join(out) + "\n"


def patch_concurrency(text: str) -> str:
    return re.sub(r"(?m)^(\s+)(?!nonisolated\(unsafe\)\s+)static let defaultValue", r"\1nonisolated(unsafe) static let defaultValue", text)


def main() -> None:
    patched = 0
    for path in ROOT.rglob("*.swift"):
        path.chmod(path.stat().st_mode | 0o200)
        original = path.read_text()
        text = strip_previews(original)
        text = cleanup_orphan_availability(text)
        text = patch_entries(text, path)
        text = patch_concurrency(text)
        if text != original:
            path.write_text(text)
            patched += 1
    print(f"textual patched files: {patched}")


if __name__ == "__main__":
    main()
