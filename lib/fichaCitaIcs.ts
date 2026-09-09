function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function walltimeToIcs(y: number, mo: number, d: number, h: number, mi: number, s: number) {
  return `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}${pad2(s)}`;
}

function escapeIcsText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** RFC 5545: cada línea física ocupa como máximo 75 octetos. */
export function plegarLineaIcs(linea: string) {
  const partes: string[] = [];
  let actual = "";
  let limite = 75;
  for (const caracter of linea) {
    if (Buffer.byteLength(actual + caracter, "utf8") > limite && actual) {
      partes.push(actual);
      actual = caracter;
      limite = 74;
    } else {
      actual += caracter;
    }
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

export function construirIcs(opts: {
  uid: string;
  fecha: string;
  hora: string;
  duracionMin: number;
  resumen: string;
  ubicacion?: string | null;
  descripcion?: string | null;
  estado?: "TENTATIVE" | "CONFIRMED";
  ahora?: Date;
}) {
  const [y, mo, d] = opts.fecha.split("-").map(Number);
  const [hStr, mStr, sStr] = opts.hora.split(":");
  const h = Number(hStr ?? 0);
  const mi = Number(mStr ?? 0);
  const s = Number(sStr ?? 0);
  const endDate = new Date(Date.UTC(y, mo - 1, d, h, mi, s) + Math.max(opts.duracionMin, 0) * 60000);
  const now = opts.ahora ?? new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vita Lima//Ficha de Cita//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:America/Lima", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0500", "TZNAME:-05", "END:STANDARD", "END:VTIMEZONE", "BEGIN:VEVENT", `UID:${opts.uid}`,
    `DTSTAMP:${dtstamp}`, `DTSTART;TZID=America/Lima:${walltimeToIcs(y, mo, d, h, mi, s)}`,
    `DTEND;TZID=America/Lima:${walltimeToIcs(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate(), endDate.getUTCHours(), endDate.getUTCMinutes(), endDate.getUTCSeconds())}`,
    `STATUS:${opts.estado ?? "CONFIRMED"}`, `SUMMARY:${escapeIcsText(opts.resumen)}`,
    opts.ubicacion ? `LOCATION:${escapeIcsText(opts.ubicacion)}` : null,
    opts.descripcion ? `DESCRIPTION:${escapeIcsText(opts.descripcion)}` : null,
    "END:VEVENT", "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));
  return lines.map(plegarLineaIcs).join("\r\n");
}
