import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  checkLicense,
  getDeviceInfo,
  getLicenseKey,
  getTrialInfo,
  LicenseInfo,
  setLicenseKey,
  TrialInfo,
} from "./ibeegen-license";

const RECHECK_INTERVAL_MS = 10 * 60 * 1000;

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [localTrial, setLocalTrial] = useState<TrialInfo>(() => getTrialInfo());
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [licenseInput, setLicenseInput] = useState(() => getLicenseKey());
  const [inputError, setInputError] = useState("");
  const requestRef = useRef<Promise<LicenseInfo | null> | null>(null);

  const verifyLicense = useCallback((showSpinner = false): Promise<LicenseInfo | null> => {
    if (requestRef.current) return requestRef.current;
    if (showSpinner) setChecking(true);
    setLocalTrial(getTrialInfo());

    const request = checkLicense()
      .then((result) => {
        setInfo(result);
        if (result.trial) setLocalTrial(result.trial);
        return result;
      })
      .catch((error) => {
        console.error("[License] Không kiểm tra được trạng thái kích hoạt:", error);
        const trial = getTrialInfo();
        setLocalTrial(trial);
        const unavailable: LicenseInfo = {
          licensed: false,
          trial_active: trial.active,
          trial,
          device_key: getLicenseKey(),
          status: "NETWORK_ERROR",
          message: "Không kết nối được máy chủ bản quyền. Vui lòng kiểm tra mạng và thử lại.",
          device: getDeviceInfo(),
        };
        setInfo(unavailable);
        return unavailable;
      })
      .finally(() => {
        requestRef.current = null;
        setChecking(false);
      });

    requestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void verifyLicense(true);
  }, [verifyLicense]);

  useEffect(() => {
    const refresh = () => {
      setLocalTrial((current) => current.source === "server" ? current : getTrialInfo());
      void verifyLicense(false);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, RECHECK_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [verifyLicense]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLocalTrial((current) => {
        if (current.source === "local") return getTrialInfo();
        const remaining = Math.max(0, current.expires_at - Date.now());
        return {
          ...current,
          active: remaining > 0,
          remaining_ms: remaining,
          remaining_days: Math.ceil(remaining / (24 * 60 * 60 * 1000)),
        };
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const licensed = info?.licensed === true;
  const trial = localTrial;
  const trialActive = (info?.trial_active ?? trial.active) && trial.active;
  const deviceLocked =
    info?.device_locked === true ||
    ["DEVICE_LOCKED", "DEVICE_MISMATCH", "DEVICE_LIMIT"].includes(info?.status || "");
  const networkError = info?.status === "NETWORK_ERROR";
  const locked = (checking && !info) || deviceLocked || (!licensed && !trialActive);
  const dialogOpen = locked || panelOpen;

  const lockTitle = checking && !info
    ? "Đang kiểm tra bản quyền…"
    : deviceLocked
      ? "License đã đủ số trình duyệt"
      : networkError
        ? "Không kết nối được máy chủ bản quyền"
        : trialActive
          ? `Đang dùng thử${trial.remaining_days ? ` · còn ${trial.remaining_days} ngày` : ""}`
          : "Thời gian dùng thử đã kết thúc";

  const lockMessage = checking && !info
    ? "Vui lòng chờ trong giây lát."
    : deviceLocked
      ? info?.message || "License này đã dùng đủ 3 trình duyệt. Hãy liên hệ admin để reset."
      : networkError
        ? info?.message || "Kiểm tra lại kết nối mạng rồi thử lại."
        : trialActive
          ? "Nếu đã mua license, nhập cùng một mã license trên tối đa 3 trình duyệt."
          : info?.message || "Nhập mã license đã mua hoặc copy mã hiện tại gửi người bán để kích hoạt.";

  const copyKey = async () => {
    const key = info?.device_key || getLicenseKey();
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = key;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const applyLicense = async () => {
    setInputError("");
    try {
      const normalized = setLicenseKey(licenseInput);
      setLicenseInput(normalized);
      if (requestRef.current) await requestRef.current;
      const result = await verifyLicense(true);
      if (result?.licensed) setPanelOpen(false);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Mã license không hợp lệ");
    }
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <div
        aria-hidden={locked}
        style={{
          minHeight: "100vh",
          filter: locked ? "grayscale(0.08)" : "none",
          pointerEvents: locked ? "none" : "auto",
          userSelect: locked ? "none" : "auto",
        }}
      >
        {children}
      </div>

      {!licensed && !locked && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          style={{
            position: "fixed",
            right: 14,
            bottom: 14,
            zIndex: 9998,
            border: 0,
            borderRadius: 999,
            padding: "10px 14px",
            background: "#0f172a",
            color: "#fff",
            fontWeight: 750,
            boxShadow: "0 8px 24px rgba(0,0,0,.22)",
            cursor: "pointer",
          }}
        >
          Dùng thử · Nhập license
        </button>
      )}

      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="license-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.72)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: "min(580px, 100%)",
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
              background: "#0f172a",
              color: "#fff",
              borderRadius: 20,
              padding: 24,
              boxSizing: "border-box",
              boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "grid",
                  placeItems: "center",
                  background: "#f5a623",
                  color: "#0c4a6e",
                  fontSize: 24,
                  marginBottom: 16,
                }}
              >
                🔒
              </div>
              {!locked && (
                <button type="button" onClick={() => setPanelOpen(false)} aria-label="Đóng" style={{ border: 0, background: "transparent", color: "#fff", fontSize: 24, cursor: "pointer", alignSelf: "flex-start" }}>×</button>
              )}
            </div>

            <div id="license-title" style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{lockTitle}</div>
            <div style={{ opacity: 0.9, marginBottom: 16, lineHeight: 1.55 }}>{lockMessage}</div>

            {!checking && (
              <>
                <div style={{ fontSize: 13, opacity: 0.78, marginBottom: 8 }}>
                  Trạng thái: <b>{info?.status || "INACTIVE"}</b>
                  {info?.max_installations ? ` · ${info.installations_used || 0}/${info.max_installations} trình duyệt` : ""}
                </div>

                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Nhập mã license đã mua</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={licenseInput}
                      onChange={(event) => setLicenseInput(event.target.value)}
                      placeholder="IBEGEN-XXXX-XXXX-XXXX"
                      autoCapitalize="characters"
                      style={{ minWidth: 0, flex: 1, borderRadius: 10, border: "1px solid rgba(255,255,255,.2)", background: "#020617", color: "#fff", padding: "11px 12px", fontFamily: "ui-monospace, monospace" }}
                    />
                    <button type="button" onClick={() => void applyLicense()} style={{ flexShrink: 0, border: 0, borderRadius: 10, padding: "10px 13px", background: "#16a34a", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Lưu & kiểm tra</button>
                  </div>
                  {inputError && <span style={{ display: "block", color: "#fca5a5", fontSize: 13, marginTop: 6 }}>{inputError}</span>}
                </label>

                <div style={{ fontSize: 13, opacity: 0.78, marginBottom: 7 }}>Mã hiện tại để gửi người bán kích hoạt:</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#020617", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, padding: "11px 12px" }}>
                  <div title={info?.device_key} style={{ minWidth: 0, flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 14, overflowWrap: "anywhere" }}>
                    {info?.device_key || getLicenseKey()}
                  </div>
                  <button type="button" onClick={copyKey} style={{ flexShrink: 0, background: copied ? "#16a34a" : "#0284c7", border: 0, color: "#fff", fontWeight: 800, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
                    {copied ? "Đã copy" : "Copy"}
                  </button>
                </div>

                <button type="button" onClick={() => void verifyLicense(true)} style={{ width: "100%", marginTop: 14, background: "#f5a623", border: 0, color: "#0c4a6e", fontWeight: 800, borderRadius: 12, padding: "12px 16px", cursor: "pointer" }}>
                  Kiểm tra lại
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
