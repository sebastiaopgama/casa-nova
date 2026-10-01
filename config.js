/* Configuração do Supabase: Project Settings > API (ou "Connect" no topo do painel).
   A "anon / publishable key" é pública por natureza; quem protege os dados são as regras
   de supabase/schema.sql e a palavra-passe (guardada só no Supabase, nunca aqui).
   Com SUPABASE_URL vazio, a página guarda tudo só neste navegador (modo de teste, sem palavra-passe). */
window.CASA_CONFIG = {
  SUPABASE_URL: "https://qavkmwhehdjarcoccbgi.supabase.co",
  SUPABASE_ANON_KEY: "",  // ex.: "eyJhbGciOi..." ou "sb_publishable_..."

  // Conta única, partilhada pelos dois. Cria-a no Supabase com este email e a vossa palavra-passe.
  // O email não precisa de existir (ninguém recebe emails nele).
  LOGIN_EMAIL: "casa@casa-nova.invalid",
};
