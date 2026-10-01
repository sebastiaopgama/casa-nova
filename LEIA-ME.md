# Casa Nova: lista partilhada com Supabase

Lista de compras da casa nova, divisão a divisão, com orçamento, prioridades e sincronização
em tempo real entre os dois telemóveis. Protegida por uma palavra-passe partilhada.
Tempo de configuração: cerca de 15 minutos. Custo: 0 € (plano Free do Supabase e alojamento gratuito).

## Ficheiros
- `index.html`: a estrutura da página (ecrãs, folha do item, diálogos, entrada).
- `css/styles.css`: todo o design (cores, tipos de letra, modo escuro).
- `js/app.js`: a lógica da app (ecrãs, formulário, Excel, entrada com palavra-passe).
- `js/store.js`: onde os dados são guardados (navegador ou Supabase).
- `js/icons.js`: ícones e cor/ícone de cada divisão.
- `manifest.webmanifest` e `icons/`: nome, cores e ícones para instalar no ecrã principal.
- `config.js`: URL e chave pública do Supabase, e o email da conta partilhada.
- `supabase/schema.sql`: tabelas, regras de segurança (RLS) e tempo real.

Não há build: basta servir a pasta (Live Server, Netlify, Cloudflare Pages, etc.).

## Como funciona a palavra-passe
- Há **uma só conta** no Supabase, partilhada pelos dois, com o email de `LOGIN_EMAIL` (em `config.js`)
  e a vossa palavra-passe. A página só pede a palavra-passe.
- Quem verifica a palavra-passe é o Supabase. Sem ela, o servidor não entrega nenhum dado,
  mesmo a quem leia o código da página. **A palavra-passe não está escrita em nenhum ficheiro da app.**
- Depois de entrar, cada aparelho fica com a sessão iniciada (não é preciso escrever sempre).
  Para sair: menu ⋯ > **Terminar sessão**.

## 1. Criar o projeto Supabase
1. Vai a https://supabase.com/dashboard e cria um projeto (ex.: `casa-nova`).
   Região: **West EU (Ireland)** ou **Central EU (Frankfurt)**. Guarda a *database password* que te pedir
   (é outra coisa, só para administração).
2. Abre `supabase/schema.sql`, copia tudo para **SQL Editor > New query** e carrega em **Run**.

## 2. Criar a conta partilhada (com a vossa palavra-passe)
1. **Authentication > Users > Add user > Create new user**.
2. Email: `casa@casa-nova.invalid` (igual ao `LOGIN_EMAIL` de `config.js`).
3. Password: a vossa palavra-passe.
4. Marca **Auto Confirm User** e cria.

## 3. Fechar as inscrições
**Authentication > Sign In / Providers**: desliga **Allow new users to sign up**.
Assim ninguém consegue criar outra conta. Mesmo que conseguisse, as regras do `schema.sql`
só deixam entrar a conta partilhada.

## 4. Ligar a página ao projeto
1. **Project Settings > API** (ou botão **Connect**): copia o *Project URL* e a *anon / publishable key*.
2. Cola-os em `config.js`. Estes valores não são secretos.
   **Nunca** uses a `service_role` / secret key na página.

## 5. Publicar o site (grátis)
Qualquer alojamento estático serve. Todos dão um endereço grátis com HTTPS:
- **Netlify**: arrasta a pasta para https://app.netlify.com/drop → `nome-que-escolheres.netlify.app`
- **Cloudflare Pages**: Workers & Pages > Create > Pages > Upload assets → `nome.pages.dev`
- **GitHub Pages**: repositório com os ficheiros e Pages ativo → `utilizador.github.io/casa-nova`

Um domínio próprio (ex.: `casanova.pt`) custa cerca de 10–15 € por ano e liga-se depois ao mesmo alojamento.

> No plano Free, o Supabase **pausa o projeto ao fim de 7 dias sem uso**. Se a app ficar uma semana
> sem ser aberta, entra no painel do Supabase e carrega em **Restore project** (os dados não se perdem).

## Instalar no iPhone
1. Abre o endereço do site no **Safari**.
2. Toca em **Partilhar** (o quadrado com a seta para cima) e depois em **Adicionar ao ecrã principal**.
3. A Casa Nova fica com ícone próprio e abre em ecrã inteiro, sem as barras do Safari.
4. Na primeira vez escreve a palavra-passe. O iPhone pode guardá-la no Porta-chaves.

A primeira vez que abrirem o site no Safari do iPhone aparece um aviso com estes passos.
No Android (Chrome) a opção chama-se **Instalar app**.

## Mudar a palavra-passe
**Authentication > Users**: apaga a conta `casa@casa-nova.invalid` e cria-a de novo (passo 2) com a palavra-passe nova.
A lista não se perde: os itens não pertencem à conta. Os aparelhos com sessão iniciada vão pedir a nova palavra-passe.

## Testar localmente no VS Code
Instala a extensão **Live Server**, botão direito no `index.html` > *Open with Live Server*.

Sem `config.js` preenchido, a página funciona em **modo de teste**: não pede palavra-passe
e guarda tudo só no navegador. Quando ligares o Supabase, a página oferece-se para passar
esses itens para a lista partilhada.

## Como funciona (resto)
- Tabelas: `itens` (um registo por produto), `config` (divisões e orçamento, uma só linha) e `membros` (contas com acesso).
- Alterações aparecem no outro ecrã em cerca de um segundo (Supabase Realtime). O ponto verde no topo indica que a ligação está ativa.
- **Preço pago**: ao marcar como comprado podes registar quanto pagaram de facto. O "Já gasto" e o saldo do orçamento usam esse valor.
- **Importar Excel** aceita o mesmo formato que o **Exportar Excel** produz. Serve para cópias de segurança ou para carregar uma lista feita à mão.
