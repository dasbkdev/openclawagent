# Claude model policy

The company default is enforced as the latest Sonnet model checked on
2026-06-02:

```text
claude-sonnet-4-6
```

For OpenClaw config, use the provider-qualified ref:

```text
anthropic/claude-sonnet-4-6
```

## API

The control plane exposes the policy at:

```text
GET /api/v1/setup/model-policy
```

The same object is included in:

```text
GET /api/v1/setup/status
```

## Environment values

At runtime the setup service forces:

```text
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
CLAUDE_MODEL=claude-sonnet-4-6
OPENCLAW_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
```

## OpenClaw config snippet

A ready-to-merge example lives at:

```text
config\openclaw-model-policy.example.json
```

It sets:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-6",
        "fallbacks": []
      },
      "models": {
        "anthropic/claude-sonnet-4-6": {
          "alias": "Sonnet"
        }
      }
    }
  }
}
```

## Notes

- This does not modify OpenClaw source code.
- Existing pinned sessions in OpenClaw may need a `/model anthropic/claude-sonnet-4-6`
  switch or session reset before the new default is visible.
- If Anthropic releases a newer Sonnet, update
  `src\setup\claude-model-policy.js` and this document.
