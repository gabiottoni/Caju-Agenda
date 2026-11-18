// push-notify — avisa a dona do salão no telemóvel (Web Push) quando
// uma cliente pede, cancela ou remarca. Chamado pelo gatilho bookings_push
// (pg_net) com o cabeçalho x-admin-token. Também aceita {"test": true, "salon_id": "…"}
// e {"action":"upcoming"} (pg_cron a cada 5 min: aviso da próxima cliente).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const TZ = "Europe/Lisbon";
const fmt = (d: string) =>
  new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

async function cfg(key: string) {
  const { data } = await sb.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const token = await cfg("admin_token");
  const body = await req.json().catch(() => ({}));
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");

  // pedido de teste vindo do painel: precisa da sessão da dona
  let salonId: string | undefined;
  let msg: { title: string; body: string; tag: string } | undefined;
  if (body.action === "upcoming") {
    if (!token || req.headers.get("x-admin-token") !== token) return new Response("Não autorizado", { status: 401, headers: CORS });
    return Response.json({ upcoming: await upcoming() }, { headers: CORS });
  }
  if (body.test) {
    if (!auth) return new Response("Não autorizado", { status: 401, headers: CORS });
    const { data: u } = await sb.auth.getUser(auth);
    const { data: s } = await sb.from("salons").select("id, name").eq("id", body.salon_id).eq("owner_id", u.user?.id ?? "").maybeSingle();
    if (!s) return new Response("Não autorizado", { status: 401, headers: CORS });
    salonId = s.id;
    msg = { title: "🔔 Notificações ativas", body: `Vai receber aqui as marcações do ${s.name}.`, tag: "teste" };
  } else {
    if (!token || req.headers.get("x-admin-token") !== token) return new Response("Não autorizado", { status: 401, headers: CORS });
    const { data: b } = await sb.from("bookings").select("*").eq("id", body.booking_id).maybeSingle();
    if (!b) return Response.json({ skipped: "sem marcação" });
    salonId = b.salon_id;
    const quando = fmt(b.starts_at);
    const first = String(b.client_name).split(" ")[0];
    msg = body.event === "cancelled"
      ? { title: `❌ ${first} cancelou`, body: `${b.service_name} · ${quando}`, tag: `b-${b.id}` }
      : body.event === "rescheduled"
      ? { title: `🔁 ${first} pediu para remarcar`, body: `Novo horário: ${quando} · ${b.service_name}`, tag: `b-${b.id}` }
      : { title: `📅 Novo pedido: ${b.client_name}`, body: `${b.service_name} · ${quando}`, tag: `b-${b.id}` };
  }

  webpush.setVapidDetails("mailto:cajustudio@agendacaju.com", (await cfg("vapid_public"))!, (await cfg("vapid_private"))!);
  const results = await send(salonId!, msg!);
  return Response.json({ sent: results }, { headers: CORS });
});

async function send(salonId: string, msg: { title: string; body: string; tag: string }) {
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("salon_id", salonId);
  const payload = JSON.stringify({ ...msg, url: "./#/painel" });
  return await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // aparelho já não existe
      return `erro ${code ?? ""}`;
    }
  }));
}

// Aviso "próxima cliente daqui a X min" — só quando há intervalo antes dela
// (sem outra cliente a terminar nos X minutos anteriores), para não incomodar
// em dias de clientes seguidas.
async function upcoming() {
  webpush.setVapidDetails("mailto:cajustudio@agendacaju.com", (await cfg("vapid_public"))!, (await cfg("vapid_private"))!);
  const { data: salons } = await sb.from("salons").select("id, push_upcoming_min").eq("push_upcoming", true);
  const out: unknown[] = [];
  const now = Date.now();
  for (const s of salons ?? []) {
    const ahead = s.push_upcoming_min * 6e4;
    const { data: list } = await sb.from("bookings").select("*")
      .eq("salon_id", s.id).eq("status", "confirmed").is("upcoming_pushed_at", null)
      .gt("starts_at", new Date(now + 10 * 6e4).toISOString())
      .lte("starts_at", new Date(now + ahead).toISOString());
    for (const b of list ?? []) {
      const start = new Date(b.starts_at).getTime();
      const { count } = await sb.from("bookings").select("id", { count: "exact", head: true })
        .eq("salon_id", s.id).in("status", ["confirmed", "pending"]).neq("id", b.id)
        .gt("ends_at", new Date(start - ahead).toISOString()).lte("ends_at", new Date(start).toISOString());
      await sb.from("bookings").update({ upcoming_pushed_at: new Date().toISOString() }).eq("id", b.id);
      if (count && count > 0) { out.push({ id: b.id, skipped: "clientes seguidas" }); continue; }
      const mins = Math.round((start - now) / 6e4);
      const quando = mins >= 55 && mins <= 65 ? "daqui a 1 h" : mins < 60 ? `daqui a ${mins} min` : `daqui a ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}`;
      const hora = new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(start));
      out.push({ id: b.id, sent: await send(s.id, {
        title: `⏰ Próxima cliente ${quando}`,
        body: `${b.client_name} às ${hora} · ${b.service_name}`,
        tag: `up-${b.id}`,
      }) });
    }
  }
  return out;
}
