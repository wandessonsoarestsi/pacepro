# PacePro: contexto do app

Documento único com tudo que o app oferece, o que já foi implementado, o que está pendente e como o código está organizado.
Serve para quem chega agora (pessoa ou IA) entender o projeto sem ler todo o código. A configuração passo a passo
(Strava, Google, banco, Vercel, webhook, notificações) está no [README](README.md).

Última atualização: 07/11/2026 (até o PR #71).

---

## 1. O que é

O PacePro é um app de plano de treino para corrida e treino híbrido. A pessoa cadastra uma prova (data, distância e meta)
e o app monta o plano até o dia da prova, mostra o treino do dia, analisa cada treino com os dados do Strava e sugere
ajustes quando ela falta ou está cansada.

- **Publicado em:** https://pacepro.vercel.app (Vercel).
- **Idioma:** português do Brasil. Fuso usado em todo o app: `America/Fortaleza` (UTC−3).
- **Origem:** começou como o site "Rumo ao Sub 30" (plano de 5 km abaixo de 30 minutos do dono do projeto) e virou um app geral.
- **Diferencial frente ao Strava:** o Strava mostra o que já foi feito; o PacePro diz o que fazer a seguir rumo a uma prova,
  compara cada treino com o planejado e ajusta o plano. Tudo de graça. Detalhes em `corrida/diferenciais-pacepro.md` (pasta do projeto).
- **Sem IA:** o plano é gerado por algoritmo (VDOT de Jack Daniels e regras de carga). Exigência da política do Strava.

## 2. Tecnologia

| Parte | Como é |
|---|---|
| Front-end | HTML, CSS e JavaScript puro em `public/`, **sem build e sem framework**. Um único `index.html` com 5 abas. |
| Back-end | Funções serverless da Vercel em `api/` (Node 18+, CommonJS). |
| Banco | Redis da Upstash (via Vercel Storage), variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`. |
| Sessão | Cookies criptografados (AES-256-GCM com `SESSION_SECRET`): `pp_strava` (conexão do Strava) e o cookie da conta Google. |
| PWA | `manifest.webmanifest` + `sw.js` (cache "rede primeiro", funciona sem internet). |
| Bibliotecas | `marked` (CDN, lê o Markdown do plano), Leaflet (mapa), MapLibre (vídeo 3D), mp4-muxer (gera o MP4). Todas em `public/vendor/` menos o `marked`. |
| Mapas | OpenStreetMap (o CARTO passou a pedir chave e foi trocado). |
| Clima | Open-Meteo (sem chave). |
| Métricas de uso | Vercel Web Analytics (`/_vercel/insights/script.js`, função `track()` no app). |
| Testes | `npm test` → `node tests/plano.test.js` (gerador e leitor de planos). |

**Limite importante:** o plano grátis da Vercel permite **12 funções** e o projeto já usa as 12. Por isso o cron
de notificações fica dentro de `/api/push?a=cron` e os módulos auxiliares começam com `_` (não viram função).
Uma função nova precisa juntar-se a uma existente.

## 3. Telas e funcionalidades

Navegação: barra inferior no celular e barra lateral no computador. Abas: **Início, Plano, Progresso, Provas, Ajustes**
(`#hoje`, `#plano`, `#progresso`, `#provas`, `#ajustes`). Visual atual: tema escuro com destaque verde-limão, com opção de claro ou automático.

### Topo (todas as abas)
- Título da aba e data do dia selecionado; botão "Voltar para hoje" quando se está em outro dia.
- Faixa da semana para trocar o dia.
- Foto da conta Google no canto e saudação.
- Sininho com as notificações recebidas neste aparelho nos últimos 30 dias (ler, apagar uma, limpar tudo). Fica no IndexedDB.

### Boas-vindas (primeira visita, sem plano)
Passos: instalar o app na tela de início (detecta sistema e navegador e mostra o passo a passo), conectar o Strava (opcional),
cadastrar a próxima prova e ativar as notificações. Opção de entrar com Google para trazer dados de outro aparelho e de abrir o plano de exemplo.
Depois que o plano existe, o Início mostra o cartão "Último passo" para ativar as notificações, se faltar.

### Início
- **Resumo:** ciclo até a prova (barra e dias que faltam), treinos da semana (pílulas) e projeção do tempo na prova.
- **Treino do dia:** o que fazer na rua e na esteira, ritmo-alvo, musculação do dia (sessão A/B…), clima no horário do treino com ajuste de ritmo pelo calor, bloco do dia da prova.
- **Marcar como feito** e "Como foi o treino": esforço (1 a 10), dor e sono.
- **Análise do treino** (quando há corrida do Strava ligada ao dia): nota contra o planejado ("no alvo", "atenção", "abaixo") olhando a parte principal, análise km a km em texto, tempo em cada zona de FC, comparação com treinos iguais anteriores, mapa do percurso.
- **Ajuste do plano:** treino-chave que ficou sem fazer pode ir para outro dia da semana ou ser pulado; sinais de cansaço sugerem trocar o próximo treino forte por leve. Tudo pode ser desfeito.
- Cartões laterais: "Modalidades e metas" (plano híbrido), últimos treinos com miniatura do percurso (ou desenho de esteira nos indoor), próximo objetivo, resumo da semana.

### Plano
- Semanas em pílulas, nota da semana e lista dos dias; "Ver o plano completo" mostra o Markdown inteiro.
- Cartão "Modalidades e metas" e cartão de atividades além da corrida: dá para trocar essas atividades de hoje em diante sem mexer nas corridas (vale também para plano importado).
- **Plano de prova** com ritmo por km e checklist do dia.
- **Teste de 5 km:** o resultado recalcula os ritmos de limiar e intervalado (VDOT).
- **Calculadora de ritmo:** ritmo ↔ velocidade da esteira, tempo final por distância e ritmo necessário para um tempo-alvo.

### Progresso
- Destaque com os dias até a prova (barra do ciclo) e a projeção no dia da prova.
- Estimativa de hoje e último treino.
- Gráfico do tempo estimado na prova (estimativa, projeção e meta) e botão "Compartilhar evolução".
- Volume semanal com a relação de carga 7 dias / 28 dias.
- Lista de corridas (com "Ver todas") e folha de detalhe de cada uma.
- Resumo da semana, zonas de FC, cadência com metrônomo, alimentação do dia e registro de peso.

### Provas
- Calendário de provas em **lista** ou **calendário do mês** (dias de prova e de retirada do kit marcados).
- Cadastro de prova (nome, local, data, distância, meta, situação, data e local da retirada do kit), exportação para a agenda (`.ics`) e botão para montar o plano daquela prova.
- Depois da prova: registro do resultado, semana de recuperação e escolha do próximo objetivo.

### Ajustes
- **Sua conta:** entrar com Google, sincronizar, sair, apagar os dados da nuvem.
- **Strava:** botão oficial "Connect with Strava", sincronizar, desconectar, selo "Powered by Strava".
- **Plano de treino:** gerar novo, importar `.md`, voltar ao exemplo, apagar plano (com confirmação), baixar o `.md` gerado, voltar ao plano anterior.
- **Gerador de plano:** modalidades (corrida, natação, bike, musculação, Hyrox, Crossfit, triatlo, mobilidade ou outra escrita), meta por modalidade, prova principal do ciclo, datas, distância e tempo-objetivo (se a prova for de corrida), dias de treino, momento atual (normal, voltando de pausa, começando agora) e tempo atual nos 5 km (opcional, senão calculado pelas corridas).
- **Preferências:** aparência (escuro, claro, auto), FC máxima, clima (horário do treino e localização).
- **Notificações:** ativar, testar, desativar e escolher cada tipo.
- **App no celular:** instalar o PWA.
- **Atualizações:** aviso e botão quando há versão nova (`/api/version`).
- **Seus dados:** baixar e restaurar backup (`.json`), apagar treinos marcados.

### Compartilhamento
- **Imagem do percurso** (`route-image.js`): mapa claro ou arte da rota sem mapa, formato feed ou stories, fundo transparente para pôr sobre foto, momentos marcados, marcos de km, **corredor fantasma** (a própria melhor vez no mesmo percurso), comparação com o mesmo treino de semanas atrás e previsão de prova.
- **Vídeo do percurso** (`route-video.js`, botão "Gerar percurso dinâmico"): mapa 3D com câmera percorrendo o trajeto, paradas nos momentos marcantes, opção de análise por km, cartão final, MP4 vertical. Sempre em tema claro.
- **Cartões** do treino e da evolução (canvas), compartilhados pelo menu do sistema.

### Dia da prova
Horários a partir da largada, checklist que dá para marcar e "modo prova" (tela com ritmo km a km).

## 4. Treino híbrido e gerador de plano

Arquivo: `public/plan-generator.js` (funciona no navegador e no Node). Saída: Markdown no formato lido por `plan-parser.js`.

- Corrida pelo método **VDOT** (Jack Daniels): nível atual pelas corridas ou pelo tempo de 5 km informado.
- Demais modalidades por fases (base, construção, específica, semana leve) e regras de carga, com polimento para a prova principal.
- Modalidades **com meta** são o **foco** (mais treinos); **sem meta** são **complementares** (só treinos leves em volta do foco). Pelo menos uma precisa de meta.
- A prova principal pode ser de qualquer modalidade (corrida usa 🏆, as outras usam 🏅 e `**Objetivo:**`).
- Dias fixos por modalidade ou escolhidos pelo app; no máximo **3 atividades por dia**; treinos fortes em dias separados.
- Se não couber tudo, as complementares saem primeiro e o plano avisa.
- Formato do `.md` (gerado ou importado): ver a seção "Formato do plano" no [README](README.md). Plano de exemplo: `public/plano.md`.

## 5. Strava

- OAuth em `api/strava/login.js` → `callback.js`; tokens no cookie criptografado `pp_strava`, só no navegador que conectou.
- `activities.js` (lista das últimas 100 atividades), `activity.js` (parciais por km e voltas), `streams.js` (pontos do percurso, reduzidos a ~700), `status.js`, `logout.js` (revoga o acesso).
- `webhook.js`: o Strava avisa atividade nova, alterada, apagada ou acesso revogado. Guarda só a hora do último evento por atleta (7 dias) e dispara a notificação "treino novo". Sem webhook, o app consulta no máximo a cada 15 minutos.
- Ao abrir o app, as corridas dos últimos 7 dias são ligadas aos dias do plano e analisadas (`autoAnalyze`).

**Regras da API do Strava seguidas (PR #54):**
- Dados do Strava ficam só no aparelho, por até 7 dias, e depois são apagados e buscados de novo (`purgeStrava`).
- Nada do Strava vai para a nuvem nem para o backup (`acctPayload`, `doneNoStrava` no app e `noStrava` em `api/account.js`).
- O que é apagado no Strava some do app na próxima sincronização; ao desconectar, tudo que veio do Strava é apagado.
- Nenhum dado do Strava vai para IA.
- Marca: botões e selos oficiais em `public/strava/`, links "View on Strava".
- `scripts/limpar-strava-nuvem.js` limpa dados do Strava salvos na nuvem por versões antigas.
- Sem revisão do Strava, o app fica limitado a **10 atletas** conectados.

## 6. Dados e armazenamento

### No aparelho (`localStorage`)
| Chave | Conteúdo |
|---|---|
| `pp.local.state` | `{ plan_md, done, extra, updated_at }`: o plano em Markdown, os dias feitos e os dados extras. |
| `pp.local.runs` | Corridas vindas do Strava (com data de chegada, apagadas após 7 dias). |
| `pp.local.synced` | Hora da última sincronização com o Strava. |
| `pp.local.sync` | `{ sub, at, dirty }`: conta ligada a este aparelho e versão da nuvem. |
| `sub30.theme` | Tema escolhido (nome antigo mantido). |
| `sub30.planmd`, `sub30.done` | Chaves da versão antiga do site, lidas só para migrar. |

`extra` guarda: `feel` (esforço, dor, sono), `weights`, `diet`, `moves` (treinos movidos), `skips` (pulados), `soft` (trocados por leve),
`dismiss`, `hrMax`, `races` (calendário de provas), `race` e `next` (resultado da prova e próximo objetivo), `test` (teste de 5 km),
`acts` (atividades além da corrida), `wx` (clima), `metroBpm` (metrônomo), `fresh` (primeira visita) e `hidePlanRace`.

O sininho guarda as notificações recebidas num IndexedDB próprio.

### Na nuvem (Redis, só com login Google)
- `pp:u:<sub>:data` e `pp:u:<sub>:t`: os dados da conta (sem nada do Strava) e a versão. A versão mais nova ganha; `PUT` com versão antiga recebe 409.
- Inscrições de notificação por aparelho (até 45 dias sem abrir o app): endereço de envio, preferências, próximos dias do plano (data, título, tipo), próxima prova, dias feitos e, se houver Strava, só o número do atleta.
- Chaves VAPID criadas sozinhas na primeira vez (ou `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`).

## 7. Notificações

- Web Push próprio (sem biblioteca): `api/_push.js` assina com VAPID e criptografa (aes128gcm).
- `api/push.js`: `GET` (disponível e chave pública), `POST` (inscreve/atualiza), `POST ?a=test`, `POST ?a=off`, `GET ?a=cron`.
- `api/_cron.js`: roda uma vez por dia às 10h UTC (7h em Brasília) pelo Cron da Vercel (`vercel.json`). Protegido por `CRON_SECRET`.
- Tipos (cada um pode ser desligado): treino do dia (7h), contagem para a prova (30, 14, 7, 3 e 1 dia), retirada do kit, treino-chave de ontem que ficou sem fazer, treino novo no Strava (precisa do webhook).
- Notificações sem emoji. No iPhone, só com o app instalado na tela de início (iOS 16.4+).

## 8. Estrutura do código

```
public/
  index.html          as 5 abas, folhas (detalhe da corrida, sininho, modo prova) e scripts
  styles.css          design system (tokens de cor, tema escuro/claro, layout celular e computador)
  app.js              o app inteiro (~3000 linhas, uma IIFE): estado, renderização de cada aba, Strava, conta, notificações, provas, compartilhamento
  plan-generator.js   gerador de planos (VDOT + híbrido)
  plan-parser.js      leitor do Markdown do plano
  analysis.js         análise dos treinos e estimativa de tempo de prova (navegador e Node)
  route-map.js        mapa da corrida: momentos marcantes, tiros, cansaço, comparação
  route-image.js      imagem do percurso para compartilhar
  route-video.js      vídeo 3D do percurso
  sw.js               service worker (cache "pacepro-vNN")
  manifest.webmanifest, ícones, strava/, vendor/
  plano.md            plano de exemplo
api/
  _lib.js             cookies criptografados, Redis, utilitários
  _push.js, _cron.js  envio de push e lembretes diários
  account.js          dados da conta na nuvem
  auth/google.js      login com Google (OAuth)
  push.js             inscrição e envio de notificações
  version.js          versão publicada (aviso de atualização)
  strava/             login, callback, logout, status, activities, activity, streams, webhook
scripts/limpar-strava-nuvem.js
tests/plano.test.js
vercel.json           pasta pública, cron e cabeçalhos do sw.js e do manifest
```

Dentro de `app.js`, as funções seguem o padrão `render<Parte>()` (uma por cartão ou aba), chamadas por `renderAll()`.
O estado salvo passa por `persist()` → `saveNow()`, que também agenda a sincronização da conta e das notificações.

## 9. Convenções

- Tudo em português: interface, comentários, commits e PRs.
- Sem build: editar os arquivos de `public/` direto. Ao mudar arquivos do site, **subir a versão do cache** em `sw.js` (`pacepro-vNN`) para os aparelhos receberem a atualização.
- Campos de texto com fonte de 16px (o iPhone não dá zoom). Campos de tempo recebem os dois-pontos sozinhos (`3000` → `30:00`).
- Sem emojis na interface e nas notificações (o `.md` do plano mantém os emojis, que servem de marcador, e o app tira na hora de mostrar).
- Mapa e vídeo sempre em tema claro.
- Rodar `npm test` antes de abrir PR. Os PRs são juntados automaticamente quando os testes passam.

## 10. Histórico do que foi implementado

| PRs | O que entrou |
|---|---|
| até #21 | Site "Rumo ao Sub 30": plano em Markdown, treino do dia, contagem, estimativa, Strava, análise, PWA, gerador VDOT, ajustes, zonas de FC, clima, calculadora, cadência, cartões, calendário de provas, modo prova. |
| #22–#31 | Mapa no OpenStreetMap, vídeo 3D do percurso (MP4 vertical), marcos de km, análise por km no vídeo. |
| #32–#39 | Imagem do percurso: fantasma, comparação, arte da rota, previsão, momentos, fundo transparente; miniaturas do percurso. |
| #40–#44 | Ajustes de aparência, Vercel Web Analytics, apagar plano, campos de tempo e de 16px. |
| #45 | Redesenho completo: novo design system e navegação lateral no computador. |
| #46–#49 | Explicação do corredor fantasma, miniatura de esteira para treinos indoor. |
| #50–#51 | Só as atividades escolhidas no plano, escolha dos dias de corrida, retorno visual ao gerar. |
| #52–#53 | Conta com login Google e dados na nuvem; nome e foto no topo. |
| #54 | Adequação às regras da API do Strava (7 dias, nada na nuvem, webhook, marca). |
| #55–#57 | Novo visual escuro verde-limão, ícone novo, topo só com a foto. |
| #58–#61, #64 | Notificações (treino, prova, kit, treino perdido, Strava), sininho, diagnóstico no iPhone. |
| #62–#63 | Provas em calendário do mês. |
| #65–#67 | Ajustes no topo e destaque de dias até a prova no Progresso. |
| #68–#69 | Boas-vindas com instalar o app e ativar notificações; cartão "Último passo". |
| #70–#71 | Treino híbrido: várias modalidades, foco, meta obrigatória, dias por modalidade, até 3 atividades por dia. |

## 11. Pendente e ideias

**Em aberto na configuração**
- Inscrição do webhook do Strava em produção: confirmar que o `curl` de inscrição deu certo e que `STRAVA_SUBSCRIPTION_ID` está na Vercel. Sem isso, o aviso de treino novo no Strava não sai.
- Pedir a revisão do Strava para passar do limite de 10 atletas.

**Ideias levantadas (não implementadas)**, vindas da auditoria de produto:
- Projeção de prova mais confiável (a atual pune treinos leves).
- Plano em 3 perguntas, para começar mais rápido.
- Importar treinos de qualquer relógio por arquivo `.fit`, `.gpx` ou `.tcx`.
- Ler treinos do Health Connect (Android) e do Apple Saúde (iPhone), empacotando o site como app de loja (Capacitor).
- API direta das marcas (Garmin, Polar, Coros) ou agregadores pagos (Terra, Rook).
- Modelo de negócio: cobrar por ciclo de prova.

**Limitações conhecidas**
- 12 funções da Vercel já em uso.
- Notificações no iPhone só com o app instalado.
- `app.js` é um arquivo grande único; mudanças grandes pedem cuidado para não quebrar outras abas.
