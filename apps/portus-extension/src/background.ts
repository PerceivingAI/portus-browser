import { createPortusExtensionBridge } from "./index.js";

const bridge = createPortusExtensionBridge();

bridge.installRuntimeMessageHandlers();
bridge.installSidePanelBehavior();
void bridge.initializeBridge();
