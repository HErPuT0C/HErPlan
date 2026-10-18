// The running version. Builds between releases add their CI run number, so two of them never look alike:
// "0.2.0+build.57" in reports, "HErPlan 0.2.0 · сборка 57" on screen.

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const FULL_VERSION = APP_BUILD ? `${APP_VERSION}+build.${APP_BUILD}` : APP_VERSION;
