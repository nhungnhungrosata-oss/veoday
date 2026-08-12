import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
storage.setItem("ibeegen_device_key", "IBEGEN-OLD1-OLD2-OLD3");
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

const license = await import("../src/ibeegen-license");

test("giữ nguyên mã cũ khi nâng cấp sang license v2", () => {
  assert.equal(license.getLicenseKey(), "IBEGEN-OLD1-OLD2-OLD3");
  assert.equal(storage.getItem("ibeegen_license_key_v2"), "IBEGEN-OLD1-OLD2-OLD3");
});

test("installation_id ổn định và không phụ thuộc user-agent", () => {
  const first = license.getInstallationId();
  const second = license.getInstallationId();
  assert.equal(first, second);
  assert.match(first, /^WEB-/);
});

test("kết quả ACTIVE được dùng làm dự phòng 48 giờ khi server mất kết nối", async () => {
  license.setLicenseKey("IBEGEN-PAID-0001-0002");
  let sentPayload: Record<string, string> = {};
  globalThis.fetch = async (_input, init) => {
    sentPayload = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      ok: true,
      status: "ACTIVE",
      installations_used: 1,
      max_installations: 3,
      data: { status: "ACTIVE", plan: "forever", installations_used: 1, max_installations: 3 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const active = await license.checkLicense();
  assert.equal(active.licensed, true);
  assert.equal(active.status, "ACTIVE");
  assert.match(sentPayload.installation_id, /^WEB-/);
  assert.match(sentPayload.device_id, /^[A-F0-9]{8}$/);
  assert.notEqual(sentPayload.installation_id, sentPayload.device_id);

  globalThis.fetch = async () => { throw new Error("network down"); };
  const grace = await license.checkLicense();
  assert.equal(grace.licensed, true);
  assert.equal(grace.status, "GRACE");
  assert.ok(grace.grace_expires_at && grace.grace_expires_at > Date.now());
});

test("DEVICE_LIMIT ở response ngoài cùng luôn khóa dù data cũ ghi ACTIVE", async () => {
  license.setLicenseKey("IBEGEN-LIMIT-0001-0002");
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    status: "DEVICE_LIMIT",
    device_locked: true,
    installations_used: 3,
    max_installations: 3,
    data: { status: "ACTIVE", installations_used: 3, max_installations: 3 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await license.checkLicense();
  assert.equal(result.licensed, false);
  assert.equal(result.status, "DEVICE_LIMIT");
  assert.equal(result.device_locked, true);
});
