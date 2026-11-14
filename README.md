# Caju-Agenda
Agenda de marcação e envio de mensagens de aviso — https://agendacaju.com

## Código
O código-fonte está em `app/` (React + Vite + Supabase). A raiz do repositório
tem a versão compilada que o GitHub Pages publica.

```
cd app
npm install
npm run dev      # testar no computador
npm run deploy   # compila e copia para a raiz; depois é só fazer commit
```

## Banco (Supabase)
- `clients` — fichas das clientes (telemóvel e/ou e-mail, notas, grupos em `tags`)
- `client_overview` — vista com nº de visitas, última e próxima visita
- `bookings` — marcações; `services` (jsonb) guarda os vários serviços de cada uma,
  `client_id` liga à ficha, `source` = online | salon | noona
- `create_booking(p_slug, p_service_ids uuid[], …)` — marcação online com vários serviços;
  exige telemóvel ou e-mail e cria/encontra a ficha da cliente
