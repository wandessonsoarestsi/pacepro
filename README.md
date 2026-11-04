# PacePro

Site de plano de treino de corrida: treino do dia detalhado, plano completo, contagem regressiva para a prova,
tempo estimado a partir dos últimos treinos e análise de cada treino puxada do Strava. Tem modo claro e escuro.

## Estrutura

- `public/` — o site (HTML, CSS e JS, sem build).
  - `plano.md` — o plano padrão. Para trocar, importe outro `.md` em **Ajustes** ou substitua este arquivo.
  - `plan-parser.js` — lê o plano em Markdown.
  - `analysis.js` — análise dos treinos e estimativa de tempo.
- `api/strava/` — funções do Vercel que fazem o login no Strava e leem as corridas.
- `api/plan/generate.js` — gera um plano novo em Markdown com a IA do Groq (gratuita, com limite de uso).

## Publicar no Vercel

1. Importe este repositório em https://vercel.com/new (framework: **Other**, sem comando de build).
2. Em **Settings → Environment Variables**, crie:
   - `STRAVA_CLIENT_ID` e `STRAVA_CLIENT_SECRET` — do app criado em https://www.strava.com/settings/api
   - `SESSION_SECRET` — qualquer texto aleatório com 32 caracteres ou mais
   - `GROQ_API_KEY` — chave gratuita criada em https://console.groq.com/keys (para gerar planos com IA)
   - `GROQ_MODEL` (opcional) — modelo do Groq; o padrão é `llama-3.3-70b-versatile`
3. No app do Strava, em **Authorization Callback Domain**, coloque o domínio do site (ex.: `pacepro.vercel.app`).
4. Faça um novo deploy para as variáveis valerem.

## Formato do plano (.md)

- Uma linha com `Prova:` e a data `dd/mm/aaaa`.
- Uma linha com `Meta:` e o tempo `mm:ss` (ex.: `5 km em menos de 30:00`).
- Títulos `### Semana N — Nome (período)`, com uma linha opcional em itálico logo abaixo (observação da semana).
- Tabelas com as colunas `Data | Corrida (rua) | Esteira | Musculação`, e a data no formato `Seg 09/11`.
  - Negrito na data marca treino-chave; o texto em negrito da corrida vira o título do treino.
  - O ritmo-alvo é lido do primeiro `m'ss"/km` da coluna de corrida.
  - A musculação é a letra da sessão (`**A**`, `**B**`…).
- Sessões de musculação em títulos `### 💪 A — Nome` seguidos de uma tabela `Exercício | ...`.
