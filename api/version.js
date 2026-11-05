// Versão publicada do app: muda a cada deploy na Vercel. O app compara para oferecer o botão de atualizar.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '';
  res.json({ v: v ? v.replace(/^dpl_/, '').slice(0, 7) : null });
};
