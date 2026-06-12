import plistlib
import json
import pathlib
p = pathlib.Path.home() / "Library/Preferences/com.starlab.openclaw.agent.plist"
obj = plistlib.load(open(p, "rb"))
raw = obj.get("starlab.agent.config.v1")
config = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
print(json.dumps({
    "activated": config.get("activated"),
    "user": config.get("user"),
    "agent": config.get("agent"),
    "lastHeartbeatAt": config.get("lastHeartbeatAt"),
    "lastCommandAt": config.get("lastCommandAt"),
    "lastHeartbeatError": config.get("lastHeartbeatError"),
    "lastCommandError": config.get("lastCommandError"),
}, ensure_ascii=False, indent=2))
