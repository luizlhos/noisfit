/* NoisFit — acesso ao Supabase.
   Todas as chamadas ao servidor passam por aqui (o app.js não fala com o Supabase direto). */
'use strict';

const SB_URL = 'https://uomvybqcrgxswmozdien.supabase.co';
const SB_KEY = 'sb_publishable_1LaTmyAAt7ojsf12fo75uQ_RLOjc6J9';
// Chave pública do push (VAPID). A chave privada fica só no Supabase (Edge Function).
const VAPID_PUBLIC = 'BLJabACstHdmidMNvjrhWpd_SGOqEOXlJwOSuHRvYWRD0QzIFH32zZsb-KHQ0LTpR7i45RRA-9igUQhiMng-It4';

const API = (() => {
  const sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'noisfit.auth' },
  });

  function ok({ data, error }) {
    if (error) throw error;
    return data;
  }
  const uid = async () => (await sb.auth.getSession()).data.session?.user?.id || null;
  const redirect = () => location.origin + location.pathname;

  // Mensagem de erro do Edge Function (o corpo traz { error }).
  async function invoke(nome, body) {
    const { data, error } = await sb.functions.invoke(nome, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (e) { /* sem corpo */ }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  return {
    // ------------------------------------------------------------ Sessão
    async sessao() { return (await sb.auth.getSession()).data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
    async entrar(email, senha) { return ok(await sb.auth.signInWithPassword({ email, password: senha })); },
    async cadastrar(nome, email, senha) {
      const d = ok(await sb.auth.signUp({ email, password: senha, options: { data: { nome, consentimento_em: new Date().toISOString() }, emailRedirectTo: redirect() } }));
      return { precisaConfirmar: !d.session };
    },
    async esqueci(email) { return ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() })); },
    async novaSenha(senha) { return ok(await sb.auth.updateUser({ password: senha })); },
    async sair() { await sb.auth.signOut({ scope: 'local' }); },

    // ------------------------------------------------------------ Perfil
    async perfil() { return ok(await sb.from('profiles').select('*').eq('id', await uid()).maybeSingle()); },
    async salvarPerfil(dados) { return ok(await sb.from('profiles').update(dados).eq('id', await uid()).select().single()); },

    // ------------------------------------------------------------ Tipos de treino
    async tipos() { return ok(await sb.from('workout_types').select('*').order('nome')); },
    async addTipo(t) { return ok(await sb.from('workout_types').insert(t)); },
    async delTipo(id) { return ok(await sb.from('workout_types').delete().eq('id', id)); },

    // ------------------------------------------------------------ Treinos
    async treinosDia(dia) { return ok(await sb.from('workouts').select('*').eq('dia', dia).order('data_hora')); },
    async treinosRecentes() { return ok(await sb.from('workouts').select('*').order('data_hora', { ascending: false }).limit(30)); },
    async addTreino(t) { return ok(await sb.from('workouts').insert(t).select().single()); },
    async delTreino(id) { return ok(await sb.from('workouts').delete().eq('id', id)); },

    // ------------------------------------------------------------ Refeições
    async refeicoesDia(dia) { return ok(await sb.from('meals').select('*').eq('dia', dia).order('data_hora')); },
    async addRefeicao(r) { return ok(await sb.from('meals').insert(r).select().single()); },
    async delRefeicao(id) { return ok(await sb.from('meals').delete().eq('id', id)); },

    // ------------------------------------------------------------ Água
    async aguaDia(dia) { return ok(await sb.from('water_logs').select('*').eq('dia', dia).order('data_hora', { ascending: false })); },
    async addAgua(ml, dataHora) { return ok(await sb.from('water_logs').insert({ ml, data_hora: dataHora || new Date().toISOString() })); },
    async delAgua(id) { return ok(await sb.from('water_logs').delete().eq('id', id)); },

    // ------------------------------------------------------------ Avaliações e IA
    async avaliacoes() { return ok(await sb.from('assessments').select('*').order('data').order('criado_em')); },
    async salvarAvaliacao(a) {
      const { id, ...dados } = a;
      if (id) return ok(await sb.from('assessments').update(dados).eq('id', id).select().single());
      return ok(await sb.from('assessments').insert(dados).select().single());
    },
    async delAvaliacao(id) { return ok(await sb.from('assessments').delete().eq('id', id)); },
    async analises() { return ok(await sb.from('analyses').select('*').order('criado_em', { ascending: false }).limit(10)); },
    async analisar(inicialId, finalId) { return invoke('analisar-evolucao', { inicialId, finalId }); },
    async lerExame(path) { return invoke('extrair-bioimpedancia', { path }); },

    // ------------------------------------------------------------ Arquivos
    async upload(bucket, pasta, blob, ext) {
      const path = `${await uid()}/${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      ok(await sb.storage.from(bucket).upload(path, blob, { contentType: blob.type || undefined, upsert: false }));
      return path;
    },
    async urlArquivo(bucket, path) {
      const d = ok(await sb.storage.from(bucket).createSignedUrl(path, 3600));
      return d.signedUrl;
    },
    async removerArquivo(bucket, path) { if (path) await sb.storage.from(bucket).remove([path]); },

    // ------------------------------------------------------------ Desafios
    async desafios() { return ok(await sb.from('challenges').select('*').order('inicio', { ascending: false })); },
    async desafio(id) { return ok(await sb.from('challenges').select('*').eq('id', id).maybeSingle()); },
    async criarDesafio(d) { return ok(await sb.from('challenges').insert(d).select().single()); },
    async entrarDesafio(codigo) { return ok(await sb.rpc('entrar_desafio', { p_codigo: codigo })); },
    async ranking(id) { return ok(await sb.rpc('ranking_ao_vivo', { p_challenge: id })); },
    async salvarDesafio(id, dados) { return ok(await sb.from('challenges').update(dados).eq('id', id)); },
    async encerrar(id, mensagem) { return ok(await sb.rpc('encerrar_desafio', { p_challenge: id, p_mensagem: mensagem || null })); },
    async sairDesafio(id) { return ok(await sb.from('challenge_members').delete().eq('challenge_id', id).eq('user_id', await uid())); },
    async excluirDesafio(id) { return ok(await sb.from('challenges').delete().eq('id', id)); },

    // ------------------------------------------------------------ Push
    async salvarPush(endpoint, p256dh, auth) {
      return ok(await sb.rpc('salvar_push', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent }));
    },
    async removerPush(endpoint) { return ok(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
    async temPush(endpoint) {
      const d = ok(await sb.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle());
      return !!d;
    },
  };
})();
