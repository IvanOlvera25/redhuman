"use client";

/* Diagnóstico del avatar (Anam) — 2026-09-23, incidente de Expo.
 *
 * La sala "inicia y cae a texto" sin decir por qué. Esto captura la evidencia que distingue las dos
 * causas posibles:
 *   a) AUTENTICACIÓN / PLAN: Anam rechaza el token (401/402/403/404) → se ve en el `motivo` que manda
 *      el backend en POST /sesion, y en el log del servidor.
 *   b) RED (Wi-Fi de la Expo): el token es válido pero WebRTC no conecta — sin candidatos `srflx`
 *      (UDP/STUN bloqueado), ICE en `failed`/`disconnected`, o DTLS que nunca abre.
 *
 * `instrumentarWebRTC` envuelve RTCPeerConnection mientras dura el intento (se restaura al terminar)
 * y registra estados ICE/DTLS y el tipo de cada candidato. `sondearStun` es una prueba independiente
 * de 5 s contra STUN público: si no devuelve `srflx`, la red bloquea WebRTC y ningún cambio de plan
 * lo va a arreglar.
 */

export type LogDiag = (linea: string) => void;

export interface ResumenRed {
  candidatos: { host: number; srflx: number; relay: number };
  estados: string[];
  ultimoIce: string;
  ultimoConn: string;
}

const resumen: ResumenRed = { candidatos: { host: 0, srflx: 0, relay: 0 }, estados: [], ultimoIce: "", ultimoConn: "" };

export function resumenRedActual(): ResumenRed {
  return { ...resumen, candidatos: { ...resumen.candidatos }, estados: [...resumen.estados] };
}

/** Envuelve RTCPeerConnection para ver qué pasa por dentro del SDK. Regresa la función de restauración. */
export function instrumentarWebRTC(log: LogDiag): () => void {
  if (typeof window === "undefined" || !window.RTCPeerConnection) return () => {};
  const Original = window.RTCPeerConnection;
  resumen.candidatos = { host: 0, srflx: 0, relay: 0 };
  resumen.estados = [];

  class Instrumentada extends Original {
    constructor(config?: RTCConfiguration) {
      super(config);
      const servidores = (config?.iceServers ?? []).map((s) => (Array.isArray(s.urls) ? s.urls.join(",") : s.urls)).join(" | ");
      log(`WEBRTC: nueva conexión · iceServers=[${servidores || "ninguno"}] policy=${config?.iceTransportPolicy ?? "all"}`);

      this.addEventListener("icecandidate", (ev) => {
        const c = (ev as RTCPeerConnectionIceEvent).candidate;
        if (!c) return log(`WEBRTC: fin de candidatos · host=${resumen.candidatos.host} srflx=${resumen.candidatos.srflx} relay=${resumen.candidatos.relay}`);
        const tipo = (c.type ?? (c.candidate.match(/ typ (\w+)/)?.[1] as string) ?? "?") as keyof ResumenRed["candidatos"];
        if (tipo in resumen.candidatos) resumen.candidatos[tipo] += 1;
        log(`WEBRTC: candidato ${tipo} proto=${c.protocol ?? "?"}`);
      });
      this.addEventListener("icecandidateerror", (ev) => {
        const e = ev as RTCPeerConnectionIceErrorEvent;
        console.error("❌ [avatar] ICE candidate error", e);
        log(`WEBRTC: ICE ERROR ${e.errorCode} ${e.errorText ?? ""} url=${e.url ?? ""}`);
      });
      this.addEventListener("iceconnectionstatechange", () => {
        resumen.ultimoIce = this.iceConnectionState;
        resumen.estados.push(`ice:${this.iceConnectionState}`);
        const critico = this.iceConnectionState === "failed" || this.iceConnectionState === "disconnected";
        (critico ? console.error : console.info)(`[avatar] ICE → ${this.iceConnectionState}`);
        log(`WEBRTC: ICE ${this.iceConnectionState}`);
      });
      this.addEventListener("icegatheringstatechange", () => log(`WEBRTC: gathering ${this.iceGatheringState}`));
      this.addEventListener("connectionstatechange", () => {
        resumen.ultimoConn = this.connectionState;
        resumen.estados.push(`conn:${this.connectionState}`);
        const critico = this.connectionState === "failed";
        (critico ? console.error : console.info)(`[avatar] PeerConnection → ${this.connectionState}`);
        log(`WEBRTC: conexión ${this.connectionState}`);
      });
    }
  }

  window.RTCPeerConnection = Instrumentada as unknown as typeof RTCPeerConnection;
  return () => {
    window.RTCPeerConnection = Original;
  };
}

/** Prueba independiente: ¿esta red deja pasar WebRTC? Sin `srflx` el Wi-Fi está bloqueando UDP/STUN. */
export async function sondearStun(log: LogDiag, ms = 5000): Promise<{ srflx: boolean; relay: boolean; host: number; detalle: string }> {
  if (typeof window === "undefined" || !window.RTCPeerConnection) return { srflx: false, relay: false, host: 0, detalle: "sin RTCPeerConnection" };
  const Original = window.RTCPeerConnection; // se usa el original: nunca el envoltorio de arriba
  const pc = new Original({ iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }] });
  const encontrados = { srflx: false, relay: false, host: 0 };
  return new Promise((resolve) => {
    const terminar = (detalle: string) => {
      try { pc.close(); } catch {}
      const r = { ...encontrados, detalle };
      log(`RED: prueba STUN → ${detalle} (host=${encontrados.host} srflx=${encontrados.srflx} relay=${encontrados.relay})`);
      if (!encontrados.srflx) console.error("❌ [avatar] La red NO devolvió candidatos públicos (srflx): el Wi-Fi bloquea UDP/STUN → WebRTC no va a conectar.");
      resolve(r);
    };
    const temporizador = setTimeout(() => terminar(encontrados.srflx ? "ok" : "sin respuesta de STUN (UDP bloqueado o muy lento)"), ms);
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      if (!c) {
        clearTimeout(temporizador);
        return terminar(encontrados.srflx ? "ok: la red permite WebRTC" : "la red NO expone candidatos públicos");
      }
      const tipo = c.type ?? c.candidate.match(/ typ (\w+)/)?.[1];
      if (tipo === "srflx") encontrados.srflx = true;
      else if (tipo === "relay") encontrados.relay = true;
      else encontrados.host += 1;
    };
    pc.createDataChannel("rh-diag");
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch((e) => {
        clearTimeout(temporizador);
        terminar(`createOffer falló: ${String(e)}`);
      });
  });
}

/** Texto plano con todo el contexto — es lo que se copia al portapapeles y lo que se manda al servidor. */
export function armarReporte(datos: {
  donde: string;
  token: string;
  modo?: string;
  motivo?: string;
  sessionToken?: string;
  error?: string;
  eventos: string[];
}): string {
  const red = resumenRedActual();
  return [
    `RED HUMAN · diagnóstico de avatar (${new Date().toISOString()})`,
    `donde: ${datos.donde} · liga: ${datos.token}`,
    `navegador: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    `contexto seguro (https): ${typeof window !== "undefined" ? String(window.isSecureContext) : "?"}`,
    `backend → modo=${datos.modo ?? "?"} session_token=${datos.sessionToken ?? "?"} motivo=${datos.motivo || "(ninguno)"}`,
    `error: ${datos.error || "(ninguno)"}`,
    `ICE: candidatos host=${red.candidatos.host} srflx=${red.candidatos.srflx} relay=${red.candidatos.relay} · último ice=${red.ultimoIce || "?"} conn=${red.ultimoConn || "?"}`,
    "",
    "eventos:",
    ...datos.eventos,
  ].join("\n");
}
