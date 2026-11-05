// Configuração pública do navegador (a chave "anon" do Supabase é pública por natureza).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ supabaseUrl: process.env.SUPABASE_URL || null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null });
};
