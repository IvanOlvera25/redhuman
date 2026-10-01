/* Nombre visible del canal de mensajería (2026-10-01, demo Fraiche). Con NEXT_PUBLIC_CANAL_MENSAJERIA=telegram
   la interfaz dice «Telegram» donde antes decía «WhatsApp»; los valores internos (canal "whatsapp", plataformas,
   reglas de notificación) no cambian. Debe coincidir con WHATSAPP_PROVIDER de la API. */
export const ES_TELEGRAM = (process.env.NEXT_PUBLIC_CANAL_MENSAJERIA || "").toLowerCase() === "telegram";
export const CANAL = ES_TELEGRAM ? "Telegram" : "WhatsApp";
