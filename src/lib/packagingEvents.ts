/** Fired after packaging data is reloaded so global UI (e.g. KPI strip) can refresh. */
export const PACKAGING_DATA_CHANGED_EVENT = "packaging:data-changed";

export function notifyPackagingDataChanged(): void {
  window.dispatchEvent(new CustomEvent(PACKAGING_DATA_CHANGED_EVENT));
}
