const DEFAULT_LICENSE_SERVER = "https://key1-five.vercel.app";
const APP_ID = "veoday";
const DEVICE_KEY_STORAGE_KEY = "ibeegen_device_key";
const TRIAL_START_KEY = "ibeegen_trial_started_at_v1";
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

const LICENSE_SERVER = String(
  import.meta.env.VITE_LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER,
).replace(/\/$/, "");

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function getSafeNavigator(): Navigator | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function getSafeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

export function makeDeviceKey(): string {
  const part = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `IBEGEN-${part()}-${part()}-${part()}`;
}

export function getDeviceKey(): string {
  const existingKey = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
  if (existingKey) return existingKey;

  const newKey = makeDeviceKey();
  localStorage.setItem(DEVICE_KEY_STORAGE_KEY, newKey);
  return newKey;
}

export type DeviceInfo = {
  app_id: string;
  device_key: string;
  device_id: string;
  device_name: string;
  platform: string;
  language: string;
  timezone: string;
  screen: string;
  user_agent: string;
  fingerprint: string;
};

export function getDeviceInfo(): DeviceInfo {
  const nav = getSafeNavigator();
  const win = getSafeWindow();
  const userAgentData = nav ? (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData : undefined;
  const platform = userAgentData?.platform || nav?.platform || "unknown";
  const language = nav?.language || "unknown";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const screenValue = win?.screen
    ? `${win.screen.width}x${win.screen.height}x${win.screen.colorDepth}`
    : "unknown";
  const userAgent = nav?.userAgent || "unknown";
  const deviceName = `${platform} · ${language} · ${timezone}`;
  const fingerprintBase = [APP_ID, platform, language, timezone, screenValue, userAgent].join("|");
  const fingerprint = hashString(fingerprintBase);

  return {
    app_id: APP_ID,
    device_key: getDeviceKey(),
    device_id: fingerprint,
    device_name: deviceName,
    platform,
    language,
    timezone,
    screen: screenValue,
    user_agent: userAgent,
    fingerprint,
  };
}

export type TrialInfo = {
  active: boolean;
  started_at: number;
  expires_at: number;
  remaining_ms: number;
  remaining_days: number;
};

export function getTrialInfo(now = Date.now()): TrialInfo {
  const savedStart = Number(localStorage.getItem(TRIAL_START_KEY));
  const hasValidStart =
    Number.isFinite(savedStart) &&
    savedStart > 0 &&
    savedStart <= now;

  const started_at = hasValidStart ? savedStart : now;
  if (!hasValidStart) {
    localStorage.setItem(TRIAL_START_KEY, String(started_at));
  }

  const expires_at = started_at + TRIAL_DURATION_MS;
  const remaining_ms = Math.max(0, expires_at - now);

  return {
    active: remaining_ms > 0,
    started_at,
    expires_at,
    remaining_ms,
    remaining_days: Math.ceil(remaining_ms / (24 * 60 * 60 * 1000)),
  };
}

export type LicenseInfo = {
  licensed: boolean;
  device_key: string;
  status: string;
  expires_at?: string;
  plan?: string;
  message?: string;
  device_locked?: boolean;
  bound_device_key?: string;
  device?: DeviceInfo;
};

export async function checkLicense(): Promise<LicenseInfo> {
  const device = getDeviceInfo();
  const response = await fetch(`${LICENSE_SERVER}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      app_id: APP_ID,
      device_key: device.device_key,
      device_id: device.device_id,
      device_fingerprint: device.fingerprint,
      device_name: device.device_name,
      platform: device.platform,
      timezone: device.timezone,
      user_agent: device.user_agent,
      device,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `License server HTTP ${response.status}`);
  }

  const payload = data?.data ?? data ?? {};
  const status =
    payload?.status ??
    data?.status ??
    (data?.ok === true ? "ACTIVE" : "INACTIVE");
  const normalizedStatus = String(status).toUpperCase();
  const device_locked =
    payload?.device_locked === true ||
    data?.device_locked === true ||
    normalizedStatus === "DEVICE_LOCKED" ||
    normalizedStatus === "DEVICE_MISMATCH";
  const expires_at = payload?.expires_at ?? data?.expires_at ?? "";
  const plan = payload?.plan ?? data?.plan ?? "";
  const message = payload?.message ?? data?.message ?? "";
  const bound_device_key = payload?.bound_device_key ?? data?.bound_device_key ?? "";

  return {
    licensed: normalizedStatus === "ACTIVE" && !device_locked,
    device_key: device.device_key,
    status: normalizedStatus,
    expires_at,
    plan,
    message,
    device_locked,
    bound_device_key,
    device,
  };
}
