// campaigns — campanhas de WhatsApp (mensagens de marketing para grupos de clientes)
//
// Fluxo: a dona cria a campanha no painel (texto + clientes) → "submit" cria um modelo
// MARKETING na Meta (via Kapso) → o pg_cron chama "tick" de 15 em 15 min: vê se a Meta
// aprovou/rejeitou e, se aprovado (e send_on_approval), envia aos poucos (10h–20h, Lisboa).
//
//   POST {"action":"submit","campaign_id":"…"}  (sessão da dona)
//   POST {"action":"send","campaign_id":"…"}    (sessão da dona) — enviar já uma campanha aprovada
//   POST {"action":"cancel","campaign_id":"…"}  (sessão da dona)
//   POST {"action":"refresh","campaign_id":"…"} (sessão da dona) — ver já o estado na Meta
//   POST {"action":"tick"}                      (x-admin-token, pg_cron)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KAPSO = "https://api.kapso.ai/meta/whatsapp/v24.0";
const TZ = "Europe/Lisbon";
const LANG = "pt_PT";
const FOOTER = "Responda NÃO para deixar de receber.";
const SEND_FROM_HOUR = 10;
const SEND_TO_HOUR = 20;
const BATCH = 40;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const cfg = async (k: string) => (await sb.from("app_config").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
const localHour = (d: Date) => Number(new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));
const firstName = (s: string) => (String(s).trim().split(/\s+/)[0] || s).slice(0, 40);
function waNumber(phone: string | null) {
  let n = (phone ?? "").replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 9 && n.startsWith("9")) n = "351" + n;
  return n.length >= 10 ? n : null;
}

async function kapso(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("KAPSO_API_KEY");
  if (!key) throw new Error("Falta o segredo KAPSO_API_KEY no Supabase.");
  const r = await fetch(`${KAPSO}${path}`, { ...init, headers: { "X-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error([body?.error?.message ?? body?.message ?? `Kapso ${r.status}`, body?.error?.error_user_msg].filter(Boolean).join(" — "));
  return body;
}

const hasName = (c: any) => c.body.includes("{{nome}}");

async function submit(c: any, s: any) {
  const body = c.body.trim();
  if (body.length > 1000) throw new Error("A mensagem é demasiado longa (máx. 1000 caracteres).");
  if (/^\{\{|\}\}$/.test(body)) throw new Error("A mensagem não pode começar nem terminar com {nome}.");
  if (!s.wa_waba_id) throw new Error("Este salão ainda não tem WhatsApp ligado.");
  const name = `camp_${c.id.slice(0, 8)}_${Date.now().toString(36)}`;
  const comp: any = { type: "BODY", text: body };
  if (hasName(c)) { comp.example = { body_text_named_params: [{ param_name: "nome", example: "Ana" }] }; }
  const r = await kapso(`/${s.wa_waba_id}/message_templates`, {
    method: "POST",
    body: JSON.stringify({ name, category: "MARKETING", language: LANG, parameter_format: hasName(c) ? "NAMED" : undefined, components: [comp, { type: "FOOTER", text: FOOTER }] }),
  });
  await sb.from("campaigns").update({ template_name: name, status: "submitted", meta_status: r.status ?? "PENDING", meta_reason: null, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
  return { submitted: name, status: r.status };
}

async function refresh(c: any, s: any) {
  const r = await kapso(`/${s.wa_waba_id}/message_templates?name=${c.template_name}`).catch(() => null);
  const t = r?.data?.find((x: any) => x.name === c.template_name);
  if (!t) return c;
  const patch: any = { meta_status: t.status, updated_at: new Date().toISOString() };
  if (t.status === "APPROVED" && c.status === "submitted") {
    patch.status = c.send_on_approval ? "sending" : "approved";
    patch.approved_at = new Date().toISOString();
  } else if (t.status === "REJECTED") {
    patch.status = "rejected";
    patch.meta_reason = t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : "Rejeitado pela Meta";
  }
  await sb.from("campaigns").update(patch).eq("id", c.id);
  return { ...c, ...patch };
}

async function sendBatch(c: any, s: any, force = false) {
  const hour = localHour(new Date());
  if (!force && (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR)) return { waiting: "fora do horário (10h–20h)" };
  const { data: list } = await sb.from("campaign_recipients").select("*").eq("campaign_id", c.id).eq("status", "queued").limit(BATCH);
  const { data: opt } = await sb.from("clients").select("id").eq("salon_id", s.id).eq("wa_opt_out", true);
  const optOut = new Set((opt ?? []).map((o) => o.id));
  let sent = 0, failed = 0;
  for (const r of list ?? []) {
    const to = waNumber(r.phone);
    if (!to || (r.client_id && optOut.has(r.client_id))) {
      await sb.from("campaign_recipients").update({ status: "skipped", error: to ? "Pediu para não receber" : "Telemóvel inválido" }).eq("id", r.id);
      continue;
    }
    try {
      const components = hasName(c) ? [{ type: "body", parameters: [{ type: "text", parameter_name: "nome", text: firstName(r.name) }] }] : [];
      await kapso(`/${s.wa_phone_number_id}/messages`, {
        method: "POST",
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: c.template_name, language: { code: LANG }, components } }),
      });
      await sb.from("campaign_recipients").update({ status: "sent", error: null, sent_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    } catch (e) {
      await sb.from("campaign_recipients").update({ status: "failed", error: String((e as Error).message).slice(0, 300) }).eq("id", r.id);
      failed++;
    }
  }
  const { count } = await sb.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
  if (!count) await sb.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
  return { sent, failed, left: count ?? 0 };
}

async function tick() {
  const out: unknown[] = [];
  const { data: list } = await sb.from("campaigns").select("*, salons!inner(*)").in("status", ["submitted", "sending"]);
  for (const row of list ?? []) {
    const { salons: s, ...c0 } = row as any;
    let c = c0;
    try {
      if (c.status === "submitted") c = await refresh(c, s);
      if (c.status === "sending") out.push({ id: c.id, ...(await sendBatch(c, s)) });
      else out.push({ id: c.id, status: c.status });
    } catch (e) { out.push({ id: c.id, error: String((e as Error).message) }); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "tick") {
      const token = await cfg("admin_token");
      if (!token || req.headers.get("x-admin-token") !== token) return new Response("Não autorizado", { status: 401, headers: CORS });
      return Response.json({ tick: await tick() }, { headers: CORS });
    }
    // pedidos do painel: sessão da dona do salão
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: u } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!u?.user) return new Response("Não autorizado", { status: 401, headers: CORS });
    const { data: row } = await sb.from("campaigns").select("*, salons!inner(*)").eq("id", body.campaign_id).maybeSingle();
    const { salons: s, ...c } = (row ?? {}) as any;
    if (!row || s.owner_id !== u.user.id) return new Response("Não autorizado", { status: 401, headers: CORS });

    let out: unknown;
    if (body.action === "submit") {
      if (!["draft", "rejected"].includes(c.status)) throw new Error("Esta campanha já foi enviada para aprovação.");
      out = await submit(c, s);
    } else if (body.action === "refresh") {
      out = c.template_name ? await refresh(c, s) : c;
    } else if (body.action === "send") {
      if (!["approved", "sending"].includes(c.status)) throw new Error("A campanha ainda não está aprovada pela Meta.");
      await sb.from("campaigns").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", c.id);
      out = await sendBatch({ ...c, status: "sending" }, s, true);
    } else if (body.action === "cancel") {
      await sb.from("campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", c.id);
      out = { cancelled: true };
    } else throw new Error("Ação desconhecida");
    return Response.json(out, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 400, headers: CORS });
  }
});
