# Portfólio de José Carlos: sistema com banco de dados

Servidor Node.js (Express) + banco PostgreSQL. Tem login real com senha protegida, recuperação de senha por e-mail, grupos de acesso, painel de administração (perfil e foto, usuários, grupos e dashboards) e a área restrita para as empresas.

## Estrutura
- `server.js`: servidor e API
- `db.js`: conexão, criação e atualização automática das tabelas
- `mail.js`: envio de e-mail (Resend ou SMTP)
- `public/`: páginas do site (HTML, CSS e JavaScript)
- `render.yaml`: configuração pronta para publicar no Render

## Publicar no Render (passo a passo)

1. **GitHub:** crie uma conta em github.com e um repositório novo (pode ser privado), por exemplo `portfolio`.
2. **Enviar os arquivos:** no repositório, clique em *Add file > Upload files* e arraste TODO o conteúdo desta pasta (inclusive a pasta `public`). Não envie `node_modules` nem `.env`. Clique em *Commit changes*.
3. **Render:** crie uma conta em render.com e conecte o GitHub.
4. No painel do Render: *New > Blueprint*, escolha o repositório e continue. Ele lê o `render.yaml` e cria o banco e o servidor ligados entre si.
5. Quando pedir, preencha **ADMIN_PASSWORD** com uma senha forte (mínimo 10 caracteres) e **ADMIN_EMAIL** com o seu e-mail (é por ele que você recupera a senha do admin). O usuário do primeiro administrador é `admin`. Os campos do e-mail (RESEND_API_KEY e MAIL_FROM) podem ficar em branco por enquanto; veja a seção abaixo.
6. Aguarde a publicação terminar. O endereço aparece no topo do serviço (algo como `https://portfolio-xxxx.onrender.com`).
7. Abra o endereço, clique em *Entrar*, use `admin` e a senha do passo 5. Depois abra *Admin* e preencha perfil, foto, usuários e dashboards.

Se o Render recusar algum campo do `render.yaml`, crie na mão:
- *New > PostgreSQL* (anote a **Internal Database URL**).
- *New > Web Service*, escolha o repositório, Runtime **Node**, Build `npm install`, Start `npm start`.
- Em *Environment*, crie: `NODE_ENV=production`, `DATABASE_URL` (a Internal Database URL), `SESSION_SECRET` (texto longo e aleatório), `ADMIN_USER=admin`, `ADMIN_PASSWORD` (senha forte) e `ADMIN_EMAIL`. Para o e-mail de recuperação de senha, veja a seção seguinte.

## Atualizando um site que já está no ar
Envie os arquivos novos ao GitHub (substituindo os antigos). O Render publica de novo sozinho e, na primeira inicialização, o sistema atualiza o banco **sem apagar nada**:
- usuários e dashboards existentes continuam;
- é criado o grupo **Recrutadores**, com os usuários que já existiam e acesso a todos os dashboards atuais (assim ninguém perde o acesso). Depois você reorganiza em grupos por área;
- se havia mais de um administrador, só o mais antigo continua como admin; os outros viram usuários comuns do grupo Recrutadores;
- usuários antigos ficam sem e-mail: abra *Admin > Usuários > Editar* e informe o e-mail de cada um para que possam recuperar a senha.

## Grupos de acesso
- **admin**: grupo fixo, só o usuário admin pertence a ele e vê todas as telas. Não pode ser editado nem excluído.
- Você cria os grupos de cada área em *Admin > Grupos* (por exemplo Vendas, RH, Financeiro) e marca quais telas cada um enxerga.
- Em *Admin > Usuários* você inclui ou retira os grupos de cada pessoa. Um usuário pode ter vários grupos e vê a soma do que eles liberam.
- Cada dashboard cadastrado vira uma tela automaticamente. Ao criar um dashboard, marque os grupos com acesso (sem grupos, só o admin vê).
- A checagem é feita no servidor a cada requisição: desativar um usuário ou mudar os grupos dele vale na hora.

### Como criar uma tela nova (além dos dashboards)
1. Em `db.js`, na lista `TELAS_PAGINAS`, adicione `{ chave: "relatorios", nome: "Relatórios" }`.
2. No `server.js`, proteja a rota da tela: `app.get("/api/relatorios", auth, exigeTela("relatorios"), handler)`.
3. Reinicie o servidor e marque a tela nos grupos que podem vê-la (*Admin > Grupos*). No front-end, `me.telas` traz a lista de telas liberadas para quem está logado, para você mostrar ou esconder o menu.

## E-mail de recuperação de senha
O link de redefinição vale por 45 minutos e só pode ser usado uma vez. Configure UMA das opções (variáveis de ambiente no Render):
- **Resend (API, recomendado no plano gratuito):** crie conta em resend.com, gere uma chave e preencha `RESEND_API_KEY` e `MAIL_FROM`. Para enviar a qualquer pessoa é preciso verificar um domínio seu no Resend; sem domínio, só dá para enviar ao e-mail da própria conta (serve para testar).
- **SMTP:** preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` e `MAIL_FROM`. O plano gratuito do Render costuma bloquear portas SMTP; confira na documentação do Render antes de usar.
- Sem nenhuma das duas, o pedido de recuperação é aceito mas nenhum e-mail é enviado (fora de produção, o link aparece no terminal para você testar).
- Opcional: `APP_URL` com o endereço do site, caso o link do e-mail saia com o endereço errado.

## Plano gratuito x sempre no ar
- No plano gratuito o servidor "dorme" após 15 minutos sem acesso e leva cerca de 1 minuto para acordar. Abra o link uns minutos antes de uma entrevista.
- O banco gratuito do Render expira depois de algum tempo. Antes de ele expirar, passe o banco para um plano pago (no `render.yaml`, troque `plan: free` por um plano pago) ou use outro serviço de banco PostgreSQL. Confira os limites atuais na página do Render.
- Para ficar sempre no ar, troque também o plano do servidor para um pago.

## Testar no seu computador (opcional)
1. Instale Node.js 20 e PostgreSQL. Crie um banco chamado `portfolio`.
2. Copie `.env.example` para `.env`, preencha, e rode: `npm install` e depois `node --env-file=.env server.js`.
3. Abra http://localhost:3000.

## Segurança
- Senhas guardadas com bcrypt; ninguém (nem você) consegue ler uma senha, só redefinir.
- Sessão por cookie protegido, limite de tentativas de login e de recuperação de senha, e cabeçalhos de segurança.
- Recuperação de senha: o código do link é guardado só como hash, vale 45 minutos, é de uso único e encerra as sessões abertas do usuário. A resposta é a mesma exista o e-mail ou não.
- Os dashboards e o telefone só são enviados a quem está logado.
- Faça cópia do banco de vez em quando (o Render tem a opção de backup nos planos pagos).
- Guarde apenas dados fictícios ou públicos nos dashboards.
