# PacePro

Plano de corrida pessoal: treino do dia detalhado, contagem regressiva, tempo estimado para a prova
e análise de cada treino com os dados do Strava. Modo claro e escuro. Sem login: os dados ficam no
aparelho (com backup em Ajustes) e a conexão com o Strava fica num cookie criptografado do navegador.

## Estrutura

- `public/` — o site (HTML, CSS e JS, sem build).
  - `plan-generator.js` — gera planos por algoritmo (método VDOT de Jack Daniels).
  - `plan-parser.js` — lê planos em Markdown (gerados ou importados).
  - `analysis.js` — análise dos treinos e estimativa de tempo.
  - `plano.md` — plano de exemplo.
- `api/` — funções do Vercel da integração com o Strava.

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
