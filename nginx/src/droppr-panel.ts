import { SessionWarning } from "./components/Common/SessionWarning";
import { debugBadge } from "./components/Panel/DebugBadge";
import { AnalyticsButton } from "./components/Panel/AnalyticsButton";
import { ShareExpiration } from "./components/Panel/ShareExpiration";
import { HeaderButtons } from "./components/Panel/HeaderButtons";
import { XhrInterceptor } from "./services/xhr-interceptor";
import { VideoListHydrator } from "./components/Panel/VideoListHydrator";
import { icloudGateService } from "./services/icloud-gate";
import { ThemeToggle } from "./components/Panel/ThemeToggle";

declare global {
  interface Window {
    __dropprPanelBooted?: boolean;
    DROPPR_PANEL_VERSION?: string;
  }
}

const DROPPR_PANEL_VERSION = "33";

if (!window.__dropprPanelBooted) {
  window.__dropprPanelBooted = true;
  window.DROPPR_PANEL_VERSION = DROPPR_PANEL_VERSION;

  console.log(`Droppr Panel v${DROPPR_PANEL_VERSION} booting...`);

  // Initialize services
  new XhrInterceptor();
  // icloudGateService is auto-initialized by import

  // Initialize features
  new SessionWarning();
  new AnalyticsButton();
  new ShareExpiration();
  new HeaderButtons();
  new VideoListHydrator();
  new ThemeToggle();

  // Debug badge is auto-initialized if debug mode is on
}
