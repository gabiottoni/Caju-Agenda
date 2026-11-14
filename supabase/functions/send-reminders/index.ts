// send-reminders — lembretes automáticos por WhatsApp (via Kapso / Cloud API da Meta)
//
// Corre de hora a hora (pg_cron). Para cada salão com wa_reminders_enabled,
// envia o modelo aprovado às marcações confirmadas que começam nas próximas
// `wa_reminder_hours` horas e ainda não receberam lembrete.
//
//   POST {}                      -> envia os lembretes em falta
//   POST {"action":"setup"}      -> cria o modelo "lembrete_marcacao" na Meta (uma vez)
//   POST {"action":"status"}     -> estado do modelo (APPROVED / PENDING / REJECTED)
//   POST {"action":"test","booking_id":"…"} -> envia já o lembrete dessa marcação
//
// Segredo necessário: KAPSO_API_KEY. O pedido tem de trazer x-admin-token = app_config.admin_token
// (tabela só acessível ao servidor; o pg_cron lê o mesmo valor).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const KAPSO = "https://api.kapso.ai/meta/whatsapp/v24.0";
const SITE = "https://agendacaju.com";
const TZ = "Europe/Lisbon";
const LANG = "pt_PT";
const SEND_FROM_HOUR = 9; // não envia de madrugada
const SEND_TO_HOUR = 21;

const TEMPLATE_TEXT =
  "Olá {{nome}}! 🌿 Lembrete da sua marcação no {{salao}}:\n" +
  "📅 {{quando}} às {{hora}}\n" +
  "💆 {{servico}}\n\n" +
  "Para ver, remarcar ou cancelar: {{link}}\n\n" +
  "Até já!";

const EXAMPLES: Record<string, string> = {
  nome: "Ana",
  salao: "Caju Studio",
  quando: "amanhã, sábado 21/11",
  hora: "10:30",
  servico: "Sobrancelha + Buço",
  link: `${SITE}/#/m/1700df80-cec2-4596-b81f-2e70227c0255`,
};

async function kapso(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("KAPSO_API_KEY");
  if (!key) throw new Error("Falta o segredo KAPSO_API_KEY no Supabase.");
  const r = await fetch(`${KAPSO}${path}`, {
    ...init,
    headers: { "X-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? body?.message ?? `Kapso ${r.status}`);
  return body;
}

const parts = (d: Date, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, ...o }).format(d);
const localDay = (d: Date) => parts(d, { year: "numeric", month: "2-digit", day: "2-digit" });
const localHour = (d: Date) => Number(parts(d, { hour: "2-digit", hourCycle: "h23" }));

function when(start: Date, now: Date) {
  const tomorrow = new Date(now.getTime() + 864e5);
  const wd = parts(start, { weekday: "long" }).replace("-feira", "");
  const dm = parts(start, { day: "2-digit", month: "2-digit" });
  if (localDay(start) === localDay(now)) return `hoje, ${wd} ${dm}`;
  if (localDay(start) === localDay(tomorrow)) return `amanhã, ${wd} ${dm}`;
  return `${wd}, ${dm}`;
}

function waNumber(phone: string | null) {
  let n = (phone ?? "").replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 9 && n.startsWith("9")) n = "351" + n;
  return n.length >= 10 ? n : null;
}

const firstName = (s: string) => (s.trim().split(/\s+/)[0] || s).slice(0, 40);

async function sendOne(b: any, s: any, now: Date) {
  const to = waNumber(b.client_phone);
  if (!to) {
    await sb.from("bookings").update({ wa_reminder_status: "skipped", wa_reminder_error: "Sem telemóvel válido", reminder_sent_at: now.toISOString() }).eq("id", b.id);
    return { id: b.id, status: "skipped" };
  }
  const start = new Date(b.starts_at);
  const params: Record<string, string> = {
    nome: firstName(b.client_name),
    salao: s.name,
    quando: when(start, now),
    hora: parts(start, { hour: "2-digit", minute: "2-digit" }),
    servico: (b.service_name ?? "").slice(0, 200),
    link: `${SITE}/#/m/${b.manage_token}`,
  };
  try {
    await kapso(`/${s.wa_phone_number_id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: s.wa_template,
          language: { code: LANG },
          components: [{
            type: "body",
            parameters: Object.entries(params).map(([k, v]) => ({ type: "text", parameter_name: k, text: v })),
          }],
        },
      }),
    });
    await sb.from("bookings").update({ wa_reminder_status: "sent", wa_reminder_error: null, reminder_sent_at: now.toISOString() }).eq("id", b.id);
    return { id: b.id, status: "sent" };
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await sb.from("bookings").update({ wa_reminder_status: "failed", wa_reminder_error: msg, reminder_sent_at: now.toISOString() }).eq("id", b.id);
    return { id: b.id, status: "failed", error: msg };
  }
}

async function run() {
  const now = new Date();
  const hour = localHour(now);
  const { data: salons, error } = await sb.from("salons").select("*").eq("wa_reminders_enabled", true).not("wa_phone_number_id", "is", null);
  if (error) throw error;
  const results: unknown[] = [];
  if (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR) return { skipped: "fora do horário de envio", hour };
  for (const s of salons ?? []) {
    const until = new Date(now.getTime() + s.wa_reminder_hours * 36e5).toISOString();
    const from = new Date(now.getTime() + 60 * 6e4).toISOString(); // pelo menos 1 h antes
    const { data: list } = await sb.from("bookings").select("*")
      .eq("salon_id", s.id).eq("status", "confirmed").eq("wa_reminder", true)
      .is("reminder_sent_at", null).gte("starts_at", from).lte("starts_at", until)
      .order("starts_at").limit(100);
    for (const b of list ?? []) results.push(await sendOne(b, s, now));
  }
  return { sent: results };
}

async function salonsWithWaba() {
  const { data } = await sb.from("salons").select("*").not("wa_waba_id", "is", null);
  return data ?? [];
}

Deno.serve(async (req) => {
  const { data: cfg } = await sb.from("app_config").select("value").eq("key", "admin_token").maybeSingle();
  if (!cfg?.value || req.headers.get("x-admin-token") !== cfg.value) return new Response("Não autorizado", { status: 401 });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    let out: unknown;
    if (body.action === "setup") {
      out = [];
      for (const s of await salonsWithWaba()) {
        const r = await kapso(`/${s.wa_waba_id}/message_templates`, {
          method: "POST",
          body: JSON.stringify({
            name: s.wa_template,
            category: "UTILITY",
            language: LANG,
            parameter_format: "NAMED",
            components: [{
              type: "BODY",
              text: TEMPLATE_TEXT,
              example: { body_text_named_params: Object.entries(EXAMPLES).map(([param_name, example]) => ({ param_name, example })) },
            }],
          }),
        }).catch((e) => ({ error: String(e.message) }));
        (out as unknown[]).push({ salon: s.slug, result: r });
      }
    } else if (body.action === "status") {
      out = [];
      for (const s of await salonsWithWaba()) {
        const r = await kapso(`/${s.wa_waba_id}/message_templates?name=${s.wa_template}`).catch((e) => ({ error: String(e.message) }));
        (out as unknown[]).push({ salon: s.slug, result: r });
      }
    } else if (body.action === "test" && body.booking_id) {
      const { data: b } = await sb.from("bookings").select("*").eq("id", body.booking_id).single();
      const { data: s } = await sb.from("salons").select("*").eq("id", b.salon_id).single();
      out = await sendOne(b, s, new Date());
    } else {
      out = await run();
    }
    return Response.json(out);
  } catch (e) {
    console.error("send-reminders erro:", e);
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
});
