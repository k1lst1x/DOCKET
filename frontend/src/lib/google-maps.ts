// Loads the Google Maps JavaScript API once per page, using the async bootstrap Google
// recommends. Libraries (maps, marker, places) are then loaded with google.maps.importLibrary.

declare global {
  interface Window {
    /** Google calls this when the key is rejected (wrong referrer, API not enabled, billing off). */
    gm_authFailure?: () => void;
    __docketMapsReady?: () => void;
  }
}

let loading: Promise<void> | undefined;

export function loadGoogleMaps(apiKey: string, onAuthFailure: () => void): Promise<void> {
  window.gm_authFailure = onAuthFailure;
  if (typeof google !== "undefined" && typeof google.maps !== "undefined") return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    window.__docketMapsReady = () => resolve();
    const params = new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", callback: "__docketMapsReady" });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = undefined;
      script.remove();
      reject(new Error("Google Maps couldn't load. Check your connection and try again."));
    };
    document.head.append(script);
  });
  return loading;
}
