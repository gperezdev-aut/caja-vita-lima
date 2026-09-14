"use client";

import { useState } from "react";
import { whatsappGiftCardUrl } from "@/lib/giftCards";

export function GiftCardShareButton({
  giftcardId,
  code,
  phone,
}: {
  giftcardId: string;
  code: string;
  phone: string;
}) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");

  async function shareGiftCard() {
    const fallbackUrl = whatsappGiftCardUrl(phone, code);
    if (!navigator.share || !navigator.canShare) {
      window.location.href = fallbackUrl;
      return;
    }

    setSharing(true);
    setError("");
    try {
      const response = await fetch(
        `/api/gift-cards/${encodeURIComponent(giftcardId)}/download`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("No se pudo descargar el PNG.");
      const blob = await response.blob();
      if (blob.type !== "image/png")
        throw new Error("La descarga no devolvió una imagen PNG.");
      const file = new File([blob], `gift-card-${code}.png`, {
        type: "image/png",
      });
      const shareData = {
        files: [file],
        text: `Tu Gift Card Vita Lima ${code} está lista.`,
      };
      if (!navigator.canShare(shareData)) {
        window.location.href = fallbackUrl;
        return;
      }
      await navigator.share(shareData);
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError")
        return;
      setError(
        shareError instanceof Error
          ? shareError.message
          : "No se pudo compartir la Gift Card.",
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <span className="giftCardShareControl">
      <button
        className="ghostButton"
        type="button"
        onClick={shareGiftCard}
        disabled={sharing}
      >
        {sharing ? "Preparando PNG…" : "Compartir Gift Card"}
      </button>
      {error && (
        <small className="formMessage error" role="alert">
          {error} Puedes usar “Descargar Gift Card”.
        </small>
      )}
    </span>
  );
}
