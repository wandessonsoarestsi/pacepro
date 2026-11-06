# PacePro

Plano de corrida pessoal: treino do dia detalhado, contagem regressiva, tempo estimado para a prova
e análise de cada treino com os dados do Strava. Modo claro e escuro. Os dados ficam no aparelho e,
se a pessoa entrar com o Google, também na nuvem (Redis da Upstash), para não perder nada e usar em
outro aparelho. A conexão com o Strava fica num cookie criptografado do navegador.

## Funções

- Treino do dia, plano completo, contagem regressiva e estimativa de tempo.
- Gerador de plano com atividades opcionais além da corrida: musculação, natação, bike, mobilidade ou outra escrita pela pessoa.
- No plano atual (inclusive importado), a aba Plano permite trocar as atividades além da corrida de hoje em diante, sem mexer nas corridas.
- Análise automática: ao abrir o app, as corridas do Strava dos últimos 7 dias são ligadas aos dias do plano e analisadas. Ao abrir um dia mais antigo, o treino é analisado de novo.
- Como foi o treino: esforço (1 a 10), dor e sono. Sinais de cansaço sugerem trocar o próximo treino forte por leve.
- Ajuste do plano: treino-chave que ficou sem fazer pode ser passado para outro dia da semana ou pulado (tudo pode ser desfeito).
- Zonas de FC (do plano, da FC máxima informada ou da maior FC dos treinos) e tempo em cada zona.
- Plano de prova com ritmo por km e checklist do dia.
- Alimentação do dia e registro de peso.
- Instalável como app (PWA), funciona sem internet.
- Ritmos de limiar e intervalado recalculados pelo teste de 5 km (VDOT).
- Clima no horário do treino (Open-Meteo) com ajuste de ritmo pelo calor.
- Volume semanal com a relação de carga dos últimos 7 dias contra os últimos 28.
- Resumo da semana, calculadora de ritmo, cadência com metrônomo e cartões para compartilhar.
- Imagem do percurso para compartilhar: mapa claro ou arte da rota (sem mapa), feed ou stories, com momentos marcados, corredor fantasma (melhor vez no mesmo percurso), comparação com o mesmo treino de semanas atrás e previsão de prova.
- Comparação de cada treino com os treinos iguais anteriores (ritmo e FC da parte principal).
- Dia da prova: horários a partir da largada, checklist que dá para marcar e tela da prova com ritmo km a km.
- Depois da prova: semana de recuperação e próximo objetivo escolhido por você.
- Calendário de provas (aba Provas), com exportação para a agenda (.ics) e plano montado para cada prova.
- Conta com login do Google (opcional): os dados vão para a nuvem e sincronizam entre aparelhos. A versão mais nova ganha.
- Aviso e botão de atualizar quando sai uma versão nova (`/api/version`).
- Notificações (Ajustes → Notificações), cada uma pode ser desligada: treino do dia às 7h, contagem para a prova (30, 14, 7, 3 e 1 dia), treino-chave de ontem que ficou sem fazer e treino novo no Strava. No iPhone, só com o app instalado na tela de início (iOS 16.4 ou mais novo).
- Sininho no topo com as notificações recebidas neste aparelho (últimos 30 dias): ler, apagar uma ou limpar tudo.

## Estrutura

- `public/` — o site (HTML, CSS e JS, sem build).
  - `plan-generator.js` — gera planos por algoritmo (método VDOT de Jack Daniels).
  - `plan-parser.js` — lê planos em Markdown (gerados ou importados).
  - `analysis.js` — análise dos treinos e estimativa de tempo.
  - `plano.md` — plano de exemplo.
- `api/` — funções do Vercel: integração com o Strava, login com Google (`auth/google.js`), dados da conta (`account.js`), notificações (`push.js`, `_push.js`, `_cron.js`) e versão publicada.

## Configuração

### 1. Strava
1. Em https://www.strava.com/settings/api, crie um app. Em **Authorization Callback Domain**, coloque o domínio do site
   (ex.: `pacepro.vercel.app`, sem https).
2. Copie o **Client ID** e o **Client Secret**.

### 2. Google (login)
1. Em https://console.cloud.google.com/apis/credentials, configure a **Tela de consentimento OAuth** (tipo Externo) e publique.
2. Crie uma credencial **ID do cliente OAuth** do tipo **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, coloque `https://pacepro.vercel.app/api/auth/google` (troque pelo seu domínio).
4. Copie o **ID do cliente** e a **Chave secreta do cliente**.

### 3. Banco de dados
Na Vercel, abra o projeto → **Storage** → **Create Database** → **Upstash for Redis** (plano grátis) e ligue ao projeto.
Isso cria sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`.

### 4. Vercel
1. Em **Settings → Environment Variables**, crie:
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET` — texto aleatório com 32 caracteres ou mais
2. Faça **Redeploy**.

### 5. Webhook do Strava (recomendado)
Com o webhook, o Strava avisa quando há atividade nova, e o app só consulta o Strava nessa hora.
Sem ele, o app consulta no máximo a cada 15 minutos. Precisa do banco de dados (passo 3).
1. Na Vercel, crie a variável `STRAVA_VERIFY_TOKEN` com um texto aleatório e faça **Redeploy**.
2. Rode uma vez, trocando os valores:
   ```
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=SEU_CLIENT_ID -F client_secret=SEU_CLIENT_SECRET \
     -F callback_url=https://pacepro.vercel.app/api/strava/webhook \
     -F verify_token=O_MESMO_STRAVA_VERIFY_TOKEN
   ```
3. A resposta traz um `id`. Crie a variável `STRAVA_SUBSCRIPTION_ID` com esse número e faça **Redeploy**.
   Assim o app ignora avisos que não vêm da sua inscrição.

### 6. Notificações
Funcionam sozinhas depois do passo 3 (banco de dados): o app cria as chaves de envio (VAPID) na primeira vez e
guarda no banco. O Cron da Vercel (em `vercel.json`) chama `/api/push?a=cron` uma vez por dia, às 10h UTC (7h em Brasília).
O aviso de treino novo no Strava precisa do webhook (passo 5).
- Recomendado: crie a variável `CRON_SECRET` com um texto aleatório e faça **Redeploy**. Assim só o Cron da Vercel consegue chamar os lembretes.
- Opcional: para usar chaves próprias, crie `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (ex.: `npx web-push generate-vapid-keys`).
  Trocar as chaves faz cada aparelho se inscrever de novo na próxima vez que abrir o app.

O que fica no banco para cada aparelho inscrito (por até 45 dias sem abrir o app): o endereço de envio, as preferências,
os próximos dias do plano (data, título, tipo), a próxima prova, os dias marcados como feitos e, se o Strava estiver
conectado, só o número do atleta (para o aviso de treino novo). Nenhum dado de atividade do Strava.

## Regras do Strava

O app segue o [acordo](https://www.strava.com/legal/api) e a [política da API do Strava](https://www.strava.com/legal/api_policy):
- O plano é gerado por algoritmo (VDOT), sem IA. Nenhum dado do Strava vai para modelos de IA.
- Os dados do Strava ficam só no aparelho, por até 7 dias (item 6.2). Depois disso o app apaga e busca de novo quando precisa.
- Nada do Strava vai para a nuvem nem para o backup. Fica só o que a pessoa marca ou digita.
- O que a pessoa apaga no Strava some do app na próxima sincronização (item 6.3).
- Ao desconectar, o acesso é revogado e tudo que veio do Strava é apagado do aparelho (item 7.4).
- Botão "Connect with Strava", selo "Powered by Strava" e links "View on Strava" seguem o
  [guia de marca](https://developers.strava.com/guidelines) (arquivos oficiais em `public/strava/`).
- Para limpar dados do Strava salvos na nuvem por versões antigas, rode uma vez
  `KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/limpar-strava-nuvem.js`.

## Formato do plano (.md)

- Uma linha com `Prova:` e a data `dd/mm/aaaa`, e `Meta:` com o tempo `mm:ss` ou `h:mm:ss`.
- Títulos `### Semana N — Nome (período)`, com uma linha opcional em itálico logo abaixo.
- Tabelas `Data | Corrida (rua) | Esteira | Musculação`, com a data como `Seg 09/11`.
  - Negrito na data marca treino-chave; o texto em negrito da corrida vira o título do treino.
  - O ritmo-alvo é o primeiro `m'ss"/km` da coluna de corrida. `🏁` marca teste e `🏆` marca a prova.
- Sessões de musculação em títulos `### 💪 A — Nome` seguidos de uma tabela.
