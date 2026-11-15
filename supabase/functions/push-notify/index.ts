// push-notify — avisa a dona do salão no telemóvel (Web Push) quando
// uma cliente pede, cancela ou remarca. Chamado pelo gatilho bookings_push
// (pg_net) com o cabeçalho x-admin-token. Também aceita {"test": true, "salon_id": "…"}.
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
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("salon_id", salonId);
  const payload = JSON.stringify({ ...msg, url: "./#/painel" });
  const results = await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // aparelho já não existe
      return `erro ${code ?? ""}`;
    }
  }));
  return Response.json({ sent: results }, { headers: CORS });
});
