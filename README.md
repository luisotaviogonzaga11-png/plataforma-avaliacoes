# Plataforma de Avaliações (Demo)

**Recursos incluídos**

- Login com sessão (admin padrão: `admin` / `admin`)
- Perfis: **Admin** (ouro) e **Membro** (azul)
- Painel do Admin com botões:
  - **Usuários** (CRUD: criar, resetar senha, excluir, alterar nome/e-mail/perfil)
  - **Criar avaliação** (importa `.docx` e gera formulário com campos de texto e opções de bolinha)
  - **Comunicados** (avisos e enquetes; membros podem votar e ver resultados)
  - **Notas** (editar nota e feedback de cada submissão e notificar o membro)
- **Toggle** para ativar/desativar o botão **Notas**
- **Membros**:
  - Veem comunicados e enquetes
  - Respondem avaliações
  - Consultam notas (se o admin ativar)
  - Recebem notificações internas; opcionalmente e-mail (se SMTP configurado)

> ⚠️ Uso educativo/demonstração. Para produção, reforce autenticação, política de senhas, sessão, store persistente, TLS etc.

---

## Como executar

1. **Pré-requisitos**: Node.js 18+
2. Baixe o projeto e instale:
   ```bash
   npm install
   ```
3. (Opcional) Crie um `.env` a partir do `.env.example` e ajuste:
   - `SESSION_SECRET` (troque!)
   - `PORT` (padrão 3000)
   - `SMTP_URL` (para envio de e-mails de notificação)
4. Inicie:
   ```bash
   npm start
   ```
5. Acesse `http://localhost:3000` e entre com `admin` / `admin`

---

## Importação de .docx — como formatar

- **Campos de texto**: qualquer linha que contenha vários underlines `_____` vira um `<input>` de resposta.
- **Múltipla escolha (bolinhas)**: linhas iniciando com padrões como `a) ...`, `(A) ...`, `1) ...`, `- opção`, `• opção` viram opções de **radio**.
- **Pergunta**: linhas terminando em `:` ou `?` iniciam um novo bloco de pergunta.

> A importação usa o pacote `mammoth` para extrair texto, sem alterar o conteúdo; a lógica cria um **template** por heurísticas simples. Você pode revisar na pré-visualização antes de salvar.

---

## Estrutura de dados (SQLite)

- `users`: usuários e perfis
- `settings`: `grades_enabled`
- `communications`: avisos e enquetes (com `options_json`)
- `poll_votes`: votos das enquetes
- `evaluations`: avaliações + template JSON
- `evaluation_submissions`: submissões dos membros + nota/feedback
- `notifications`: notificações internas (inclui avisos de nota)

---

## Segurança & Observações

- A senha do admin **deve** ser trocada após o primeiro login.
- O store de sessão está em memória (apenas para a demo). Em produção, use Redis/SQLite store.
- Limite de upload: 10 MB para `.docx`.
- Valide e normalize seus `.docx` para melhor reconhecimento. O parser é heurístico – se precisar de regras específicas, ajuste `parseDocx.js`.
- Para e-mail, defina `SMTP_URL` (ex.: `smtp://usuario:senha@smtp.seuprovedor.com:587`). O envio é **opcional**.

---

## Personalização de UI

- Cores do perfil: **Admin** em `ouro` e **Membro** em `azul` (badges).
- Botões com ícones: Usuários (engrenagem), Criar avaliação (arquivo), Comunicados (megafone), Notas (livro).
- Toggle para mostrar/ocultar o módulo de Notas no painel do Admin.

---

Bom uso! ✨