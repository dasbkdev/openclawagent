#!/usr/bin/env python3
"""Apply the Windows-2026.6.7 device-action deltas to the Starlab macOS source.

Run from apps/macos/Sources/OpenClaw on the Mac build tree. Idempotent-ish:
re-running after success is a no-op (anchors already consumed). Adds:
  - capabilities: play_youtube, minimize_window, minimize_all
  - executor cases + helpers for those three actions
"""
import sys

CAPS = "StarlabAgentClient.swift"
EXEC = "StarlabDeviceCommandExecutor.swift"

def edit(path, anchor, replacement, label):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    if replacement.strip() in src:
        print(f"  {label}: already applied, skipping")
        return
    n = src.count(anchor)
    if n != 1:
        print(f"  ERROR {label}: anchor found {n} times (expected 1)")
        sys.exit(1)
    src = src.replace(anchor, replacement, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"  {label}: applied")

# 1) capabilities
edit(
    CAPS,
    '    "mouse_click",\n]',
    '    "mouse_click",\n    "play_youtube",\n    "minimize_window",\n    "minimize_all",\n]',
    "capabilities",
)

# 2) executor switch cases (prepend before the ocr_screen case)
SWITCH_ANCHOR = '            case "ocr_screen", "openclaw_prompt":'
SWITCH_NEW = (
    '            case "play_youtube":\n'
    '                return .success(try await playYoutube(command.argsDictionary))\n'
    '            case "minimize_window":\n'
    '                return .success(try minimizeWindow())\n'
    '            case "minimize_all":\n'
    '                return .success(try minimizeAll())\n'
    + SWITCH_ANCHOR
)
edit(EXEC, SWITCH_ANCHOR, SWITCH_NEW, "switch-cases")

# 3) executor helpers (insert before runProcess)
HELPERS_ANCHOR = "    private static func runProcess("
HELPERS = r'''    private struct YoutubeVideo {
        let videoId: String
        let watchURL: String
    }

    private static func playYoutube(_ args: [String: StarlabJSONValue]) async throws -> [String: Any] {
        let query = try requiredString(args, names: ["query", "song", "title", "text", "target"], message: "play_youtube requires args.query")
        let video = try await resolveYoutubeVideo(query)
        guard let url = URL(string: video.watchURL), NSWorkspace.shared.open(url) else {
            throw commandError("Unable to open YouTube URL: \(video.watchURL)")
        }
        return [
            "query": query,
            "opened": video.watchURL,
            "resolvedVideoId": video.videoId,
            "attemptedPlay": true,
            "method": "youtube-direct-watch-default-browser",
        ]
    }

    private static func resolveYoutubeVideo(_ query: String) async throws -> YoutubeVideo {
        guard var components = URLComponents(string: "https://www.youtube.com/results") else {
            throw commandError("Invalid YouTube search URL")
        }
        components.queryItems = [URLQueryItem(name: "search_query", value: query)]
        guard let searchURL = components.url else {
            throw commandError("Invalid YouTube query")
        }
        var request = URLRequest(url: searchURL)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", forHTTPHeaderField: "User-Agent")
        request.setValue("ru,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw commandError("YouTube search failed")
        }
        let html = String(data: data, encoding: .utf8) ?? ""
        guard let videoId = firstYoutubeVideoId(in: html) else {
            throw commandError("YouTube did not return a playable video result")
        }
        guard var watch = URLComponents(string: "https://www.youtube.com/watch") else {
            throw commandError("Invalid YouTube watch URL")
        }
        watch.queryItems = [URLQueryItem(name: "v", value: videoId), URLQueryItem(name: "autoplay", value: "1")]
        guard let watchURL = watch.url?.absoluteString else {
            throw commandError("Unable to build YouTube watch URL")
        }
        return YoutubeVideo(videoId: videoId, watchURL: watchURL)
    }

    private static func firstYoutubeVideoId(in html: String) -> String? {
        let patterns = [
            "\"videoRenderer\":\\{\"videoId\":\"([A-Za-z0-9_-]{11})\"",
            "\"videoId\":\"([A-Za-z0-9_-]{11})\"",
        ]
        let range = NSRange(html.startIndex..., in: html)
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            if let match = regex.firstMatch(in: html, range: range), match.numberOfRanges > 1,
               let captured = Range(match.range(at: 1), in: html) {
                return String(html[captured])
            }
        }
        return nil
    }

    private static func minimizeWindow() throws -> [String: Any] {
        // Cmd+M miniaturises the frontmost window.
        try runProcess("/usr/bin/osascript", ["-e", "tell application \"System Events\" to keystroke \"m\" using command down"])
        return ["minimized": "window"]
    }

    private static func minimizeAll() throws -> [String: Any] {
        // Best-effort equivalent of Windows MinimizeAll: miniaturise every window
        // of every visible foreground app. Requires Accessibility permission.
        let script = "tell application \"System Events\"\nrepeat with proc in (every process whose visible is true and background only is false)\ntry\nrepeat with w in (every window of proc)\ntry\nset value of attribute \"AXMinimized\" of w to true\nend try\nend repeat\nend try\nend repeat\nend tell"
        try runProcess("/usr/bin/osascript", ["-e", script])
        return ["minimized": "all"]
    }

'''
edit(EXEC, HELPERS_ANCHOR, HELPERS + HELPERS_ANCHOR, "helpers")

print("done")
