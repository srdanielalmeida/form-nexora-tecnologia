# Formulário de Diagnóstico Comercial — Nexora Tecnologia

Todos os arquivos deste projeto estão na sua pasta local `C:\Users\danie\Downloads\form-nexora-tecnologia` e funcionam **100% em código puro**, sem depender de n8n ou plataformas intermediárias pagas.

## Arquivos do Projeto

- [`index.html`](./index.html): Formulário front-end com identidade dark glassmorphism, 4 perguntas de diagnóstico + etapa de contato (Nome, WhatsApp e E-mail), captura de UTMs/`fbclid`/`_fbp`/`_fbc`, eventos do Meta Pixel (`PageView`, `FormStart`, `QuizCompleted`, `WhatsAppClick`) e envio direto para a sua planilha.
- [`google-sheets-backend.gs`](./google-sheets-backend.gs): Código puro (Google Apps Script) configurado diretamente para a sua planilha (`11Bh-ju8Ma06N-gPWCaiyWifg17ceiRQFBzloguBn4-w`), responsável por:
  1. Criar automaticamente a aba `Leads` com todas as colunas e menu suspenso de `status_comercial`.
  2. Receber e gravar em tempo real os leads vindos do `index.html`.
  3. Criar/atualizar o contato no **Chatwoot** com todos os atributos personalizados do quiz.
  4. Disparar os eventos reais **`Lead`**, **`QualifiedLead`** e **`Purchase`** na **Meta Conversions API (CAPI)** com hash SHA-256 tanto via Webhook do Chatwoot quanto ao alterar a coluna `status_comercial` na própria planilha.
- [`Nexora.png`](./Nexora.png): Logotipo oficial utilizado no cabeçalho do formulário.

---

## Como ativar a integração na sua Planilha (leva 1 minuto)

1. Acesse o seu projeto no Google Apps Script:  
   https://script.google.com/home/projects/1zkE6nfQF2BJ7prJ5SEeA9o6V-Tqp_hGTDM2NHC07Jc8Y0I7ZyMfwsXif/edit?hl=pt-br
2. Apague o `function myFunction() {}` que estiver lá e cole todo o conteúdo do arquivo [`google-sheets-backend.gs`](./google-sheets-backend.gs) (`Ctrl+V`).
4. *(Opcional)* Preencha no topo do script o seu `META_ACCESS_TOKEN` (Token da API de Conversões da Meta) e os dados do seu `CHATWOOT_BASE_URL` / `CHATWOOT_API_TOKEN`.
5. No menu superior do Apps Script, selecione a função `setupPlanilha` e clique em **Executar** (autorize o acesso da sua conta Google quando solicitado). Isso já criará a aba `Leads` formatada na sua planilha!
6. Clique no botão azul **Implantar** (canto superior direito) → **Nova implantação**:
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Clique em **Implantar** e copie a **URL do App da Web** gerada (`https://script.google.com/macros/s/.../exec`).
7. Abra o arquivo [`index.html`](./index.html) na linha `296` e cole essa URL dentro de `GOOGLE_SHEETS_WEBAPP_URL`:
   ```javascript
   const GOOGLE_SHEETS_WEBAPP_URL = 'https://script.google.com/macros/s/SUA_URL_AQUI/exec';
   ```
