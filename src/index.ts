import * as hooks from "./hooks";
import * as prefs from "./modules/preferences";
import { config } from "../package.json";

// Register the addon on the Zotero global
Zotero.AiTagger = {
  hooks,
  prefs,
  data: {
    alive: true,
    config,
    env: __env__,
  },
};
