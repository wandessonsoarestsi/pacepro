// Gera um plano de treino em Markdown com a IA do Groq (gratuita, com limite de uso).
// Corpo (JSON): raceDate, startDate, distanceKm, goal ("mm:ss" ou "h:mm:ss"), runDays, swim, gym, level, notes.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const FORMAT = `
Responda SOMENTE com o plano em Markdown, em português do Brasil, sem texto antes ou depois e sem bloco de código.
Siga exatamente este formato, porque um programa vai ler o arquivo:

# Plano de Treino <distância> km — <nome curto>
**Prova:** <dia da semana>, <dd/mm/aaaa> · **Meta:** <distância> km em menos de <mm:ss>
**Período:** <dd/mm/aaaa> a <dd/mm/aaaa>

## Resumo
<3 a 5 linhas explicando a lógica do plano e as fases>

## Cronograma

### Semana 1 — <nome da fase> (<dd> a <dd/mm>)
*Musculação: <séries × repetições e intensidade desta semana>*

| Data | Corrida / Natação (rua) | Esteira | Musculação |
|---|---|---|---|
| **Seg 09/11** | **25' L + 4 strides** | 25' a 6,0–6,3 + 4 × 20" a 10,5 | **A** |
| Ter 10/11 | 🏊 Natação leve | | **B** |
| **Qua 11/11** | 10' L + **6 × 2' a 7'45"/km**, pausa 1'30" caminhando + 5' L | 6 × 2' a **7,7 km/h** | **C** |
| Qui 12/11 | 🏊 Natação leve | | **D** |
| **Sex 13/11** | **25' L** | 6,0–6,3 | **E** |
| Sáb 14/11 | Descanso | | — |
| **Dom 15/11** | **40' L** (FC ≤ 145) | 6,0–6,3 | — |

(repita uma seção "### Semana N" para cada semana, até a semana da prova)

## Sessões de musculação

### 💪 A — Pernas: força
| Exercício | Séries × reps |
|---|---|
| Agachamento ou leg press | 3 × 12 |

(crie as sessões usadas no cronograma, de A até no máximo E)

Regras do formato:
- Todos os dias do período aparecem, um por linha, com a data "Seg dd/mm", "Ter dd/mm", "Qua", "Qui", "Sex", "Sáb", "Dom".
- Datas em negrito marcam dias de corrida; o trecho principal da corrida vai em negrito.
- "L" = leve. Ritmos sempre como m'ss"/km na coluna da rua e em km/h na coluna da esteira (km/h = 60 ÷ ritmo em minutos).
- Natação começa com 🏊. Descanso é a palavra "Descanso". Teste começa com "🏁 **TESTE". A prova começa com "🏆 **PROVA".
- A última linha do cronograma é o dia da prova.
`;

function coach(b) {
  return `Você é um treinador de corrida experiente. Monte um plano realista e seguro.
Dados do atleta:
- Prova: ${b.distanceKm} km em ${b.raceDate} (aaaa-mm-dd). Meta: ${b.goal}.
- Início do plano: ${b.startDate}.
- Dias de corrida por semana: ${b.runDays}. Natação: ${b.swim ? 'sim, 2 vezes por semana, leve a moderada' : 'não'}. Musculação: ${b.gym ? 'sim, 40 minutos, seg a sex' : 'não'}.
- Nível atual: ${b.level || 'não informado'}.
- Observações: ${b.notes || 'nenhuma'}.
Princípios: cerca de 80% do volume leve (FC até ~145); um intervalado e um limiar por semana; longão no domingo;
aumentos de volume de no máximo 10% por semana; semana mais leve a cada 3 ou 4; um teste do ritmo no meio do ciclo;
polimento na última semana. Ritmos dos treinos fortes partem do nível atual e evoluem em direção ao ritmo da meta.
Se a meta for irrealista para o prazo, mantenha os treinos mirando nela, mas cite isso no Resumo.
${FORMAT}`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'Configure GROQ_API_KEY no Vercel para gerar planos.' });
  const b = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!okDate(b.raceDate) || !okDate(b.startDate)) return res.status(400).json({ error: 'Informe as datas de início e da prova.' });
  if (b.raceDate <= b.startDate) return res.status(400).json({ error: 'A prova precisa ser depois do início do plano.' });
  const weeks = (new Date(b.raceDate) - new Date(b.startDate)) / (7 * 864e5);
  if (weeks > 24) return res.status(400).json({ error: 'Escolha um período de até 24 semanas.' });
  const clip = (s, n) => String(s || '').slice(0, n);
  const body = {
    raceDate: b.raceDate, startDate: b.startDate,
    distanceKm: Math.min(42.2, Math.max(1, Number(b.distanceKm) || 5)),
    goal: clip(b.goal, 12), runDays: Math.min(6, Math.max(2, parseInt(b.runDays, 10) || 4)),
    swim: !!b.swim, gym: !!b.gym, level: clip(b.level, 600), notes: clip(b.notes, 600)
  };
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.3,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: 'Você escreve planos de treino de corrida em Markdown, seguindo exatamente o formato pedido.' },
          { role: 'user', content: coach(body) }
        ]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) return res.status(429).json({ error: 'O limite gratuito do Groq foi atingido. Tente de novo em alguns minutos.' });
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'A IA não respondeu.' });
    let md = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    md = md.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
    res.json({ md, truncated: j.choices && j.choices[0] && j.choices[0].finish_reason === 'length' });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar o plano. Tente de novo.' });
  }
};
