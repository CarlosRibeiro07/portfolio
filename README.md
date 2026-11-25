# Portfólio de José Carlos: sistema com banco de dados

Servidor Node.js (Express) + banco PostgreSQL. Tem login real com senha protegida, painel de administração (usuários, dashboards, perfil e foto) e a área restrita para as empresas.

## Estrutura
- `server.js`: servidor e API
- `db.js`: conexão e criação automática das tabelas
- `public/`: páginas do site (HTML, CSS e JavaScript)
- `render.yaml`: configuração pronta para publicar no Render

## Publicar no Render (passo a passo)

1. **GitHub:** crie uma conta em github.com e um repositório novo (pode ser privado), por exemplo `portfolio`.
2. **Enviar os arquivos:** no repositório, clique em *Add file > Upload files* e arraste TODO o conteúdo desta pasta (inclusive a pasta `public`). Não envie `node_modules` nem `.env`. Clique em *Commit changes*.
3. **Render:** crie uma conta em render.com e conecte o GitHub.
4. No painel do Render: *New > Blueprint*, escolha o repositório e continue. Ele lê o `render.yaml` e cria o banco e o servidor ligados entre si.
5. Quando pedir, preencha **ADMIN_PASSWORD** com uma senha forte (mínimo 10 caracteres). O usuário do primeiro administrador é `admin`.
6. Aguarde a publicação terminar. O endereço aparece no topo do serviço (algo como `https://portfolio-xxxx.onrender.com`).
7. Abra o endereço, clique em *Entrar*, use `admin` e a senha do passo 5. Depois abra *Admin* e preencha perfil, foto, usuários e dashboards.

Se o Render recusar algum campo do `render.yaml`, crie na mão:
- *New > PostgreSQL* (anote a **Internal Database URL**).
- *New > Web Service*, escolha o repositório, Runtime **Node**, Build `npm install`, Start `npm start`.
- Em *Environment*, crie: `NODE_ENV=production`, `DATABASE_URL` (a Internal Database URL), `SESSION_SECRET` (texto longo e aleatório), `ADMIN_USER=admin` e `ADMIN_PASSWORD` (senha forte).

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
- Sessão por cookie protegido, limite de tentativas de login e cabeçalhos de segurança.
- Os dashboards e o telefone só são enviados a quem está logado.
- Faça cópia do banco de vez em quando (o Render tem a opção de backup nos planos pagos).
- Guarde apenas dados fictícios ou públicos nos dashboards.
