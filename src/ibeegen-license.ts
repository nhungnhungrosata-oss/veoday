const DEFAULT_LICENSE_SERVER = "https://key1-five.vercel.app";

const LICENSE_SERVER = String(
  import.meta.env.VITE_LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER,
).replace(/\/$/, "");

export function makeDeviceKey(): string {
  const part = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `IBEGEN-${part()}-${part()}-${part()}`;
}

export function getDeviceKey(): string {
  const existingKey = localStorage.getItem("ibeegen_device_key");
  if (existingKey) return existingKey;

  const newKey = makeDeviceKey();
  localStorage.setItem("ibeegen_device_key", newKey);
  return newKey;
}

export type LicenseInfo = {
  licensed: boolean;
  device_key: string;
  status: string;
  expires_at?: string;
  plan?: string;
};

export async function checkLicense(): Promise<LicenseInfo> {
  const device_key = getDeviceKey();
  const response = await fetch(`${LICENSE_SERVER}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ device_key }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `License server HTTP ${response.status}`);
  }

  const status =
    data?.data?.status ??
    data?.status ??
    (data?.ok === true ? "ACTIVE" : "INACTIVE");
  const expires_at = data?.data?.expires_at ?? data?.expires_at ?? "";
  const plan = data?.data?.plan ?? data?.plan ?? "";

  return {
    licensed: String(status).toUpperCase() === "ACTIVE",
    device_key,
    status: String(status).toUpperCase(),
    expires_at,
    plan,
  };
}
