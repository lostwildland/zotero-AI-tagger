import { config } from "../package.json";

class Addon {
  public data = {
    alive: true,
    config,
    env: __env__,
  };

  constructor() {}
}

export default Addon;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Zotero {
    interface AiTaggerType {
      hooks: typeof import("./hooks");
      prefs: typeof import("./modules/preferences");
      data: Addon["data"];
    }
    let AiTagger: AiTaggerType;
  }
}
