import React, { useCallback, useEffect, useState } from "react";
import { checkLicense, getDeviceKey, LicenseInfo } from "./ibeegen-license";

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);

  const verifyLicense = useCallback(async () => {
    setChecking(true);
    try {
      setInfo(await checkLicense());
    } catch (error) {
      console.error("[License] Không kiểm tra được trạng thái kích hoạt:", error);
      setInfo({
        licensed: false,
        device_key: getDeviceKey(),
        status: "INACTIVE",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void verifyLicense();
  }, [verifyLicense]);

  const locked = checking || !info?.licensed;

  const copyKey = async () => {
    const key = info?.device_key || getDeviceKey();
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

      {locked && (
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
              width: "min(560px, 100%)",
              background: "#0f172a",
              color: "#fff",
              borderRadius: 20,
              padding: "24px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
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

            <div id="license-title" style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
              {checking ? "Đang kiểm tra bản quyền..." : "Web chưa được kích hoạt"}
            </div>

            <div style={{ opacity: 0.9, marginBottom: 16, lineHeight: 1.55 }}>
              {checking
                ? "Vui lòng chờ trong giây lát."
                : "Copy mã bên dưới và gửi người bán để được kích hoạt. Sau khi kích hoạt, bấm “Kiểm tra lại” để sử dụng web."}
            </div>

            {!checking && (
              <>
                <div style={{ fontSize: 13, opacity: 0.78, marginBottom: 8 }}>
                  Trạng thái: <b>{info?.status || "INACTIVE"}</b>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    background: "#020617",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 14,
                    padding: "11px 12px",
                  }}
                >
                  <div
                    title={info?.device_key}
                    style={{
                      minWidth: 0,
                      flex: 1,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                      fontSize: 14,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {info?.device_key}
                  </div>
                  <button
                    type="button"
                    onClick={copyKey}
                    style={{
                      flexShrink: 0,
                      background: copied ? "#16a34a" : "#0284c7",
                      border: 0,
                      color: "#fff",
                      fontWeight: 800,
                      borderRadius: 10,
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                  >
                    {copied ? "Đã copy" : "Copy"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void verifyLicense()}
                  style={{
                    width: "100%",
                    marginTop: 14,
                    background: "#f5a623",
                    border: 0,
                    color: "#0c4a6e",
                    fontWeight: 800,
                    borderRadius: 12,
                    padding: "12px 16px",
                    cursor: "pointer",
                  }}
                >
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
