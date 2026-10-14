function getConfig(name, defaultValue = null) {
  // If inside a docker container, use window.ENV
  if (window.ENV !== undefined && window.ENV[name]) {
    return window.ENV[name];
  }

  return import.meta.env[name] || defaultValue;
}

export function getBackendUrl() {
  return (
    getConfig("VITE_BACKEND_URL") ||
    getConfig("REACT_APP_BACKEND_URL") ||
    "http://serverbpsjosjis.dpdns.org:8080"
  );
}

export function getHoursCloseTicketsAuto() {
  return (
    getConfig("VITE_HOURS_CLOSE_TICKETS_AUTO") ||
    getConfig("REACT_APP_HOURS_CLOSE_TICKETS_AUTO")
  );
}
