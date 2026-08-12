const DEFAULT_LICENSE_SERVER = "https://key1-five.vercel.app";
const APP_ID = "veoday";
const LEGACY_DEVICE_KEY_STORAGE_KEY = "ibeegen_device_key";
const LICENSE_KEY_STORAGE_KEY = "ibeegen_license_key_v2";
const INSTALLATION_ID_STORAGE_KEY = "ibeegen_installation_id_v2";
const LICENSE_CACHE_STORAGE_KEY = "ibeegen_license_cache_v2";
const TRIAL_START_KEY = "ibeegen_trial_started_at_v1";
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const LICENSE_GRACE_MS = 48 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const LICENSE_SERVER = String(viteEnv?.VITE_LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER).replace(/\/$/, "");

let memoryLicenseKey = "";
let memoryInstallationId = "";

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function safeStorageGet(key: string): string {
  try {
    return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Safari private mode hoặc chính sách trình duyệt có thể chặn localStorage.
  }
}

function safeStorageRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Không cần làm gì nếu storage bị chặn.
  }
}

function randomHex(length: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, length)
      .toUpperCase();
  }
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16))
    .join("")
    .toUpperCase();
}

function normalizeLicenseKey(value: string): string {
  return String(value || "").trim().toUpperCase();
}

export function makeDeviceKey(): string {
  return `IBEGEN-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}`;
}

export function getLicenseKey(): string {
  if (memoryLicenseKey) return memoryLicenseKey;

  const current = normalizeLicenseKey(safeStorageGet(LICENSE_KEY_STORAGE_KEY));
  const legacy = normalizeLicenseKey(safeStorageGet(LEGACY_DEVICE_KEY_STORAGE_KEY));
  memoryLicenseKey = current || legacy || makeDeviceKey();
  safeStorageSet(LICENSE_KEY_STORAGE_KEY, memoryLicenseKey);
  // Giữ khóa cũ để các bản web đang cache vẫn đọc được cùng một mã.
  safeStorageSet(LEGACY_DEVICE_KEY_STORAGE_KEY, memoryLicenseKey);
  return memoryLicenseKey;
}

export function getDeviceKey(): string {
  return getLicenseKey();
}

export function setLicenseKey(value: string): string {
  const normalized = normalizeLicenseKey(value);
  if (!/^[A-Z0-9][A-Z0-9_-]{7,127}$/.test(normalized)) {
    throw new Error("Mã license không hợp lệ");
  }

  memoryLicenseKey = normalized;
  safeStorageSet(LICENSE_KEY_STORAGE_KEY, normalized);
  safeStorageSet(LEGACY_DEVICE_KEY_STORAGE_KEY, normalized);
  clearLicenseCache();
  return normalized;
}

export function getInstallationId(): string {
  if (memoryInstallationId) return memoryInstallationId;
  const existing = safeStorageGet(INSTALLATION_ID_STORAGE_KEY).trim();
  if (existing) {
    memoryInstallationId = existing;
    return existing;
  }

  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().toUpperCase()
    : `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
  memoryInstallationId = `WEB-${uuid}`;
  safeStorageSet(INSTALLATION_ID_STORAGE_KEY, memoryInstallationId);
  return memoryInstallationId;
}

function getSafeNavigator(): Navigator | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function getSafeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

export type DeviceInfo = {
  app_id: string;
  device_key: string;
  installation_id: string;
  device_id: string;
  legacy_device_id: string;
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
  const userAgentData = nav
    ? (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    : undefined;
  const platform = userAgentData?.platform || nav?.platform || "unknown";
  const language = nav?.language || "unknown";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const screenValue = win?.screen
    ? `${win.screen.width}x${win.screen.height}x${win.screen.colorDepth}`
    : "unknown";
  const userAgent = nav?.userAgent || "unknown";
  const deviceName = `${platform} · ${language} · ${timezone}`;
  const fingerprint = hashString([APP_ID, platform, language, timezone, screenValue].join("|"));
  // Chỉ dùng để chuyển bản ghi cũ; server mới không khóa theo fingerprint này.
  const legacyDeviceId = hashString(
    [APP_ID, platform, language, timezone, screenValue, userAgent].join("|"),
  );
  const installationId = getInstallationId();

  return {
    app_id: APP_ID,
    device_key: getLicenseKey(),
    installation_id: installationId,
    // Giữ fingerprint cũ ở device_id để không khóa khách trong lúc Apps Script cũ chưa được thay.
    // Apps Script mới luôn ưu tiên installation_id.
    device_id: legacyDeviceId,
    legacy_device_id: legacyDeviceId,
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
  source: "local" | "server";
};

function makeTrialInfo(startedAt: number, expiresAt: number, now: number, source: "local" | "server"): TrialInfo {
  const remainingMs = Math.max(0, expiresAt - now);
  return {
    active: remainingMs > 0,
    started_at: startedAt,
    expires_at: expiresAt,
    remaining_ms: remainingMs,
    remaining_days: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
    source,
  };
}

export function getTrialInfo(now = Date.now()): TrialInfo {
  const savedStart = Number(safeStorageGet(TRIAL_START_KEY));
  const hasValidStart = Number.isFinite(savedStart) && savedStart > 0 && savedStart <= now;
  const startedAt = hasValidStart ? savedStart : now;
  if (!hasValidStart) safeStorageSet(TRIAL_START_KEY, String(startedAt));
  return makeTrialInfo(startedAt, startedAt + TRIAL_DURATION_MS, now, "local");
}

function getServerTrialInfo(payload: Record<string, unknown>, now = Date.now()): TrialInfo | undefined {
  const startedAt = new Date(String(payload.trial_started_at || "")).getTime();
  const expiresAt = new Date(String(payload.trial_expires_at || payload.expires_at || "")).getTime();
  if (!Number.isFinite(expiresAt)) return undefined;
  return makeTrialInfo(Number.isFinite(startedAt) ? startedAt : expiresAt - TRIAL_DURATION_MS, expiresAt, now, "server");
}

export type LicenseInfo = {
  licensed: boolean;
  trial_active?: boolean;
  trial?: TrialInfo;
  device_key: string;
  status: string;
  expires_at?: string;
  plan?: string;
  message?: string;
  device_locked?: boolean;
  installations_used?: number;
  max_installations?: number;
  grace_expires_at?: number;
  device?: DeviceInfo;
};

type CachedLicense = {
  cached_at: number;
  device_key: string;
  installation_id: string;
  expires_at?: string;
  plan?: string;
  installations_used?: number;
  max_installations?: number;
};

function clearLicenseCache(): void {
  safeStorageRemove(LICENSE_CACHE_STORAGE_KEY);
}

function saveLicenseCache(info: LicenseInfo, device: DeviceInfo): void {
  const cached: CachedLicense = {
    cached_at: Date.now(),
    device_key: device.device_key,
    installation_id: device.installation_id,
    expires_at: info.expires_at,
    plan: info.plan,
    installations_used: info.installations_used,
    max_installations: info.max_installations,
  };
  safeStorageSet(LICENSE_CACHE_STORAGE_KEY, JSON.stringify(cached));
}

function getGraceLicense(device: DeviceInfo, now = Date.now()): LicenseInfo | null {
  try {
    const cached = JSON.parse(safeStorageGet(LICENSE_CACHE_STORAGE_KEY)) as CachedLicense;
    const graceExpiresAt = Number(cached?.cached_at || 0) + LICENSE_GRACE_MS;
    const licenseExpiresAt = cached?.expires_at ? new Date(cached.expires_at).getTime() : Number.POSITIVE_INFINITY;
    if (
      cached?.device_key !== device.device_key ||
      cached?.installation_id !== device.installation_id ||
      !Number.isFinite(Number(cached?.cached_at)) ||
      now >= graceExpiresAt ||
      now >= licenseExpiresAt
    ) {
      return null;
    }

    return {
      licensed: true,
      device_key: device.device_key,
      status: "GRACE",
      expires_at: cached.expires_at,
      plan: cached.plan,
      message: "Máy chủ bản quyền đang gián đoạn. Tạm duy trì kích hoạt trong 48 giờ.",
      installations_used: cached.installations_used,
      max_installations: cached.max_installations,
      grace_expires_at: graceExpiresAt,
      device,
    };
  } catch {
    return null;
  }
}

function normalizeLicenseResponse(data: Record<string, any>, device: DeviceInfo): LicenseInfo {
  const payload = data?.data && typeof data.data === "object" ? data.data : {};
  const normalizedStatus = String(
    data?.status ?? payload?.status ?? (data?.ok === true ? "ACTIVE" : "INACTIVE"),
  ).toUpperCase();
  const deviceLocked =
    data?.device_locked === true ||
    payload?.device_locked === true ||
    ["DEVICE_LOCKED", "DEVICE_MISMATCH", "DEVICE_LIMIT"].includes(normalizedStatus);
  const trial = getServerTrialInfo({ ...payload, ...data });
  const isServerTrialStatus = normalizedStatus === "TRIAL";
  const trialActive = (data?.trial_active === true || isServerTrialStatus) && (trial?.active ?? true);
  const hasServerTrialState =
    isServerTrialStatus ||
    normalizedStatus === "TRIAL_EXPIRED" ||
    Boolean(payload?.trial_expires_at || data?.trial_expires_at);
  const localTrial = !hasServerTrialState && normalizedStatus === "INACTIVE" ? getTrialInfo() : undefined;

  return {
    licensed: normalizedStatus === "ACTIVE" && !deviceLocked,
    trial_active: trialActive || localTrial?.active === true,
    trial: trial || localTrial,
    device_key: device.device_key,
    status: normalizedStatus,
    expires_at: String(payload?.expires_at ?? data?.expires_at ?? ""),
    plan: String(payload?.plan ?? data?.plan ?? ""),
    message: String(data?.message ?? payload?.message ?? data?.error ?? ""),
    device_locked: deviceLocked,
    installations_used: Number(data?.installations_used ?? payload?.installations_used) || undefined,
    max_installations: Number(data?.max_installations ?? payload?.max_installations) || undefined,
    device,
  };
}

export async function checkLicense(): Promise<LicenseInfo> {
  const device = getDeviceInfo();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${LICENSE_SERVER}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        app_id: APP_ID,
        device_key: device.device_key,
        installation_id: device.installation_id,
        device_id: device.device_id,
        legacy_device_id: device.legacy_device_id,
        device_fingerprint: device.fingerprint,
        device_name: device.device_name,
        platform: device.platform,
        language: device.language,
        timezone: device.timezone,
        screen: device.screen,
        user_agent: device.user_agent,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data?.temporary === true || data?.status === "UPSTREAM_ERROR") {
      throw new Error(data?.message || data?.error || `License server HTTP ${response.status}`);
    }

    const info = normalizeLicenseResponse(data, device);
    if (info.licensed) saveLicenseCache(info, device);
    else if (!info.trial_active) clearLicenseCache();
    return info;
  } catch (error) {
    const grace = getGraceLicense(device);
    if (grace) return grace;
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
