---
summary: "QQ bot channel via OneBot 12"
read_when:
  - You want Clawdbot to connect to a QQ bot using OneBot 12
  - You are setting up a OneBot 12 WebSocket bridge
---
# QQ OneBot 12

**Status:** Optional plugin (disabled by default).

This channel connects Clawdbot to a QQ bot that exposes a OneBot 12 WebSocket endpoint.

## Install (on demand)

### Onboarding (recommended)

- The onboarding wizard (`clawdbot onboard`) and `clawdbot channels add` list optional channel plugins.
- Selecting QQ OneBot 12 prompts you to install the plugin on demand.

Install defaults:

- **Dev channel + git checkout available:** uses the local plugin path.
- **Stable/Beta:** downloads from npm.

You can always override the choice in the prompt.

### Manual install

```bash
clawdbot plugins install @clawdbot/onebot
```

Use a local checkout (dev workflows):

```bash
clawdbot plugins install --link <path-to-clawdbot>/extensions/onebot
```

Restart the Gateway after installing or enabling plugins.

## Quick setup

1) Configure your OneBot 12 implementation to expose a WebSocket endpoint.

2) Add to config:

```json
{
  "channels": {
    "onebot": {
      "wsUrl": "ws://<onebot-host>:<port>",
      "accessToken": "${ONEBOT_ACCESS_TOKEN}"
    }
  }
}
```

3) Export the token (optional) and restart the Gateway:

```bash
export ONEBOT_ACCESS_TOKEN="onebot-token"
```

## Targets

- **DM:** `user:<qq>`
- **Group:** `group:<groupId>`
- **Channel:** `channel:<guildId>:<channelId>`

Examples:

```bash
clawdbot message send --channel onebot --to user:123456 --text "hi"
clawdbot message send --channel onebot --to group:987654 --text "hello group"
```

## Configuration reference

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `wsUrl` | string | required | OneBot 12 WebSocket endpoint |
| `accessToken` | string | - | Access token for the OneBot endpoint |
| `platform` | string | - | Optional platform value for multi-account connections |
| `selfId` | string | - | Optional bot user ID for multi-account connections |
| `requireMention` | boolean | `true` | Require mentions in group chats by default |
| `dmPolicy` | string | `pairing` | DM access policy (`pairing`, `allowlist`, `open`, `disabled`) |
| `allowFrom` | string[] | `[]` | Allowed sender IDs for DMs |
| `groupPolicy` | string | `allowlist` | Group policy (`allowlist`, `open`, `disabled`) |
| `groupAllowFrom` | string[] | `[]` | Allowed sender IDs for groups |
| `groups` | object | - | Group allowlist + per-group settings (keyed by `groupId` or `channel:guildId:channelId`) |
| `textChunkLimit` | number | - | Max characters per message chunk |
| `chunkMode` | string | - | Chunking mode (`length` or `newline`) |
| `blockStreaming` | boolean | - | Disable streaming replies for this channel |
| `blockStreamingCoalesce` | object | - | Coalescing settings for block streaming |
| `enabled` | boolean | `true` | Enable/disable the channel |
| `name` | string | - | Display name |

## Access control

### DM policies

- **pairing** (default): unknown senders get a pairing code.
- **allowlist**: only IDs in `allowFrom` can DM.
- **open**: public inbound DMs (requires `allowFrom: ["*"]`).
- **disabled**: ignore inbound DMs.

### Group allowlist

Add group IDs to `channels.onebot.groups` to restrict which groups can talk to the bot:

```json
{
  "channels": {
    "onebot": {
      "groups": {
        "123456": {
          "requireMention": true
        },
        "channel:abc:general": {
          "requireMention": false
        }
      }
    }
  }
}
```

## Limitations

- WebSocket connect mode only.
- Media attachments are forwarded as links.

## Troubleshooting

- Verify the WebSocket endpoint is reachable from the gateway host.
- Check `channels.onebot.wsUrl` and `channels.onebot.accessToken` for typos.
- Look for connection errors in the Gateway logs.
