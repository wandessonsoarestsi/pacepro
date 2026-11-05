# PacePro

Plano de corrida pessoal: treino do dia detalhado, contagem regressiva, tempo estimado para a prova
e análise de cada treino com os dados do Strava. Modo claro e escuro. Sem login: os dados ficam no
aparelho (com backup em Ajustes) e a conexão com o Strava fica num cookie criptografado do navegador.

## Funções

- Treino do dia, plano completo, contagem regressiva e estimativa de tempo.
- Gerador de plano com atividades opcionais além da corrida: musculação, natação, bike, mobilidade ou outra escrita pela pessoa.
- Análise automática: ao abrir o app, as corridas do Strava dos últimos 7 dias são ligadas aos dias do plano e analisadas.
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
- Comparação de cada treino com os treinos iguais anteriores (ritmo e FC da parte principal).
- Dia da prova: horários a partir da largada, checklist que dá para marcar e tela da prova com ritmo km a km.
- Depois da prova: semana de recuperação e próximo objetivo escolhido por você.
- Calendário de provas (aba Provas), com exportação para a agenda (.ics) e plano montado para cada prova.
- Aviso e botão de atualizar quando sai uma versão nova (`/api/version`).

## Estrutura

- `public/` — o site (HTML, CSS e JS, sem build).
  - `plan-generator.js` — gera planos por algoritmo (método VDOT de Jack Daniels).
  - `plan-parser.js` — lê planos em Markdown (gerados ou importados).
  - `analysis.js` — análise dos treinos e estimativa de tempo.
  - `plano.md` — plano de exemplo.
- `api/` — funções do Vercel: integração com o Strava e versão publicada.

## Configuração

### 1. Strava
1. Em https://www.strava.com/settings/api, crie um app. Em **Authorization Callback Domain**, coloque o domínio do site
   (ex.: `pacepro.vercel.app`, sem https).
2. Copie o **Client ID** e o **Client Secret**.

### 2. Vercel
1. Em **Settings → Environment Variables**, crie:
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
   - `SESSION_SECRET` — texto aleatório com 32 caracteres ou mais
2. Faça **Redeploy**.

## Formato do plano (.md)

- Uma linha com `Prova:` e a data `dd/mm/aaaa`, e `Meta:` com o tempo `mm:ss` ou `h:mm:ss`.
- Títulos `### Semana N — Nome (período)`, com uma linha opcional em itálico logo abaixo.
- Tabelas `Data | Corrida (rua) | Esteira | Musculação`, com a data como `Seg 09/11`.
  - Negrito na data marca treino-chave; o texto em negrito da corrida vira o título do treino.
  - O ritmo-alvo é o primeiro `m'ss"/km` da coluna de corrida. `🏁` marca teste e `🏆` marca a prova.
- Sessões de musculação em títulos `### 💪 A — Nome` seguidos de uma tabela.
