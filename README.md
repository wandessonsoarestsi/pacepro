# PacePro

Plano de corrida com login Google, treino do dia detalhado, contagem regressiva, tempo estimado para a prova
e análise de cada treino com os dados do Strava. Cada usuário tem o próprio perfil. Modo claro e escuro.

## Estrutura

- `public/` — o site (HTML, CSS e JS, sem build).
  - `plan-generator.js` — gera planos por algoritmo (método VDOT de Jack Daniels).
  - `plan-parser.js` — lê planos em Markdown (gerados ou importados).
  - `analysis.js` — análise dos treinos e estimativa de tempo.
  - `plano.md` — plano de exemplo.
- `api/` — funções do Vercel: configuração pública e integração com o Strava.
- `supabase/schema.sql` — tabelas do banco.

## Configuração

### 1. Supabase (login e banco de dados)
1. Crie um projeto em https://supabase.com (plano gratuito).
2. Em **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL**, a chave **anon public** e a chave **service_role**.

### 2. Google (login)
1. Em https://console.cloud.google.com, crie um projeto.
2. Em **APIs e serviços → Tela de consentimento OAuth**, configure como **Externo** e publique.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web** e, em
   **URIs de redirecionamento autorizados**, cole a URL de callback mostrada no Supabase em
   **Authentication → Providers → Google** (algo como `https://xxxx.supabase.co/auth/v1/callback`).
4. Copie o **ID do cliente** e a **Chave secreta** para o Supabase em **Authentication → Providers → Google** e ative.
5. No Supabase, em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL**
   (ex.: `https://pacepro.vercel.app`).

### 3. Strava
1. Em https://www.strava.com/settings/api, crie um app. Em **Authorization Callback Domain**, coloque o domínio do site
   (ex.: `pacepro.vercel.app`).
2. Apps novos aceitam só 1 atleta. Para liberar outros usuários, peça aumento de limite ao Strava
   (formulário de revisão na mesma página).

### 4. Vercel
1. Importe o repositório em https://vercel.com/new (framework **Other**, sem build).
2. Em **Settings → Environment Variables**, crie:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
   - `SESSION_SECRET` — texto aleatório com 32 caracteres ou mais
3. Faça **Redeploy**.

Sem as variáveis do Supabase, o site funciona em modo local (dados só no aparelho, sem login e sem Strava).

## Formato do plano (.md)

- Uma linha com `Prova:` e a data `dd/mm/aaaa`, e `Meta:` com o tempo `mm:ss` ou `h:mm:ss`.
- Títulos `### Semana N — Nome (período)`, com uma linha opcional em itálico logo abaixo.
- Tabelas `Data | Corrida (rua) | Esteira | Musculação`, com a data como `Seg 09/11`.
  - Negrito na data marca treino-chave; o texto em negrito da corrida vira o título do treino.
  - O ritmo-alvo é o primeiro `m'ss"/km` da coluna de corrida. `🏁` marca teste e `🏆` marca a prova.
- Sessões de musculação em títulos `### 💪 A — Nome` seguidos de uma tabela.
