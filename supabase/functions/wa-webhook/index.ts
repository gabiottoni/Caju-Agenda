// wa-webhook — recebe as respostas das clientes no WhatsApp (webhook do Kapso,
// evento whatsapp.message.received) e atualiza a agenda:
//
//   botão "Confirmo presença"  (payload confirm:<booking_id>) -> marcação confirmada pela cliente
//   botão "Preciso remarcar"   (payload resched:<booking_id>) -> marcada "quer remarcar" + link para escolher outro horário
//   texto "NÃO" / "PARAR" / "STOP"                            -> deixa de receber mensagens de retorno (marketing)
//
// Em todos os casos a dona recebe uma notificação no telemóvel (push-notify).
// As mensagens continuam a aparecer no WhatsApp Business (coexistência), por isso
// qualquer outra resposta é tratada por ela, como sempre.
//
//   POST {"action":"setup"} com x-admin-token -> regista este webhook no Kapso (uma vez)
//
// Segurança: cada entrega do Kapso traz X-Webhook-Signature = HMAC-SHA256 (hex) do corpo,
// com o segredo guardado em app_config.kapso_webhook_secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const KAPSO_META = "https://api.kapso.ai/meta/whatsapp/v24.0";
const KAPSO_PLATFORM = "https://api.kapso.ai/platform/v1";
const SELF = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-webhook`;
const SITE = "https://agendacaju.com";
const TZ = "Europe/Lisbon";

const cfg = async (k: string) => (await sb.from("app_config").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;

async function kapso(url: string, init: RequestInit = {}) {
  const key = Deno.env.get("KAPSO_API_KEY");
  if (!key) throw new Error("Falta o segredo KAPSO_API_KEY no Supabase.");
  const r = await fetch(url, { ...init, headers: { "X-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? body?.error ?? body?.message ?? `Kapso ${r.status}`);
  return body;
}

async function hmacHex(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function waNumber(phone: string | null) {
  let n = (phone ?? "").replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 9 && n.startsWith("9")) n = "351" + n;
  return n.length >= 10 ? n : null;
}
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, ...o }).format(new Date(d));
const firstName = (s: string) => (String(s).trim().split(/\s+/)[0] || s).slice(0, 40);
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[.!]+$/, "");

async function reply(phoneNumberId: string, to: string, text: string) {
  await kapso(`${KAPSO_META}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
  }).catch((e) => console.error("resposta falhou:", e.message));
}

async function notifyOwner(bookingId: string, event: string) {
  const token = await cfg("admin_token");
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/push-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token ?? "" },
    body: JSON.stringify({ booking_id: bookingId, event }),
  }).catch((e) => console.error("push falhou:", e.message));
}

async function handle(item: any, topPhoneId?: string) {
  const m = item?.message ?? {};
  if (m?.kapso?.direction && m.kapso.direction !== "inbound") return { ignored: "não é mensagem recebida" };
  const from = waNumber(m.from ?? item?.conversation?.phone_number);
  const phoneNumberId = item?.phone_number_id ?? item?.conversation?.phone_number_id ?? topPhoneId;
  const payload: string = m.button?.payload ?? m.interactive?.button_reply?.id ?? "";
  const text: string = m.button?.text ?? m.interactive?.button_reply?.title ?? m.text?.body ?? "";
  if (!from || !phoneNumberId) return { ignored: "sem remetente" };

  const match = payload.match(/^(confirm|resched):([0-9a-f-]{36})$/);
  if (match) {
    const [, kind, id] = match;
    const { data: b } = await sb.from("bookings").select("*, salons!inner(name, wa_phone_number_id)").eq("id", id).maybeSingle();
    // só aceita a resposta vinda do número da própria cliente
    if (!b || waNumber(b.client_phone) !== from) return { ignored: "marcação não corresponde ao número" };
    if (b.status !== "confirmed" || new Date(b.starts_at) < new Date()) {
      await reply(phoneNumberId, from, "Esta marcação já não está ativa. Se quiser marcar de novo: " + `${SITE}/#/m/${b.manage_token}`);
      return { ignored: "marcação inativa" };
    }
    const quando = `${fmt(b.starts_at, { weekday: "long", day: "2-digit", month: "2-digit" }).replace("-feira", "")} às ${fmt(b.starts_at, { hour: "2-digit", minute: "2-digit" })}`;
    const reply_kind = kind === "confirm" ? "confirmed" : "reschedule";
    if (b.client_reply === reply_kind) return { ignored: "resposta repetida" };
    await sb.from("bookings").update({
      client_reply: reply_kind,
      client_reply_at: new Date().toISOString(),
      client_confirmed_at: kind === "confirm" ? new Date().toISOString() : null,
    }).eq("id", b.id);
    if (kind === "confirm") {
      await reply(phoneNumberId, from, `Obrigada, ${firstName(b.client_name)}! Está confirmado ✅\nAté ${quando} 🌿`);
      await notifyOwner(b.id, "client_confirmed");
    } else {
      await reply(phoneNumberId, from,
        `Sem problema, ${firstName(b.client_name)}! Pode escolher outro horário aqui: ${SITE}/#/m/${b.manage_token}\n\nSe preferir, responda com o dia e a hora que lhe dá jeito e eu vejo a agenda. 🌿`);
      await notifyOwner(b.id, "client_reschedule");
    }
    return { ok: kind, booking: b.id };
  }

  // pedido para deixar de receber mensagens de retorno
  if (["nao", "parar", "stop", "sair", "cancelar subscricao"].includes(norm(text))) {
    const { data: cl } = await sb.from("clients").select("id, salon_id, phone").not("phone", "is", null);
    const mine = (cl ?? []).filter((c) => waNumber(c.phone) === from);
    if (!mine.length) return { ignored: "opt-out sem cliente" };
    await sb.from("clients").update({ wa_opt_out: true }).in("id", mine.map((c) => c.id));
    await sb.from("escritorio_retorno_fila").update({ estado: "ignorada", erro_envio: "Cliente pediu para não receber" })
      .in("client_id", mine.map((c) => c.id)).eq("estado", "pendente").then(() => {}, () => {});
    await reply(phoneNumberId, from, "Combinado, não voltamos a enviar lembretes de retorno. Os lembretes das suas marcações continuam. 🌿");
    return { ok: "opt_out" };
  }
  return { ignored: "mensagem normal" };
}

Deno.serve(async (req) => {
  const raw = await req.text();

  if (req.headers.get("x-admin-token")) {
    const token = await cfg("admin_token");
    if (!token || req.headers.get("x-admin-token") !== token) return new Response("Não autorizado", { status: 401 });
    const body = JSON.parse(raw || "{}");
    if (body.action !== "setup") return Response.json({ error: "ação desconhecida" }, { status: 400 });
    let secret = await cfg("kapso_webhook_secret");
    if (!secret) {
      secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      await sb.from("app_config").upsert({ key: "kapso_webhook_secret", value: secret });
    }
    const { data: salons } = await sb.from("salons").select("slug, wa_phone_number_id").not("wa_phone_number_id", "is", null);
    const out = [];
    for (const s of salons ?? []) {
      const r = await kapso(`${KAPSO_PLATFORM}/whatsapp/phone_numbers/${s.wa_phone_number_id}/webhooks`, {
        method: "POST",
        body: JSON.stringify({ whatsapp_webhook: { kind: "kapso", url: SELF, events: ["whatsapp.message.received"], secret_key: secret } }),
      }).catch((e) => ({ error: String(e.message) }));
      out.push({ salon: s.slug, result: r });
    }
    return Response.json(out);
  }

  const secret = await cfg("kapso_webhook_secret");
  const sig = req.headers.get("x-webhook-signature") ?? "";
  if (!secret || !safeEqual(sig.replace(/^sha256=/, ""), await hmacHex(secret, raw))) {
    return new Response("Assinatura inválida", { status: 401 });
  }
  try {
    const body = JSON.parse(raw);
    const items = body?.batch ? body.data ?? [] : [body];
    const results = [];
    for (const it of items) results.push(await handle(it, body?.phone_number_id));
    console.log("wa-webhook:", JSON.stringify(results));
    return Response.json({ ok: true, results });
  } catch (e) {
    console.error("wa-webhook erro:", e);
    return Response.json({ ok: false }, { status: 200 }); // não pedir reenvio por erro nosso
  }
});
