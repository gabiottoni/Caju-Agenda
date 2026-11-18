// calendar-feed — devolve marcações em formato .ics
//   ?token=<salons.calendar_token>  -> todas as marcações do salão (para a profissional assinar)
//   ?m=<bookings.manage_token>       -> só a marcação da cliente, para ela pôr na agenda dela
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Janela de datas enviada ao calendário (evita carregar tudo de uma vez)
const DIAS_PASSADOS = 30;
const DIAS_FUTUROS = 180;

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Linhas do .ics não devem passar de 75 caracteres
function fold(line: string): string {
  const parts: string[] = [];
  while (line.length > 74) {
    parts.push(line.slice(0, 74));
    line = " " + line.slice(74);
  }
  parts.push(line);
  return parts.join("\r\n");
}

const ics = (body: string, name: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-cache",
    },
  });

async function clientEvent(m: string) {
  const { data: b } = await supabase.from("bookings").select("*").eq("manage_token", m).maybeSingle();
  if (!b || !["pending", "confirmed"].includes(b.status)) return new Response("Marcação não encontrada", { status: 404 });
  const { data: s } = await supabase.from("salons").select("name, address, phone").eq("id", b.salon_id).single();
  const agora = icsDate(new Date().toISOString());
  const link = `https://agendacaju.com/#/m/${m}`;
  const desc = [`${b.service_name}`, s?.phone && `Contacto: ${s.phone}`, `Ver, remarcar ou cancelar: ${link}`].filter(Boolean).join("\n");
  const linhas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Caju Agenda//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:cliente-${b.id}@caju-agenda`,
    `DTSTAMP:${agora}`,
    `DTSTART:${icsDate(b.starts_at)}`,
    `DTEND:${icsDate(b.ends_at)}`,
    fold(`SUMMARY:${esc(`${b.service_name} · ${s?.name ?? ""}`)}`),
    fold(`DESCRIPTION:${esc(desc)}`),
    s?.address ? fold(`LOCATION:${esc(s.address)}`) : "",
    fold(`URL:${link}`),
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Lembrete da marcação", "TRIGGER:-P1D", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Lembrete da marcação", "TRIGGER:-PT2H", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return ics(linhas.filter(Boolean).join("\r\n") + "\r\n", "marcacao.ics");
}

Deno.serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const m = params.get("m");
    if (m) return await clientEvent(m);
    const token = params.get("token");
    if (!token) return new Response("Falta o token", { status: 400 });

    const { data: salon, error: salonErr } = await supabase
      .from("salons")
      .select("id, name, address")
      .eq("calendar_token", token)
      .maybeSingle();
    if (salonErr) throw salonErr;
    if (!salon) return new Response("Token inválido", { status: 404 });

    const desde = new Date(Date.now() - DIAS_PASSADOS * 864e5).toISOString();
    const ate = new Date(Date.now() + DIAS_FUTUROS * 864e5).toISOString();

    const [bk, bl] = await Promise.all([
      supabase.from("bookings").select("*").eq("salon_id", salon.id).in("status", ["pending", "confirmed"])
        .gte("starts_at", desde).lte("starts_at", ate).order("starts_at").limit(2000),
      supabase.from("blocks").select("*").eq("salon_id", salon.id)
        .gte("ends_at", desde).lte("starts_at", ate).order("starts_at").limit(500),
    ]);
    if (bk.error) throw bk.error;
    if (bl.error) throw bl.error;

    const agora = icsDate(new Date().toISOString());
    const linhas: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Caju Agenda//PT",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(salon.name)}`,
      "X-WR-TIMEZONE:Europe/Lisbon",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
    ];

    for (const b of bk.data ?? []) {
      const pendente = b.status === "pending";
      const titulo = `${pendente ? "⏳ " : ""}${b.service_name ?? "Marcação"} — ${b.client_name ?? ""}`;
      const desc = [
        b.client_phone && `Telefone: ${b.client_phone}`,
        (b.client_email ?? b.email) && `E-mail: ${b.client_email ?? b.email}`,
        b.notes && `Notas: ${b.notes}`,
        pendente && "Pedido por aprovar",
      ].filter(Boolean).join("\n");

      linhas.push(
        "BEGIN:VEVENT",
        `UID:booking-${b.id}@caju-agenda`,
        `DTSTAMP:${agora}`,
        `DTSTART:${icsDate(b.starts_at)}`,
        `DTEND:${icsDate(b.ends_at)}`,
        fold(`SUMMARY:${esc(titulo)}`),
        fold(`DESCRIPTION:${esc(desc)}`),
        salon.address ? fold(`LOCATION:${esc(salon.address)}`) : "",
        `STATUS:${pendente ? "TENTATIVE" : "CONFIRMED"}`,
        "END:VEVENT",
      );
    }

    for (const x of bl.data ?? []) {
      linhas.push(
        "BEGIN:VEVENT",
        `UID:block-${x.id}@caju-agenda`,
        `DTSTAMP:${agora}`,
        `DTSTART:${icsDate(x.starts_at)}`,
        `DTEND:${icsDate(x.ends_at)}`,
        fold(`SUMMARY:${esc("🚫 Bloqueado" + (x.reason ? ` — ${x.reason}` : ""))}`),
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }

    linhas.push("END:VCALENDAR");
    return ics(linhas.filter(Boolean).join("\r\n") + "\r\n", "caju-agenda.ics");
  } catch (err) {
    console.error("calendar-feed erro:", err);
    return new Response("Erro ao gerar o calendário", { status: 500 });
  }
});
