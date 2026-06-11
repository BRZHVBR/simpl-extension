// src/popup/components/QrCode.tsx
//
// Minimal QR renderer used by the Bitcoin receive screen. Generates a PNG data
// URL locally with the `qrcode` library (no network call — the address is never
// sent anywhere). Kept generic so other chains can reuse it later.

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type QrCodeProps = {
  value: string;
  size?: number;
};

export function QrCode({ value, size = 168 }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!value) {
      setDataUrl(null);
      return () => {
        active = false;
      };
    }

    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          background: "var(--surface-2, #f2f2f2)",
        }}
      />
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="Receive address QR code"
      style={{ borderRadius: 12, display: "block", background: "#fff" }}
    />
  );
}

export default QrCode;
