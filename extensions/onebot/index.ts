import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { onebotPlugin } from "./src/channel.js";
import { setOneBotRuntime } from "./src/runtime.js";

const plugin = {
  id: "onebot",
  name: "OneBot 12",
  description: "OneBot 12 channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setOneBotRuntime(api.runtime);
    api.registerChannel({ plugin: onebotPlugin });
  },
};

export default plugin;
